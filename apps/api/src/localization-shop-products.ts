import {Injectable,Controller,Get,Post,Param,Query,Req,UseGuards,BadRequestException,BadGatewayException} from '@nestjs/common';
import type {Request} from 'express';
import {createHash} from 'node:crypto';
import {LocalizationGuard,LocalizationService} from './localization';
import {LocalizationPlatform,LocalizationContext} from './localization-platform';
import type {LocalizationShop,SourceInput,SourcePublishing} from './localization-engine';
import type {LocalizationMedia} from './localization-media';
const payload=(value:any)=>value?.response??value;
const finite=(value:any)=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):undefined;
function stock(row:any):number|undefined{const rows=row.seller_stock??row.stock_info_v2?.seller_stock??row.stock_info;const values=Array.isArray(rows)?rows.map(r=>finite(r.stock??r.normal_stock)):[];const n=values.length&&values.every(v=>v!==undefined)?values.reduce((sum,v)=>sum+v!,0):finite(row.stock_info_v2?.summary_info?.total_available_stock??row.stock);return n!==undefined&&Number.isInteger(n)&&n>=0?n:undefined;}
function price(row:any){const p=Array.isArray(row.price_info)?row.price_info[0]:row.price_info;return {currency:p?.currency,price:finite(p?.original_price??p?.current_price??row.original_price)};}
/** Copy factual product data only. Source category/logistic IDs never become target-market IDs. */
export function shopProductSnapshot(shop:LocalizationShop,item:any,models:any={}){
 const fields=item.description_info?.extended_description?.field_list??[];
 const description=item.description||fields.filter((f:any)=>f.field_type==='text').map((f:any)=>f.text).join('\n');
 const parameters:Record<string,string>={'来源店铺':shop.shopName,'来源店铺ID':shop.id,'来源商品ID':String(item.item_id),'来源国家':shop.region,'来源币种':price(item).currency||shop.currency};
 for(const a of item.attribute_list??[]){const name=a.original_attribute_name||a.display_attribute_name;if(name)parameters[name]=(a.attribute_value_list??[]).map((v:any)=>v.original_value_name||v.display_value_name).filter(Boolean).join(', ');}
 if(item.brand?.original_brand_name)parameters['品牌']=item.brand.original_brand_name;
 if(item.item_sku)parameters['来源主商品货号']=item.item_sku;
 const tiers=models.tier_variation??models.standardise_tier_variation??[];
 const rows=models.model?.length?models.model:[item];const seen=new Set<string>();
 const media:LocalizationMedia={assets:[],variantImages:[],detailBlocks:[]};
 const asset=(url:string,role:'gallery'|'variant'|'detail')=>{const id='asset-'+media.assets.length;media.assets.push({id,url,role,textInImage:'unknown'});return id;};
 const images=item.image?.image_url_list??[];images.forEach((url:string)=>asset(url,'gallery'));
 const variants=rows.map((row:any)=>{let sku=row.model_sku||(!models.model?.length&&item.item_sku)||`item-${item.item_id}-model-${row.model_id??'single'}`;if(seen.has(sku))sku=`item-${item.item_id}-model-${row.model_id}`;if(seen.has(sku))throw new BadRequestException('来源商品规格标识重复，请检查店铺商品资料');seen.add(sku);
  const options=tiers.map((tier:any,index:number)=>{const option=tier.option_list?.[row.tier_index?.[index]];if(!option?.option)throw new BadRequestException('来源商品规格资料不完整');return option.option;});
  const option=tiers[0]?.option_list?.[row.tier_index?.[0]],url=option?.image?.image_url||option?.image_url;if(url)media.variantImages.push({sku,assetId:asset(url,'variant')});
  const quantity=stock(row);return {sku,options,...(quantity===undefined?{}:{stock:quantity})};});
 for(const f of fields){if(f.field_type==='text'&&f.text)media.detailBlocks.push({type:'text',text:f.text});else if(f.field_type==='image'){const url=f.image_info?.image_url||f.image_url;if(url)media.detailBlocks.push({type:'image',assetId:asset(url,'detail')});}}
 const weight=finite(item.weight),d=item.dimension,length=finite(d?.package_length),width=finite(d?.package_width),height=finite(d?.package_height);
 const source:SourceInput={schemaVersion:1,sourceSystem:'shopee-shop',sourceProductId:`${shop.id}:${item.item_id}`,title:item.item_name,description,images,media,parameters,specificationNames:tiers.map((t:any)=>t.name),variants,...(weight&&weight>0?{weightKg:weight}:{}),...(length&&width&&height&&length>0&&width>0&&height>0?{dimensionsCm:{length,width,height}}:{})};
 const currencies=rows.map((r:any)=>price(r).currency||price(item).currency||shop.currency),prices=rows.map(price);
 const complete=currencies.every((c:string)=>c===currencies[0])&&prices.every((p:any)=>p.price!==undefined&&p.price>0)&&variants.every((v:any)=>v.stock!==undefined);
 const publishing:SourcePublishing|undefined=complete?{currency:currencies[0],variants:variants.map((v:any,i:number)=>({sku:v.sku,price:prices[i].price!,stock:v.stock!}))}:undefined;
 return {source,publishing};
}
@Injectable()
export class LocalizationShopProductsService{
 constructor(private platform:LocalizationPlatform,private localization:LocalizationService){}
 async list(ctx:LocalizationContext,shopId?:string,offset=0,pageSize=20){
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(pageSize)||pageSize<1||pageSize>50)throw new BadRequestException('分页参数无效');
  const shops=(await this.platform.shops(ctx)).filter(s=>s.status==='CONNECTED'&&(!shopId||s.id===shopId));if(shopId&&!shops.length)throw new BadRequestException('来源店铺未连接');
  const warnings:string[]=[];let hasMore=false,success=0;const items:any[]=[];
  // pageSize is a total budget: each connected shop receives at least one slot.
  const perShop=Math.max(1,Math.floor(pageSize/Math.max(1,shops.length)));
  for(const shop of shops){try{const list=payload(await this.platform.sourceRead(ctx,shop.id,'get_item_list',{offset:String(offset),page_size:String(perShop),item_status:'NORMAL'}));const ids=(list.item??list.item_list??[]).map((i:any)=>i.item_id);hasMore ||= !!list.has_next_page;if(ids.length){const base=payload(await this.platform.sourceRead(ctx,shop.id,'get_item_base_info',{item_id_list:ids.join(',')}));for(const item of base.item_list??[]){if(item.item_status&&item.item_status!=='NORMAL')continue;const p=price(item);items.push({key:`${shop.id}:${item.item_id}`,shopId:shop.id,shopName:shop.shopName,region:shop.region,itemId:String(item.item_id),title:item.item_name,image:item.image?.image_url_list?.[0]||'',status:item.item_status||'NORMAL',currency:p.currency||shop.currency,...(p.price===undefined?{}:{price:p.price}),...(stock(item)===undefined?{}:{stock:stock(item)})});}}success++;}catch{warnings.push(`${shop.shopName}商品读取失败，请稍后刷新或检查店铺授权`);}}
  if(shops.length&&!success)throw new BadGatewayException(warnings.join('；'));return {items,nextOffset:offset+perShop,hasMore,warnings};
 }
 async import(ctx:LocalizationContext,shopId:string,itemId:string){if(!/^[1-9]\d{0,19}$/.test(itemId))throw new BadRequestException('商品编号无效');const shop=(await this.platform.shops(ctx)).find(s=>s.id===shopId&&s.status==='CONNECTED');if(!shop)throw new BadRequestException('来源店铺未连接');const base=payload(await this.platform.sourceRead(ctx,shopId,'get_item_base_info',{item_id_list:itemId}));const item=base.item_list?.find((i:any)=>String(i.item_id)===itemId);if(!item||item.item_status!=='NORMAL')throw new BadRequestException('请选择来源店铺正在销售的商品');const models=item.has_model?payload(await this.platform.sourceRead(ctx,shopId,'get_model_list',{item_id:itemId})):{};if(item.has_model&&!models.model?.length)throw new BadRequestException('来源商品规格读取不完整，请重试');const snapshot=shopProductSnapshot(shop,item,models);const hash=createHash('sha256').update(JSON.stringify([ctx.owner,snapshot])).digest('hex');const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;let source=this.localization.engine.ensureImportedSource(ctx.owner,snapshot.source,id);if(snapshot.publishing)source=this.localization.engine.attachSourcePublishing(ctx.owner,id,snapshot.publishing);return source;}
}
@Controller('localization/shop-products')
@UseGuards(LocalizationGuard)
export class LocalizationShopProductsController{
 constructor(private service:LocalizationShopProductsService){}
 @Get() list(@Req() r:Request&{localization:LocalizationContext},@Query('shopId') shopId?:string,@Query('offset') offset='0',@Query('pageSize') pageSize='20'){return this.service.list(r.localization,shopId,Number(offset),Number(pageSize));}
 @Post(':shopId/:itemId/import') import(@Req() r:Request&{localization:LocalizationContext},@Param('shopId') shopId:string,@Param('itemId') itemId:string){return this.service.import(r.localization,shopId,itemId);}
}
