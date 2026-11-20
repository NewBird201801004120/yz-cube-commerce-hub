import type {LocalizationContext, LocalizationPlatform} from '../../localization-platform';
import type {LocalizationShop} from '../../localization-engine';

export type ShopProfile = {
  shopId: string;
  shopName: string;
  region: string;
  currency: string;
  sampled: number;
  categories: {name: string; count: number}[];
  brands: string[];
  warnings: string[];
};

type Item = {category_id?: number; brand?: {brand_id?: number; original_brand_name?: string}};

const sampleSize = 100;
const payload = (value: any) => value?.response ?? value;

function top(values: string[], limit: number) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, count]) => ({name, count}));
}

/** Pure summary of sampled shop items; category names come from the shop's own category tree. */
export function summarizeShop(shop: LocalizationShop, items: Item[], categoryNames: Map<number, string>): ShopProfile {
  return {
    shopId: shop.id, shopName: shop.shopName, region: shop.region, currency: shop.currency, sampled: items.length,
    categories: top(items.flatMap(item => item.category_id ? [categoryNames.get(item.category_id) ?? `类目 ${item.category_id}`] : []), 5),
    brands: top(items.flatMap(item => item.brand?.brand_id && item.brand.original_brand_name ? [item.brand.original_brand_name] : []), 5).map(row => row.name),
    warnings: [],
  };
}

export async function readShopProfile(platform: LocalizationPlatform, ctx: LocalizationContext, shop: LocalizationShop): Promise<ShopProfile> {
  const warnings: string[] = [];
  let items: Item[] = [];
  try {
    // ponytail: first 100 NORMAL items only; page through get_item_list if large catalogs skew the profile.
    const list = payload(await platform.sourceRead(ctx, shop.id, 'get_item_list', {offset: '0', page_size: String(sampleSize), item_status: 'NORMAL'}));
    const ids: number[] = (list.item ?? list.item_list ?? []).map((item: any) => item.item_id);
    for (let start = 0; start < ids.length; start += 50) {
      const base = payload(await platform.sourceRead(ctx, shop.id, 'get_item_base_info', {item_id_list: ids.slice(start, start + 50).join(',')}));
      items.push(...(base.item_list ?? []));
    }
  } catch {
    items = [];
    warnings.push('店铺商品读取失败，画像仅包含市场与币种');
  }
  const names = new Map<number, string>();
  if (items.some(item => item.category_id)) {
    try {
      for (const category of (await platform.metadata(ctx, shop.id)).categories ?? []) names.set(category.id, category.name);
    } catch {
      warnings.push('类目名称读取失败，暂以类目编号显示');
    }
  }
  if (!items.length && !warnings.length) warnings.push('店铺暂无在售商品，画像仅包含市场与币种');
  const profile = summarizeShop(shop, items, names);
  if (shop.region !== 'MY') warnings.push(`店铺市场为 ${shop.region}，榜单来自马来西亚 TikTok Shop，结果仅供参考`);
  return {...profile, warnings};
}
