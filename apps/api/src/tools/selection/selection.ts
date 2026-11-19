import {BadRequestException, ConflictException, Injectable, NotFoundException} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {LocalizationService} from '../../localization';
import {LocalizationPlatform, type LocalizationContext} from '../../localization-platform';
import type {LocalizationDraft, LocalizationShop, SourceInput} from '../../localization-engine';
import type {ModelConfig} from '../../listing-engine';
import {assessProducts, type Assessment} from './assessment';
import {parseWorkbook, type Product} from './fastmoss';
import {parsePeriod, type Period} from './period';
import {fingerprint, SelectionStore, stableId} from './store';

type Upload = Awaited<ReturnType<typeof parseWorkbook>>;
type Preview = {filename: string; digest: string; createdAt: string; rows: Product[]};
type Dataset = Preview & {id: string; period: Period};
type Analysis = {
  id: string;
  datasetId: string;
  createdAt: string;
  model: string;
  modelKey: string;
  requirements: string;
  keyword: string;
  category: string;
  productIds: string[];
  status: 'running' | 'complete' | 'partial';
  results: Record<string, Assessment>;
};

type Origin = {
  draftId: string;
  sourceId: string;
  datasetId: string;
  product: Product;
  period: Period;
  shop: LocalizationShop;
  copy: 'running' | 'ready' | 'failed' | 'unconfigured';
};

const sourceSystem = 'fastmoss-selection';
const previewLifetime = 60 * 60 * 1000;
const batchSize = 8;
const pageSize = 20;
const now = () => new Date().toISOString();

function requireText(value: unknown, length: number, message: string) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > length) throw new BadRequestException(message);
  return value.trim();
}

function optionalText(value: unknown, length: number) {
  return value === undefined || value === '' ? '' : requireText(value, length, '筛选条件无效');
}

function filterRows(rows: Product[], keyword: string, category: string) {
  const needle = keyword.toLocaleLowerCase();
  return rows.filter(row => (!category || (row.category || '未分类') === category)
    && (!needle || [row.title, row.shopName, row.category].some(text => text.toLocaleLowerCase().includes(needle))));
}

function datasetSummary({rows, digest, ...meta}: Dataset) {
  return {...meta, total: rows.length};
}

function modelKey(config: ModelConfig) {
  return fingerprint([config.baseUrl, config.model, 'selection-v1']);
}

@Injectable()
export class SelectionService {
  private readonly store: SelectionStore;
  private readonly analysisActive = new Set<string>();
  private readonly copyActive = new Set<string>();

  constructor(private readonly localization: LocalizationService, private readonly platform: LocalizationPlatform) {
    this.store = new SelectionStore(join(localization.engine.dir, 'selection'));
  }

  async preview(owner: string, filename: string, bytes: Buffer) {
    if (!/\.xlsx$/i.test(filename) || filename.length > 240 || /[\\/\x00-\x1f]/.test(filename)) {
      throw new BadRequestException('请选择 FastMoss 导出的 .xlsx 文件');
    }
    const {rows, errors, warnings}: Upload = await parseWorkbook(bytes);
    const previewId = !errors.length && rows.length ? randomUUID() : null;
    if (previewId) {
      this.store.prunePreviews(owner, Date.now() - previewLifetime);
      this.store.write(owner, 'previews', previewId, {filename, createdAt: now(), digest: fingerprint(rows), rows} satisfies Preview);
    }
    return {previewId, filename, total: rows.length + errors.length, rows: rows.slice(0, 5), errors, warnings};
  }

  confirm(owner: string, raw: unknown) {
    const input = raw as {previewId?: string; period?: unknown} | null;
    const previewId = requireText(input?.previewId, 36, '请先上传并预览 XLSX');
    const period = parsePeriod(input?.period);
    const preview = this.store.read<Preview>(owner, 'previews', previewId);
    if (!preview || Date.now() - Date.parse(preview.createdAt) > previewLifetime) {
      throw new NotFoundException('预览已失效，请重新上传 XLSX');
    }
    const id = stableId([preview.filename, preview.digest, period]);
    const existing = this.store.read<Dataset>(owner, 'datasets', id);
    if (existing) return datasetSummary(existing);
    const dataset = {...preview, id, period, createdAt: now()};
    this.store.write(owner, 'datasets', id, dataset);
    return datasetSummary(dataset);
  }

  datasets(owner: string) {
    return this.store.list<Dataset>(owner, 'datasets').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(datasetSummary);
  }

  private dataset(owner: string, id: string) {
    const dataset = this.store.read<Dataset>(owner, 'datasets', id);
    if (!dataset) throw new NotFoundException('榜单不存在');
    return dataset;
  }

  products(owner: string, id: string, query: Record<string, unknown>) {
    const dataset = this.dataset(owner, id);
    const keyword = optionalText(query.keyword, 200), category = optionalText(query.category, 200);
    const job = query.analysisId ? this.analysis(owner, requireText(query.analysisId, 36, '分析任务无效')) : undefined;
    if (job && job.datasetId !== id) throw new BadRequestException('分析任务不属于当前榜单');
    const byId = job?.results ?? {};
    const categories = [...new Set(dataset.rows.map(row => row.category || '未分类'))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const rows = filterRows(dataset.rows, keyword, category);
    const visible = query.recommended === 'true' ? rows.filter(row => (byId[row.productId]?.score ?? -1) >= 70) : rows;
    const orderValue = (row: Product) => {
      switch (query.sort) {
        case 'units': return row.units;
        case 'growth': return row.growth;
        case 'revenue': return row.revenue;
        case 'totalUnits': return row.totalUnits;
        case 'score': return byId[row.productId]?.score;
        default: return -row.rank;
      }
    };
    visible.sort((a, b) => {
      const first = orderValue(a) ?? -Infinity, second = orderValue(b) ?? -Infinity;
      return first === second ? a.rank - b.rank : first < second ? 1 : -1;
    });
    const requestedPage = Number(query.page);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, Math.max(1, Math.ceil(visible.length / pageSize))) : 1;
    return {
      categories, page, pageSize, total: visible.length, matched: rows.length,
      rows: visible.slice((page - 1) * pageSize, page * pageSize).map(row => ({...row, assessment: byId[row.productId]})),
    };
  }

  private analysis(owner: string, id: string) {
    const job = this.store.read<Analysis>(owner, 'analyses', id);
    if (!job) throw new NotFoundException('分析任务不存在');
    return job;
  }

  private analysisView(owner: string, job: Analysis) {
    const {results, productIds, modelKey: key, ...summary} = job;
    const scoreCount = Object.keys(results).length;
    const status = job.status === 'running' && !this.analysisActive.has(owner) ? 'partial' : job.status;
    return {...summary, status, total: productIds.length, scored: scoreCount, failed: status === 'partial' ? productIds.length - scoreCount : 0};
  }

  analyses(owner: string, datasetId: string) {
    this.dataset(owner, datasetId);
    return this.store.list<Analysis>(owner, 'analyses').filter(job => job.datasetId === datasetId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(job => this.analysisView(owner, job));
  }

  analyze(owner: string, datasetId: string, raw: unknown) {
    if (this.analysisActive.has(owner)) throw new ConflictException('已有选品分析正在运行，请等待完成');
    const input = raw as {requirements?: unknown; keyword?: unknown; category?: unknown} | null;
    const dataset = this.dataset(owner, datasetId);
    const requirements = requireText(input?.requirements, 2000, '请填写选品要求，最多 2,000 字');
    const keyword = optionalText(input?.keyword, 200), category = optionalText(input?.category, 200);
    const rows = filterRows(dataset.rows, keyword, category);
    if (!rows.length) throw new BadRequestException('当前筛选范围没有商品');
    const config = this.localization.content.planner();
    const job: Analysis = {
      id: randomUUID(), datasetId, createdAt: now(), model: config.model, modelKey: modelKey(config),
      requirements, keyword, category, productIds: rows.map(row => row.productId), status: 'running', results: {},
    };
    this.runAnalysis(owner, job, dataset, config);
    return this.analysisView(owner, job);
  }

  retryAnalysis(owner: string, id: string) {
    const job = this.analysis(owner, id);
    if (job.status === 'complete') return this.analysisView(owner, job);
    if (this.analysisActive.has(owner)) throw new ConflictException('已有选品分析正在运行，请等待完成');
    const config = this.localization.content.planner();
    if (job.modelKey !== modelKey(config)) throw new ConflictException('文本模型已变更，请开始新一轮分析');
    const dataset = this.dataset(owner, job.datasetId);
    job.status = 'running';
    this.runAnalysis(owner, job, dataset, config);
    return this.analysisView(owner, job);
  }

  private runAnalysis(owner: string, job: Analysis, dataset: Dataset, config: ModelConfig) {
    this.store.write(owner, 'analyses', job.id, job);
    this.analysisActive.add(owner);
    void (async () => {
      const ids = new Set(job.productIds.filter(id => !job.results[id]));
      const pending = dataset.rows.filter(row => ids.has(row.productId));
      let consecutiveFailures = 0;
      for (let index = 0; index < pending.length; index += batchSize) {
        try {
          const results = await assessProducts(config, job.requirements, dataset.period, pending.slice(index, index + batchSize));
          for (const result of results) job.results[result.productId] = result;
          consecutiveFailures = 0;
        } catch {
          consecutiveFailures++;
        }
        this.store.write(owner, 'analyses', job.id, job);
        // A persistent provider failure should leave the remaining rows available for a deliberate retry.
        if (consecutiveFailures >= 3) break;
      }
      job.status = Object.keys(job.results).length === job.productIds.length ? 'complete' : 'partial';
      this.store.write(owner, 'analyses', job.id, job);
    })().catch(() => { /* The persisted checkpoint becomes retryable once the worker stops. */ })
      .finally(() => this.analysisActive.delete(owner));
  }

  async follow(ctx: LocalizationContext, datasetId: string, raw: unknown) {
    const input = raw as {productId?: unknown; shopId?: unknown} | null;
    const productId = requireText(input?.productId, 64, '请选择榜单商品');
    const shopId = requireText(input?.shopId, 150, '请选择目标店铺');
    const dataset = this.dataset(ctx.owner, datasetId);
    const product = dataset.rows.find(row => row.productId === productId);
    if (!product) throw new NotFoundException('榜单商品不存在');
    const draftId = stableId([sourceSystem, ctx.owner, productId, shopId]);
    let origin = this.store.read<Origin>(ctx.owner, 'origins', draftId);
    if (origin) {
      this.materialize(ctx.owner, origin);
      return this.followResult(origin, true);
    }
    const shop = (await this.platform.shops(ctx)).find(s => s.id === shopId && s.status === 'CONNECTED' && s.language && s.currency);
    if (!shop) throw new BadRequestException('请选择已连接且支持本地化的 Shopee 店铺');
    // Re-read after the platform lookup so concurrent browser requests share the first snapshot.
    origin = this.store.read<Origin>(ctx.owner, 'origins', draftId);
    if (origin) {
      this.materialize(ctx.owner, origin);
      return this.followResult(origin, true);
    }
    origin = {draftId, sourceId: stableId([sourceSystem, draftId]), datasetId, product, period: dataset.period, shop, copy: 'failed'};
    this.store.write(ctx.owner, 'origins', draftId, origin);
    const draft = this.materialize(ctx.owner, origin);
    this.generateCopy(ctx.owner, origin, draft);
    return this.followResult(origin, false);
  }

  private followResult(origin: Origin, existing: boolean) {
    return {draftId: origin.draftId, existing, reviewPath: '/tools/localization?selection=1&draft=' + origin.draftId};
  }

  private materialize(owner: string, origin: Origin) {
    const row = origin.product;
    const input: SourceInput = {
      schemaVersion: 1, sourceSystem, sourceProductId: row.productId, title: row.title, description: '',
      images: [], parameters: row.category ? {'类目': row.category} : {}, specificationNames: [],
      variants: [{sku: 'FM-' + row.productId, options: []}],
    };
    const engine = this.localization.engine;
    engine.ensureImportedSource(owner, input, origin.sourceId);
    return engine.ensureImportedDraft(owner, origin.sourceId, origin.shop, origin.shop.language, origin.draftId);
  }

  private readOrigin(owner: string, id: string) {
    const origin = this.store.read<Origin>(owner, 'origins', id);
    if (!origin) throw new NotFoundException('跟卖来源不存在');
    if (origin.copy === 'running' && !this.copyActive.has(id)) {
      origin.copy = 'failed';
      this.store.write(owner, 'origins', id, origin);
    }
    return origin;
  }

  origin(owner: string, id: string) {
    const {shop, ...origin} = this.readOrigin(owner, id);
    const draft = this.localization.engine.getDraft(owner, id);
    return {...origin, revision: draft.revision};
  }

  retryCopy(owner: string, id: string) {
    const origin = this.readOrigin(owner, id);
    const engine = this.localization.engine;
    if (engine.listTasks(owner).some(task => task.draftId === id && (task.status !== 'failed' || task.remoteId))) {
      throw new ConflictException('草稿已有发布任务，请先核对发布结果');
    }
    if (origin.copy !== 'running') this.generateCopy(owner, origin, engine.getDraft(owner, id));
    return this.origin(owner, id);
  }

  private generateCopy(owner: string, origin: Origin, draft: LocalizationDraft) {
    try {
      this.localization.content.planner();
    } catch {
      origin.copy = 'unconfigured';
      this.store.write(owner, 'origins', origin.draftId, origin);
      return;
    }
    origin.copy = 'running';
    this.store.write(owner, 'origins', origin.draftId, origin);
    this.copyActive.add(origin.draftId);
    void (async () => {
      try {
        const engine = this.localization.engine;
        const patch = await this.localization.content.selectionCopy(engine.getSource(owner, draft.sourceId), draft);
        engine.updateDraft(owner, draft.id, patch, draft.revision);
        origin.copy = 'ready';
      } catch {
        origin.copy = 'failed';
      }
      this.store.write(owner, 'origins', origin.draftId, origin);
    })().catch(() => { /* The saved draft remains available even if the checkpoint cannot be written. */ })
      .finally(() => this.copyActive.delete(origin.draftId));
  }
}
