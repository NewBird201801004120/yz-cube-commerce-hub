import 'reflect-metadata';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync, rmSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {Workbook} from 'exceljs';
import {createTeamApp} from '../src/team-main';

const headings = [
  '商品名称', '商品ID', '商品图片', '店铺名', '商品售价', '国家/地区', '商品分类',
  '佣金比例', '销量', '销量环比', '总销量', '总销售额', '销售额', '预估商品上架时间',
  '店铺总销量', 'FastMoss 商品详情页', 'TikTok 官网商品详情页', 'FastMoss 店铺详情页', '商品状态',
];
const productId = '1729641665495075256';
const shops = [
  {id: 'test-my', shopId: '1', shopName: '测试马来店', region: 'MY', status: 'CONNECTED'},
  {id: 'test-ph', shopId: '2', shopName: '测试菲律宾店', region: 'PH', status: 'CONNECTED'},
];

async function workbook(units: number, region = 'MY', id: number | string = productId) {
  const book = new Workbook();
  const sheet = book.addWorksheet('FastMoss');
  sheet.addRow(headings);
  sheet.addRow(['White Box', id, 'https://s.500fd.com/box.webp', 'Test store', 'RM1.50 - 4.00',
    region, '', '2%', units, '-', 500, 900, 25, '', 400,
    'https://www.fastmoss.com/zh/e-commerce/detail/1729641665495075256',
    'https://shop.tiktok.com/view/product/1729641665495075256?region=MY', '', '在售',
  ]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

test('FastMoss XLSX to an owned, editable Shopee draft with AI unconfigured', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'selection-http-'));
  process.env.NODE_ENV = 'test';
  process.env.LOCALIZATION_DATA_DIR = join(directory, 'localization');
  process.env.LISTING_DATA_DIR = join(directory, 'listing');
  process.env.LOCALIZATION_LOCAL_MODE = 'true';
  const upstream = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/v1/development/login') {
      let body = '';
      request.on('data', chunk => {body += chunk;});
      request.on('end', () => response.end(JSON.stringify({token: JSON.parse(body).email, expiresIn: 3600})));
      return;
    }
    if (request.url === '/api/v1/development/shops') return response.end(JSON.stringify(shops));
    if (request.url === '/api/v1/development/localization/imports') return response.end('{"records":[]}');
    if (request.url?.includes('/read/')) return response.end('{}');
    response.end(JSON.stringify({email: request.headers.authorization?.slice(7), role: 'ADMIN'}));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  process.env.TEAM_API_ORIGIN = `http://127.0.0.1:${(upstream.address() as {port: number}).port}`;
  const app = await createTeamApp();
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl() + '/api/v1';
  const origin = 'http://127.0.0.1:3100';
  const root = '/localization/selection';
  const call = (path: string, cookie = '', body?: unknown, method = body === undefined ? 'GET' : 'POST') => fetch(base + path, {
    method, headers: {origin, ...(cookie ? {cookie} : {}), 'content-type': 'application/json'},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const upload = (cookie: string, data: Buffer) => fetch(base + root + '/imports/preview?filename=fastmoss.xlsx', {
    method: 'POST', headers: {origin, cookie, 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
    body: new Uint8Array(data),
  });
  async function json(response: Response, status = 200) {
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return body;
  }
  async function login(email: string) {
    const response = await call('/auth/login', '', {email, password: 'fixture'});
    assert.equal(response.status, 201);
    return response.headers.get('set-cookie')!.split(';')[0];
  }

  try {
    assert.equal((await call(root + '/datasets')).status, 401);
    const cookie = await login('operator@fixture.test');
    const other = await login('other@fixture.test');
    assert.equal((await upload(cookie, Buffer.from('invalid xlsx'))).status, 400);
    for (const data of [await workbook(1, 'SG'), await workbook(1, 'MY', Number(productId))]) {
      const invalid = await json(await upload(cookie, data), 201);
      assert.equal(invalid.previewId, null);
      assert.equal(invalid.errors[0].row, 2);
    }
    const first = await json(await upload(cookie, await workbook(7)), 201);
    assert.deepEqual(first.rows[0].price, {min: 1.5, max: 4});
    assert.equal(first.rows[0].productId, productId);
    assert.equal(first.rows[0].growth, null);
    assert.equal(first.warnings[0].row, 2);
    assert.equal((await call(root + '/imports', cookie, {previewId: first.previewId, period: {type: 'week', value: '2026-11-17'}})).status, 400);
    const confirmation = {previewId: first.previewId, period: {type: 'day', value: '2026-11-17'}};
    assert.equal((await call(root + '/imports', other, confirmation)).status, 404);
    const daily = await json(await call(root + '/imports', cookie, confirmation), 201);
    assert.equal((await json(await call(root + '/imports', cookie, confirmation), 201)).id, daily.id);
    const second = await json(await upload(cookie, await workbook(53)), 201);
    const weekly = await json(await call(root + '/imports', cookie, {
      previewId: second.previewId, period: {type: 'week', value: '2026-11-09'},
    }), 201);
    assert.notEqual(daily.id, weekly.id);
    assert.deepEqual(await json(await call(root + '/datasets', other)), []);
    const dailyPath = root + '/datasets/' + daily.id;
    const weeklyPath = root + '/datasets/' + weekly.id;
    const listed = await json(await call(dailyPath + '/products?keyword=white&category=' + encodeURIComponent('未分类'), cookie));
    assert.equal(listed.matched, 1);
    assert.equal(listed.rows[0].units, 7);
    assert.equal((await json(await call(weeklyPath + '/products', cookie))).rows[0].units, 53);
    const analysisError = await json(await call(dailyPath + '/analyses', cookie, {requirements: '盒子'}), 400);
    assert.match(analysisError.message, /文本/);
    assert.deepEqual(await json(await call(dailyPath + '/analyses', cookie)), []);

    const destination = {productId, shopId: 'test-my'};
    const concurrent = await Promise.all([call(dailyPath + '/drafts', cookie, destination), call(dailyPath + '/drafts', cookie, destination)]);
    const created = await Promise.all(concurrent.map(response => json(response, 201)));
    assert.equal(created[0].draftId, created[1].draftId);
    assert.equal(created.filter(item => !item.existing).length, 1);
    const draftId = created[0].draftId;
    const draftPath = '/localization/drafts/' + draftId;
    assert.equal((await call(draftPath, other)).status, 404);
    const draft = await json(await call(draftPath, cookie));
    assert.equal(draft.shop.currency, 'MYR');
    assert.equal(draft.description, '');
    assert.equal(draft.variants[0].price, null);
    assert.deepEqual(draft.images, ['https://s.500fd.com/box.webp']);
    const provenance = await json(await call(root + '/drafts/' + draftId + '/origin', cookie));
    assert.equal(provenance.copy, 'unconfigured');
    assert.deepEqual(provenance.referenceImages, ['https://s.500fd.com/box.webp']);
    assert.equal(provenance.canApplyReferenceImages, true);
    assert.equal(provenance.product.image, 'https://s.500fd.com/box.webp');
    const saved = await json(await call(draftPath, cookie, {...draft, title: 'Edited title', specificationNames: ['颜色'], variants: [
      {sku: 'WHITE', options: ['白色'], price: 2, stock: 4}, {sku: 'BLUE', options: ['蓝色'], price: 3, stock: 5},
    ]}, 'PUT'));
    const repeated = await json(await call(weeklyPath + '/drafts', cookie, destination), 201);
    assert.equal(repeated.draftId, draftId);
    assert.equal(repeated.existing, true);
    assert.equal((await json(await call(draftPath, cookie))).revision, saved.revision);
    assert.equal((await json(await call(root + '/drafts/' + draftId + '/origin', cookie))).datasetId, daily.id);
    const another = await json(await call(weeklyPath + '/drafts', cookie, {...destination, shopId: 'test-ph'}), 201);
    assert.notEqual(another.draftId, draftId);
    assert.equal((await json(await call('/localization/drafts/' + another.draftId, cookie))).shop.currency, 'PHP');
    const preview = await json(await call(draftPath + '/preview', cookie, {}), 201);
    assert.equal(preview.canPublish, false);
    assert.ok(!preview.issues.includes('添加可用商品图片'));
    assert.deepEqual(preview.draft.images, ['https://s.500fd.com/box.webp']);
    assert.equal(preview.draft.variants.length, 2);
  } finally {
    await app.close();
    upstream.close();
    await once(upstream, 'close');
    rmSync(directory, {recursive: true, force: true});
  }
});
