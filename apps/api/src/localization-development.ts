/** Explicitly fake storefronts used only by pnpm dev's local simulation flow. */
export const localLocalizationShops = [{
  id: 'local-sim-ph',
  shopId: 'SIM-PH-001',
  shopName: '本地模拟店铺_PH',
  region: 'PH',
  status: 'CONNECTED',
  currency: 'PHP',
  language: 'English',
}] as const;

export const isLocalLocalizationMode = () => process.env.LOCALIZATION_LOCAL_MODE === 'true';
