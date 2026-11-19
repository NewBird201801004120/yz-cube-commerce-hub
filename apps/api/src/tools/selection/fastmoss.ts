import {BadRequestException} from '@nestjs/common';
import type {CellValue} from 'exceljs';
import {unzipSync} from 'fflate';

export const maxWorkbookBytes = 5 * 1024 * 1024;
const maxRows = 2000;
const fields = {
  title: '商品名称', productId: '商品ID', image: '商品图片', shopName: '店铺名',
  price: '商品售价', region: '国家/地区', category: '商品分类', commission: '佣金比例',
  units: '销量', growth: '销量环比', totalUnits: '总销量', totalRevenue: '总销售额',
  revenue: '销售额', listedAt: '预估商品上架时间', shopUnits: '店铺总销量',
  fastmossUrl: 'FastMoss 商品详情页', tiktokUrl: 'TikTok 官网商品详情页',
  shopUrl: 'FastMoss 店铺详情页', status: '商品状态',
} as const;

export type Product = {
  rank: number;
  productId: string;
  title: string;
  image: string;
  shopName: string;
  price: {min: number; max: number} | null;
  category: string;
  commission: number | null;
  units: number | null;
  growth: number | null;
  totalUnits: number | null;
  totalRevenue: number | null;
  revenue: number | null;
  listedAt: string;
  shopUnits: number | null;
  fastmossUrl: string;
  tiktokUrl: string;
  shopUrl: string;
  status: string;
};

function cellText(value: CellValue): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && 'richText' in value) {
    return value.richText.map(part => part.text).join('').trim();
  }
  if (value && typeof value === 'object' && 'hyperlink' in value) return value.text.trim();
  return '';
}

function url(value: CellValue, domain: string) {
  const raw = value && typeof value === 'object' && 'hyperlink' in value
    ? value.hyperlink.trim() : cellText(value);
  if (!raw || raw.length > 2048) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port
      && (parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)) ? parsed.href : '';
  } catch {
    return '';
  }
}

function price(value: string): Product['price'] {
  const match = value.replace(/,/g, '').match(/^RM\s*(\d+(?:\.\d+)?)\s*(?:[-–~]\s*(?:RM\s*)?(\d+(?:\.\d+)?))?$/i);
  if (!match) return null;
  const min = Number(match[1]), max = Number(match[2] ?? match[1]);
  return Number.isFinite(max) && min <= max ? {min, max} : null;
}

function metric(value: CellValue, percent: boolean, format?: string): number | null {
  const text = cellText(value).replace(/,/g, '');
  if (!/^-?\d+(?:\.\d+)?%?$/.test(text) || (!percent && text.endsWith('%'))) return null;
  const number = Number(text.replace(/%$/, ''));
  const result = percent && typeof value === 'number' && format?.includes('%') ? number * 100 : number;
  return Number.isFinite(result) && (percent || result >= 0) ? result : null;
}

export async function parseWorkbook(bytes: Buffer) {
  if (!bytes.length || bytes.length > maxWorkbookBytes) throw new BadRequestException('XLSX 文件不能超过 5 MB');
  let workbook;
  try {
    let entries = 0, size = 0;
    unzipSync(bytes, {filter(file) {
      entries++;
      size += file.originalSize;
      if (entries > 2000 || size > 40 * 1024 * 1024) throw Error('Workbook exceeds expansion limit');
      return false;
    }});
    const {Workbook} = await import('exceljs');
    workbook = new Workbook();
    await workbook.xlsx.load(bytes as never);
  } catch {
    throw new BadRequestException('无法读取 XLSX，请检查文件格式、大小和加密状态');
  }
  const sheet = workbook.getWorksheet('FastMoss') ?? workbook.worksheets[0];
  if (!sheet || sheet.rowCount > maxRows + 1) throw new BadRequestException('请选择最多 2,000 条商品的 FastMoss 榜单');
  const columns = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, index) => {
    const heading = cellText(cell.value).replace(/\s+/g, '');
    if (columns.has(heading)) throw new BadRequestException('表头存在重复字段');
    columns.set(heading, index);
  });
  const missing = Object.values(fields).filter(name => !columns.has(name.replace(/\s+/g, '')));
  if (missing.length) throw new BadRequestException('缺少 FastMoss 榜单字段：' + missing.join('、'));

  const rows: Product[] = [];
  const errors: {row: number; message: string}[] = [];
  const warnings: {row: number; message: string}[] = [];
  const ids = new Set<string>();
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const cell = (key: keyof typeof fields) => row.getCell(columns.get(fields[key].replace(/\s+/g, ''))!);
    const value = (key: keyof typeof fields) => cellText(cell(key).value);
    const number = (key: keyof typeof fields, percent = false) => metric(cell(key).value, percent, cell(key).numFmt);
    const productId = value('productId');
    const title = value('title');
    const idCell = cell('productId').value;
    const problems = [
      ...(!/^\d{1,64}$/.test(productId) || typeof idCell === 'number' && !Number.isSafeInteger(idCell) ? ['商品 ID 缺失或精度不可靠，请将 ID 保存为文本'] : []),
      ...(!title || title.length > 500 ? ['商品名称缺失或超过 500 字'] : []),
      ...(value('region').toUpperCase() !== 'MY' ? ['国家/地区必须为 MY'] : []),
      ...(ids.has(productId) ? ['同一榜单中商品 ID 重复'] : []),
    ];
    if (problems.length) {
      errors.push({row: index, message: problems.join('，')});
      return;
    }
    ids.add(productId);
    const parsedPrice = price(value('price'));
    const category = value('category').slice(0, 200);
    const growth = number('growth', true);
    const notes = [!category && '类目', growth === null && '销量环比', !parsedPrice && 'MYR 售价'].filter(Boolean);
    if (notes.length) warnings.push({row: index, message: `缺少可读的${notes.join('、')}`});
    rows.push({
      rank: index - 1, productId, title, category, growth, price: parsedPrice,
      image: url(cell('image').value, 's.500fd.com'),
      shopName: value('shopName').slice(0, 200),
      commission: number('commission', true), units: number('units'), revenue: number('revenue'),
      totalUnits: number('totalUnits'), totalRevenue: number('totalRevenue'), shopUnits: number('shopUnits'),
      listedAt: value('listedAt').slice(0, 100), status: value('status').slice(0, 100),
      fastmossUrl: url(cell('fastmossUrl').value, 'fastmoss.com'),
      tiktokUrl: url(cell('tiktokUrl').value, 'tiktok.com'),
      shopUrl: url(cell('shopUrl').value, 'fastmoss.com'),
    });
  });
  if (!rows.length && !errors.length) throw new BadRequestException('榜单没有商品数据');
  return {rows, errors, warnings};
}
