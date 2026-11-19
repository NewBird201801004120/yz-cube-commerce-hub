import {api} from './api';
export type LocalizationMedia={assets:{id:string;url:string;role:'gallery'|'detail'|'variant';sourceLanguage?:string;textInImage:'unknown'|'none'|'present'}[];variantImages:{sku:string;assetId:string}[];detailBlocks:({type:'text';text:string}|{type:'image';assetId:string})[]};
export type MarketShop={id:string;shopId:string;shopName:string|null;region:string;currency:string;language:string;supportedLanguages?:string[];status?:string};
export type SourceProduct={id:string;schemaVersion:1;sourceSystem:string;sourceProductId:string;title:string;description:string;images:string[];media?:LocalizationMedia;parameters:Record<string,string>;specificationNames:string[];variants:{sku:string;options:string[];stock?:number}[];weightKg?:number;dimensionsCm?:{length:number;width:number;height:number};createdAt?:string;publishingIssue?:string;publishing?:{currency:string;variants:{sku:string;price:number;stock:number}[];marketPrices?:{currency:string;variants:{sku:string;price:number;stock:number}[]}[]}};
export type MarketDraft={purpose?:'original'|'localized';localizedAt?:string;marketAdaptation?:{status:'ready'|'needs_input'|'failed';issues:string[];checkedAt:string};id:string;sourceId:string;revision:number;shop:MarketShop;language:string;title:string;sellingPoints:string[];description:string;variants:{sku:string;options:string[];price:number|null;stock:number|null;locationId?:string;gtinCode?:string}[];weightKg:number|null;dimensionsCm:{length:number|null;width:number|null;height:number|null};categoryId:number|null;brandId:number|null;brandName?:string;condition?:'NEW'|'USED';preOrder?:{isPreOrder:boolean;daysToShip?:number};attributes:{id:number;values:{id?:number;value:string;unit?:string}[]}[];logistics:{id:number;enabled:boolean;sizeId?:number;shippingFee?:number;isFree?:boolean}[];images:string[];media?:LocalizationMedia;specificationNames:string[];marketConfirmed:boolean;imagesReviewed:boolean;createdAt:string;updatedAt:string};
export type PublishJob={draft?:MarketDraft;id:string;draftId:string;status:string;stage:string;remoteId?:string;error?:string;createdAt:string;updatedAt:string};
export type MarketMetadata={categories?:{id:number;name:string;hasChildren?:boolean}[];brands?:{id:number;name:string}[];attributes?:{id:number;name:string;required?:boolean;values?:{id:number;value:string}[]}[];logistics?:{id:number;name:string;enabled?:boolean}[];limits?:Record<string,unknown>;capability?:{path?:string;reason?:string};warnings?:string[]};
export type PreviewResult={draft?:MarketDraft;issues:string[];warnings?:string[];canPublish?:boolean};
export type ListingImage={market?:string;language?:string;jobId:string;slotId:string;name:string;url:string};
export type LocalizationReceipt={origin?:'local'|'central';id:string;requestId:string;status:'received'|'localizing'|'awaiting_review'|'localization_failed';localizationError?:string;reviewSourceId?:string;sourceId:string;draftId:string;reviewPath:string;country:string;language:string;createdAt:string;title:string;sourceSystem:string;sourceProductId:string;shopName:string|null;currency?:string;publishTasks:{id:string;status:string;stage:string;remoteId?:string;error?:string}[]};
export type LocalizationReceipts={records:LocalizationReceipt[];environment:'central'|'team'|'local';reviewOrigin?:string};
export const publishStatus:Record<string,string>={preparing:'准备发布',creating:'正在创建商品',uncertain:'创建结果待核对',created:'商品已创建，后续步骤未完成',completing:'正在补全商品',succeeded:'发布完成',failed:'未完成'};
export const localizationApi={
 adapt:(id:string)=>api<{draft:MarketDraft;issues:string[]}>(`/localization/drafts/${id}/adapt`,{method:'POST',body:'{}'}),
 matchCategory:(id:string)=>api<{draft:MarketDraft;match:{id:number;name:string}|null;status:string}>(`/localization/drafts/${id}/match-category`,{method:'POST',body:'{}'}),
 receiptSource:(id:string)=>api<SourceProduct>(`/localization/receipts/${encodeURIComponent(id)}/source`,{method:'POST',body:'{}'}),
 openReceipt:(id:string)=>api<MarketDraft>(`/localization/receipts/${encodeURIComponent(id)}/open`,{method:'POST',body:'{}'}),
 receipts:()=>api<LocalizationReceipts>('/localization/receipts'),
 retryReceipt:(id:string)=>api<LocalizationReceipt>(`/localization/receipts/${encodeURIComponent(id)}/localize`,{method:'POST',body:'{}'}),
 sources:()=>api<SourceProduct[]>('/localization/sources'),
 shops:()=>api<MarketShop[]>('/localization/shops'),
 drafts:()=>api<MarketDraft[]>('/localization/drafts'),
 createDraft:(sourceId:string,shopId:string,language?:string,purpose?:'original'|'localized')=>api<MarketDraft>('/localization/drafts',{method:'POST',body:JSON.stringify({sourceId,shopId,language,purpose})}),
 save:(draft:MarketDraft)=>api<MarketDraft>(`/localization/drafts/${draft.id}`,{method:'PUT',body:JSON.stringify(draft)}),
 localize:(id:string)=>api<MarketDraft>(`/localization/drafts/${id}/localize`,{method:'POST',body:'{}'}),
 metadata:(shopId:string,categoryId?:number)=>api<MarketMetadata>(`/localization/shops/${shopId}/metadata${categoryId?`?categoryId=${categoryId}`:''}`),
 preview:(id:string)=>api<PreviewResult>(`/localization/drafts/${id}/preview`,{method:'POST',body:'{}'}),
 publish:(draft:MarketDraft)=>api<PublishJob>(`/localization/drafts/${draft.id}/publish`,{method:'POST',body:JSON.stringify({revision:draft.revision,confirmed:true,requestId:`publish-${draft.id}-${draft.revision}`})}),
 jobs:()=>api<PublishJob[]>('/localization/jobs'),
 job:(id:string)=>api<PublishJob>(`/localization/jobs/${encodeURIComponent(id)}`),
 recover:(id:string,kind:'resume'|'reconcile'|'status')=>api<PublishJob>(`/localization/jobs/${id}/${kind}`,{method:'POST',body:'{}'}),
 uploadImage:(data:string)=>api<{url:string}>('/localization/assets',{method:'POST',body:JSON.stringify({data})}),
 listingImages:async()=>{const groups=await api<{jobId:string;name:string;market?:string;language?:string;slots:{id:string;title:string;url:string}[]}[]>('/localization/listing-images');return groups.flatMap(group=>group.slots.map(slot=>({market:group.market,language:group.language,jobId:group.jobId,slotId:slot.id,name:`${group.name} · ${slot.title}`,url:slot.url})));},
 attachListing:(id:string,images:ListingImage[],revision:number)=>api<MarketDraft>(`/localization/drafts/${id}/listing-images`,{method:'POST',body:JSON.stringify({jobId:images[0]?.jobId,slotIds:images.map(image=>image.slotId),revision})}),
};

export const marketNames:Record<string,string>={PH:'菲律宾',SG:'新加坡',MY:'马来西亚',TH:'泰国',VN:'越南',TW:'中国台湾',ID:'印度尼西亚',BR:'巴西',MX:'墨西哥',CO:'哥伦比亚',CL:'智利'};
export const languageNames:Record<string,string>={English:'英语',Filipino:'菲律宾语',简体中文:'简体中文',繁體中文:'繁体中文','Bahasa Melayu':'马来语','Bahasa Indonesia':'印度尼西亚语','ไทย':'泰语','Tiếng Việt':'越南语','Português':'葡萄牙语','Español':'西班牙语'};
export const marketLanguageName=(region:string,language:string)=>`${marketNames[region]||region} · ${languageNames[language]||language}`;
