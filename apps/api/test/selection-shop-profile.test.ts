import assert from 'node:assert/strict';
import {test} from 'node:test';
import {summarizeShop} from '../src/tools/selection/shop-profile';
import {matchesCriteria} from '../src/tools/selection/selection';
import type {Product} from '../src/tools/selection/fastmoss';

const shop = {id: 'c1', shopId: '1', shopName: '马来店', region: 'MY', currency: 'MYR', language: 'ms'};

test('shop profile summarizes sampled listings into categories and brands', () => {
  const items = Array.from({length: 5}, (_, index) => ({
    category_id: index < 3 ? 100 : 200,
    brand: index ? {brand_id: 9, original_brand_name: 'Acme'} : {brand_id: 0, original_brand_name: 'NoBrand'},
  }));
  const profile = summarizeShop(shop, items, new Map([[100, 'Home Storage']]));
  assert.deepEqual(profile.categories, [{name: 'Home Storage', count: 3}, {name: '类目 200', count: 2}]);
  assert.deepEqual(profile.brands, ['Acme']);
});

test('criteria prefilter keeps rows whose FastMoss values are missing', () => {
  const row = (price: Product['price'], growth: number | null) => ({price, growth, commission: null}) as Product;
  const criteria = {priceMin: 10, priceMax: 30, minGrowth: 0};
  assert.equal(matchesCriteria(row({min: 25, max: 40}, 5), criteria), true);
  assert.equal(matchesCriteria(row({min: 31, max: 40}, 5), criteria), false);
  assert.equal(matchesCriteria(row({min: 15, max: 20}, -3), criteria), false);
  assert.equal(matchesCriteria(row(null, null), criteria), true);
});
