import {shopeeUploadImage} from './localization-image';
import {AsyncLocalStorage} from 'node:async_hooks';
import {supportedLanguages} from './localization-languages';
import {mediaUrls,mediaReferences,imageDimensions} from './localization-media';
import {Injectable,Optional,Controller,Post,Body,Param,Req,UseGuards,BadRequestException,BadGatewayException,ForbiddenException,ConflictException} from '@nestjs/common';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request as httpsRequest} from 'node:https';
import {TeamShopClient} from './team-client';
import {Database} from './database';
import {Shops} from './shops';
import {DevelopmentGuard} from './development';
import {AuthRequest} from './auth';
import {PlatformWriteError} from './shopee-client';
import {CreationRejectedError,RemoteReviewPendingError,LocalizationDraft,LocalizationTask,LocalizationPublisher,LocalizationShop,validateDraft} from './localization-engine';
import {imageMime} from './listing-engine';
import {isLocalLocalizationMode,localLocalizationShops} from './localization-development';
export type LocalizationContext={owner:string;sessionId?:string;userId?:string};
// Only a single preview shares these successful/in-flight reads. Later checks and writes stay live.
const ruleReads=new AsyncLocalStorage<Map<string,Promise<any>>>();
export function withMarketRuleSnapshot<T>(work:()=>Promise<T>):Promise<T>{return ruleReads.run(new Map(),work);}
async function ruleRead<T>(key:string,load:()=>Promise<T>):Promise<T>{
 const snapshot=ruleReads.getStore();if(!snapshot)return load();
 let pending=snapshot.get(key);if(!pending){pending=load();snapshot.set(key,pending);pending.catch(()=>{if(snapshot.get(key)===pending)snapshot.delete(key);});}
 return structuredClone(await pending);
}
export class MarketRuleReadError extends BadGatewayException{
 constructor(operation:string){const labels:Record<string,string>={get_category:'目标类目',get_attribute_tree:'商品属性',get_brand_list:'品牌资料',get_channel_list:'店铺物流',get_item_limit:'发布限制'};super(`${labels[operation]||'市场规则'}读取暂时失败，已保存的资料未丢失，请重新检查。`);}
}
const markets:Record<string,{currency:string;language:string}>={PH:{currency:'PHP',language:'English'},SG:{currency:'SGD',language:'English'},MY:{currency:'MYR',language:'Bahasa Melayu'},TH:{currency:'THB',language:'ไทย'},VN:{currency:'VND',language:'Tiếng Việt'},TW:{currency:'TWD',language:'繁體中文'},ID:{currency:'IDR',language:'Bahasa Indonesia'},BR:{currency:'BRL',language:'Português'},MX:{currency:'MXN',language:'Español'},CO:{currency:'COP',language:'Español'},CL:{currency:'CLP',language:'Español'}};
const record=(x:unknown):Record<string,any>=>x&&typeof x==='object'?x as Record<string,any>:{};
function attributeRows(payload:unknown,categoryId?:number):any[]{
 const p=record(payload);let rows:any[]=[];
 if(Array.isArray(p.list)){const category=p.list.find((x:any)=>x.category_id===categoryId);rows=Array.isArray(category?.attribute_tree)?category.attribute_tree:[];}
 else if(Array.isArray(p.attribute_list))rows=p.attribute_list;
 else if(Array.isArray(p.attribute_tree)){const category=p.attribute_tree.find((x:any)=>x.category_id===categoryId);rows=Array.isArray(category?.attribute_list)?category.attribute_list:[];}
 return rows.map(x=>({...x,attribute_name:x.name||x.attribute_name,is_mandatory:typeof x.mandatory==='boolean'?x.mandatory:!!x.is_mandatory,attribute_value_list:(Array.isArray(x.attribute_value_list)?x.attribute_value_list:[]).map((v:any)=>({...v,original_value_name:v.name||v.original_value_name}))}));
}
export function safePublicAddress(ip:string){
 if(isIP(ip)===6)return /^[23]/i.test(ip)&&!/^2001:(db8|0|2|10|20):/i.test(ip)&&!/^2002:/i.test(ip);
 const [a,b,c]=ip.split('.').map(Number);
 return isIP(ip)===4&&a!==0&&a!==10&&a!==127&&a<224&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||b===0||b===88&&c===99))&&!(a===100&&b>=64&&b<=127)&&!(a===198&&(b===18||b===19||b===51&&c===100))&&!(a===203&&b===0&&c===113);
}
/** Resolve once, then pin the checked address to avoid DNS rebinding and reject all redirects. */
export async function localizationImage(url:string):Promise<Buffer>{
 let u:URL;try{u=new URL(url);}catch{throw new BadRequestException('图片地址无效');}if(u.protocol!=='https:'||u.username||u.password||u.port||u.hostname==='localhost')throw new BadRequestException('图片需为公开 HTTPS 地址');
 const addresses=await lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(x=>!safePublicAddress(x.address)))throw new BadRequestException('图片地址不能访问内网');const chosen=addresses[0];
 return new Promise((resolveImage,reject)=>{const req=httpsRequest(u,{method:'GET',...{autoSelectFamily:false},lookup:(_host,_options,callback)=>callback(null,chosen.address,chosen.family),timeout:20000},res=>{if(res.statusCode!==200){res.resume();reject(new BadRequestException('图片下载失败或发生跳转'));return;}let size=0;const chunks:Buffer[]=[];res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>8*1024*1024){req.destroy();reject(new BadRequestException('图片超过8MB'));}else chunks.push(chunk);});res.on('end',()=>{const data=Buffer.concat(chunks);if(!imageMime(data))reject(new BadRequestException('图片仅支持 PNG、JPEG、WebP'));else resolveImage(data);});res.on('error',()=>reject(new BadRequestException('图片下载中断')));});req.on('timeout',()=>req.destroy());req.on('error',()=>reject(new BadRequestException('图片下载未完成')));req.end();});
}
@Injectable()
export class LocalizationPlatform{
 private metadataPending=new Map<string,Promise<any>>();
 private metadataCache=new Map<string,{expires:number;value:any}>();
 private metadataKey(ctx:LocalizationContext,id:string,categoryId?:number,language='en'){return createHash('sha256').update(JSON.stringify([ctx.owner,ctx.sessionId,ctx.userId,id,categoryId,language])).digest('hex');}
 private dir=resolve(process.env.LOCALIZATION_DATA_DIR||'.local/localization','remote-receipts');private active=new Set<string>();
 constructor(@Optional() private team?:TeamShopClient,@Optional() private db?:Database,@Optional() private shopsService?:Shops){mkdirSync(this.dir,{recursive:true,mode:0o700});}
 async shops(ctx:LocalizationContext):Promise<(LocalizationShop&{status:string;supportedLanguages?:string[]})[]>{if(isLocalLocalizationMode()&&!this.team)return localLocalizationShops.map(s=>({...s}));const rows=this.team?await this.team.shops(ctx.sessionId!):await this.db!.shopConnection.findMany({select:{id:true,shopId:true,shopName:true,region:true,status:true},orderBy:{authorizedAt:'desc'}});return rows.map((s:any)=>({...s,shopName:s.shopName||s.shopId,...markets[s.region],supportedLanguages:supportedLanguages(markets[s.region]?.language||'',s.region)}));}
 private async central(ctx:LocalizationContext,id:string){if(!ctx.userId||!this.db||!this.shopsService)throw new ForbiddenException('请登录中央服务');const c=await this.db.shopConnection.findUnique({where:{id}});if(!c||c.status!=='CONNECTED')throw new ConflictException('目标店铺尚未连接或需要重新验证');return c;}
 private read(ctx:LocalizationContext,id:string,op:string,q:Record<string,string>={}){return ruleRead(JSON.stringify([this.metadataKey(ctx,id),op,Object.entries(q).sort(([a],[b])=>a.localeCompare(b))]),async()=>{try{return this.team?await this.team.read(ctx.sessionId!,id,op,q):await this.shopsService!.read(id,ctx.userId!,`/api/v2/${op==='get_channel_list'?'logistics':op==='get_shop_info'?'shop':'product'}/${op}`,q);}catch(e){const status=(e as {getStatus?:()=>number})?.getStatus?.();if(status===401||status===403)throw e;throw new MarketRuleReadError(op);}});}
 async capabilities(ctx:LocalizationContext,id:string){if(isLocalLocalizationMode())return {path:'product' as const,issues:['本地联调允许读取真实市场资料；商品写入与发布已禁用。'],writePermission:'unavailable',note:'市场读取成功不代表已验证发布资格。'};if(this.team)return this.team.localization(ctx.sessionId!,id,'capabilities');await this.central(ctx,id);const info=record(await this.read(ctx,id,'get_shop_info'));const issues:string[]=[];let path:'product'|'global_product'='product';if(info.is_cb===true){path='global_product';issues.push('跨境店铺需要核对 CNSC 与商家级授权；当前授权链路未提供 merchant 凭据，暂不能发布全球商品');}else if(info.is_cb!==false)issues.push('平台未明确返回店铺类型，无法安全确定商品发布路径，请管理员核对店铺资格');return {path,issues,writePermission:'unverified',note:'读取成功不代表拥有商品写入权限；真实写权限以运营确认发布后的平台结果为准'};}
 private async metadataContext(ctx:LocalizationContext):Promise<LocalizationContext>{
  if(this.team||ctx.userId)return ctx;
  if(!this.db)throw new ForbiddenException('市场资料读取缺少服务端身份');
  const user=await this.db.user.findUnique({where:{email:ctx.owner},select:{id:true,role:true}});
  if(!user||user.role!=='ADMIN')throw new ForbiddenException('接入账号没有市场资料读取权限');
  return {...ctx,userId:user.id};
 }
 private async allBrands(ctx:LocalizationContext,id:string,categoryId:number):Promise<any>{
  const brands:any[]=[];let first:Record<string,any>|undefined,offset=0;
  for(let page=0;page<3;page++){
   const data=record(await this.read(ctx,id,'get_brand_list',{category_id:String(categoryId),offset:String(offset),page_size:'100',status:'1'}));
   if(!Array.isArray(data.brand_list)||data.has_next_page!==undefined&&typeof data.has_next_page!=='boolean')throw new BadRequestException('目标品牌候选返回不完整，请稍后重新读取');
   first??=data;brands.push(...data.brand_list);
   if(data.has_next_page!==true)return {...first,brand_list:[...new Map(brands.map(b=>[b.brand_id,b])).values()],...(first?.has_next_page!==undefined?{has_next_page:false}:{})};
   if(!data.brand_list.length)throw new BadRequestException('目标品牌分页没有返回有效候选，不能确认完整品牌范围');
   const next=data.next_offset??offset+data.brand_list.length;
   if(!Number.isSafeInteger(next)||next<=offset)throw new BadRequestException('目标品牌分页位置无效，请稍后重新读取');
   offset=next;
  }
  return {...first,brand_list:[...new Map(brands.map(b=>[b.brand_id,b])).values()],has_next_page:true,candidatesIncomplete:true};
 }
 async rawMetadata(ctx:LocalizationContext,id:string,categoryId?:number,language='en'){
  const key=this.metadataKey(ctx,id,categoryId,language);let pending=this.metadataPending.get(key);
  if(!pending){pending=this.fetchRawMetadata(ctx,id,categoryId,language).finally(()=>this.metadataPending.delete(key));this.metadataPending.set(key,pending);}
  return structuredClone(await pending);
 }
 private async fetchRawMetadata(ctx:LocalizationContext,id:string,categoryId?:number,language='en'){
  if(isLocalLocalizationMode()&&localLocalizationShops.some(s=>s.id===id)){return {categories:{category_list:[]},attributes:null,brands:null,logistics:{logistics_channel_list:[]},limits:{},capabilities:await this.capabilities(ctx,id),categoryId:categoryId||null,connectionId:id,fetchedAt:new Date().toISOString()};}
  ctx=await this.metadataContext(ctx);
  const shops=await this.shops(ctx);if(!shops.some(s=>s.id===id&&s.status==='CONNECTED'))throw new ForbiddenException('目标店铺不可用');
  // Category-dependent rules do not depend on downloading the entire category tree.
  // Keep attributes before brand pagination so an attribute failure stops extra requests.
  const [[categories,logistics,limits,capabilities],{attributes,brands}]=await Promise.all([
   Promise.all([this.read(ctx,id,'get_category',{language}),this.read(ctx,id,'get_channel_list'),this.read(ctx,id,'get_item_limit'),this.capabilities(ctx,id).catch(()=>({path:'product',issues:['中央服务尚未开放或未能确认发布资格；可继续准备草稿，暂不能发布'],writePermission:'unverified'}))]),
   (async()=>{const attributes=categoryId?await this.read(ctx,id,'get_attribute_tree',{[this.team?'category_id':'category_id_list']:String(categoryId),language}):null;const brands=categoryId?await this.allBrands(ctx,id,categoryId):null;return {attributes,brands};})()
  ]);
  return {categories,attributes,brands,logistics,limits,capabilities,categoryId:categoryId||null,connectionId:id,fetchedAt:new Date().toISOString()};
 }
 async metadata(ctx:LocalizationContext,id:string,categoryId?:number,language='en'){
  // Display cache only. Publishing validation continues to use rawMetadata and current shop rules.
  const key=this.metadataKey(ctx,id,categoryId,language),cached=this.metadataCache.get(key);
  if(cached&&cached.expires>Date.now()){
   ctx=await this.metadataContext(ctx);const shops=await this.shops(ctx);if(!shops.some(s=>s.id===id&&s.status==='CONNECTED'))throw new ForbiddenException('目标店铺不可用');
   return structuredClone(cached.value);
  }
  const raw=await this.rawMetadata(ctx,id,categoryId,language),value=this.metadataResult(raw,categoryId);
  if(this.metadataCache.size>=100)this.metadataCache.delete(this.metadataCache.keys().next().value!);
  this.metadataCache.set(key,{expires:Date.now()+300000,value:structuredClone(value)});return value;
 }
 private metadataResult(raw:any,categoryId?:number){const caps=record(raw.capabilities);
  return {...(raw.brands?.candidatesIncomplete?{warnings:['品牌候选较多，本次仅读取前3页；未命中的品牌不能视为目标类目不支持。']}:{ }),categories:(record(raw.categories).category_list||[]).map((x:any)=>({id:x.category_id,name:x.display_category_name||x.original_category_name||String(x.category_id),parentId:x.parent_category_id,hasChildren:x.has_children})),brands:(record(raw.brands).brand_list||[]).map((x:any)=>({id:x.brand_id,name:x.display_brand_name||x.original_brand_name||String(x.brand_id)})),attributes:attributeRows(raw.attributes,categoryId).map((x:any)=>({id:x.attribute_id,name:x.display_attribute_name||x.original_attribute_name||x.attribute_name||String(x.attribute_id),required:!!x.is_mandatory,values:(x.attribute_value_list||[]).map((v:any)=>({id:v.value_id,value:v.display_value_name||v.original_value_name||String(v.value_id)}))})),logistics:(record(raw.logistics).logistics_channel_list||[]).map((x:any)=>({id:x.logistics_channel_id,name:x.logistics_channel_name||String(x.logistics_channel_id),enabled:x.enabled})),limits:raw.limits,capability:{path:caps.path,reason:caps.issues?.join('；')||caps.note},capabilities:caps,fetchedAt:raw.fetchedAt};
 }
 async requirements(ctx:LocalizationContext,id:string,categoryId?:number){const raw=await this.rawMetadata(ctx,id,categoryId);return {...this.metadataResult(raw,categoryId),connectionId:id,categoryId:categoryId??null,rules:{attributes:raw.attributes,brands:raw.brands,logistics:raw.logistics,limits:raw.limits},support:{path:'product',unsupportedFeatures:['global_product','tax_info','complaint_policy','size_chart','multi_warehouse_discovery','attribute_dependencies']}};}
 private call(ctx:LocalizationContext,id:string,operation:string,body:unknown){return this.team?this.team.localization(ctx.sessionId!,id,operation,body):this.operation(ctx,id,operation,body);}
 private async imageBytes(ctx:LocalizationContext,shopId:string,url:string,loadImage?:(url:string)=>Promise<Buffer>){
  if(url.startsWith('/api/v1/localization/assets/')&&loadImage)return loadImage(url);
  if(!this.team)return localizationImage(url);
  // Resolve and pin public DNS at the trusted server, never whitelist local proxy Fake-IP ranges.
  const result=record(await this.call(ctx,shopId,'download_image',{url}));
  if(typeof result.data!=='string'||result.data.length>12*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(result.data))throw new BadRequestException('服务端未返回有效图片');
  const bytes=Buffer.from(result.data,'base64');if(bytes.length>8*1024*1024||!imageMime(bytes))throw new BadRequestException('服务端图片格式或大小无效');return bytes;
 }
 publisher(ctx:LocalizationContext,loadImage?:(url:string)=>Promise<Buffer>):LocalizationPublisher{return {
  capabilities:d=>this.capabilities(ctx,d.shop.id),
  prepare:async(d,t,checkpoint)=>{const old=record(t.prepared),urls=mediaUrls(d.media,d.images),same=JSON.stringify(old.imageRefs)===JSON.stringify(urls),imageIds:string[]=same&&Array.isArray(old.imageIds)?[...old.imageIds]:[],imageSizes:Record<string,{width:number;height:number}>=same?{...record(old.imageSizes)}:{};const details=new Set(mediaReferences(d.media,d.images).details.filter(x=>x.type==='image').map(x=>x.url));const limit=details.size?record(record(await this.read(ctx,d.shop.id,'get_item_limit')).extended_description_limit):{};
   const check=(size:{width:number;height:number}|undefined)=>{if(!size)throw new BadRequestException('无法读取详情图尺寸，请重新上传有效图片');const ratio=size.width/size.height;if(typeof limit.description_image_width_min==='number'&&size.width<limit.description_image_width_min||typeof limit.description_image_height_min==='number'&&size.height<limit.description_image_height_min||typeof limit.description_image_aspect_ratio_min==='number'&&ratio<limit.description_image_aspect_ratio_min||typeof limit.description_image_aspect_ratio_max==='number'&&ratio>limit.description_image_aspect_ratio_max)throw new BadRequestException('详情图片的宽高或比例不符合目标市场要求，请调整图片');};
   for(const [index,url] of urls.entries()){if(index<imageIds.length&&(!details.has(url)||imageSizes[url])){if(details.has(url))check(imageSizes[url]);continue;}const data=await this.imageBytes(ctx,d.shop.id,url,loadImage);if(details.has(url)){const size=imageDimensions(data);check(size);imageSizes[url]=size!;}if(index>=imageIds.length){const result=record(await this.call(ctx,d.shop.id,'upload',{data:data.toString('base64')}));if(typeof result.imageId!=='string')throw Error('图片上传结果无效');imageIds.push(result.imageId);}checkpoint?.({imageIds:[...imageIds],imageRefs:urls,imageSizes});}return {imageIds,imageRefs:urls,imageSizes};},
  create:async(d,t)=>{try{const result=await this.call(ctx,d.shop.id,'create',{draft:d,marker:t.marker,prepared:t.prepared});if(result.rejected)throw new CreationRejectedError(result.message);return result;}catch(e){if(e instanceof PlatformWriteError&&!e.uncertain)throw new CreationRejectedError(e.message);throw e;}},
  complete:async(d,t)=>{
   const readStatus=async()=>{const data=record(await this.read(ctx,d.shop.id,'get_item_base_info',{item_id_list:t.remoteId!}));const item=(data.item_list||[]).find((item:any)=>String(item.item_id)===t.remoteId);if(!item||item.item_sku!==t.marker)throw new ConflictException('远端商品与当前任务不匹配，请核对商品编号');return item.item_status;};
   if(this.team){const status=await readStatus();if(status==='REVIEWING')throw new RemoteReviewPendingError();if(status==='NORMAL'&&!d.specificationNames.length)return;}
   try{await this.call(ctx,d.shop.id,'complete',{draft:d,marker:t.marker,remoteId:t.remoteId,prepared:t.prepared});}
   catch(error){if(this.team){let status:string|undefined;try{status=await readStatus();}catch{/* Keep the original completion error when readback is unavailable. */}if(status==='REVIEWING')throw new RemoteReviewPendingError();}throw error;}
   if(this.team){const status=await readStatus();if(status==='REVIEWING')throw new RemoteReviewPendingError();if(status!=='NORMAL')throw new BadRequestException('商品已创建，上架结果尚未确认，请继续核对原任务');}
  },
  reconcile:(d,t)=>this.call(ctx,d.shop.id,'reconcile',{marker:t.marker})
 };}
 async operation(ctx:LocalizationContext,id:string,operation:string,raw:unknown):Promise<any>{if(isLocalLocalizationMode())throw new ForbiddenException('本地模拟模式不允许调用 Shopee 商品写入接口');await this.central(ctx,id);const b=record(raw);if(operation==='capabilities')return this.capabilities(ctx,id);if(operation==='download_image'){if(typeof b.url!=='string'||b.url.length>4000)throw new BadRequestException('图片地址无效');const data=await localizationImage(b.url);return {data:data.toString('base64')};}if(operation==='upload'){
  if(typeof b.data!=='string'||b.data.length>12*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(b.data))throw new BadRequestException('图片内容无效');const bytes=Buffer.from(b.data,'base64'),mime=imageMime(bytes);if(!mime||bytes.length>8*1024*1024)throw new BadRequestException('图片格式或大小无效');const upload=await shopeeUploadImage(bytes);const form=new FormData();form.set('image',new Blob([new Uint8Array(upload.bytes)],{type:upload.mime}),upload.filename);const r=record(await this.shopsService!.write(id,ctx.userId!,'/api/v2/media_space/upload_image',form));const imageId=r.image_info?.image_id||r.image_info_list?.[0]?.image_info?.image_id;if(typeof imageId!=='string')throw new BadRequestException('平台未返回图片标识');return {imageId};
 }
 if(!['create','complete','save_variations','reconcile'].includes(operation)||typeof b.marker!=='string'||!/^LOC-[a-f0-9-]{36}$/.test(b.marker))throw new BadRequestException('商品操作无效');
 const key=createHash('sha256').update(JSON.stringify([ctx.owner,id,b.marker])).digest('hex'),file=join(this.dir,key+'.json');const receipt=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null;
 const save=(value:unknown)=>{const tmp=file+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(value),{mode:0o600});renameSync(tmp,file);};
 if(operation==='reconcile'){
  if(receipt?.remoteId)return {status:'found',remoteId:receipt.remoteId};
  // A negative paged search cannot prove that a timed-out creation did not happen.
  for(const status of ['NORMAL','UNLIST']){let offset=0;for(let page=0;page<10;page++){const list=record(await this.read(ctx,id,'get_item_list',{item_status:status,offset:String(offset),page_size:'100'}));const ids=(list.item||[]).map((x:any)=>x.item_id).filter((x:any)=>Number.isSafeInteger(x));for(let start=0;start<ids.length;start+=50){const data=record(await this.read(ctx,id,'get_item_base_info',{item_id_list:ids.slice(start,start+50).join(',')}));const match=(data.item_list||[]).filter((x:any)=>x.item_sku===b.marker);if(match.length===1){save({...receipt,remoteId:String(match[0].item_id),status:'created'});return {status:'found',remoteId:String(match[0].item_id)};}if(match.length>1)return {status:'unknown'};}if(!list.has_next_page)break;offset=list.next_offset;if(!Number.isSafeInteger(offset))break;}}
  return {status:'unknown'};
 }
 const d=b.draft as LocalizationDraft;if(!d||d.shop?.id!==id||d.owner!==ctx.owner)throw new BadRequestException('商品与目标店铺不匹配');
 if(operation==='create'){
  if(receipt?.remoteId)return {remoteId:receipt.remoteId};if(receipt&&receipt.status!=='rejected')throw new ConflictException('此前创建结果待核对，禁止重复创建');if(this.active.has(key))throw new ConflictException('商品正在创建');this.active.add(key);let hasLock=false;const lock=file+'.lock';
  try{try{writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});hasLock=true;}catch{throw new ConflictException('商品创建锁尚未释放，请先核对远端结果');}const caps=await this.capabilities(ctx,id);if(caps.issues.length)throw new PlatformWriteError(false,caps.issues.join('；'));const issues=[...validateDraft(d),...await this.validateMarket(ctx,id,d)];if(issues.length)throw new PlatformWriteError(false,issues.join('；'));const payload=productPayload(d,b.marker,record(b.prepared).imageIds);save({marker:b.marker,status:'creating',createdAt:new Date().toISOString()});let result:Record<string,any>;try{result=record(await this.shopsService!.write(id,ctx.userId!,'/api/v2/product/add_item',payload));}catch(e){if(e instanceof PlatformWriteError&&!e.uncertain)save({marker:b.marker,status:'rejected'});throw e;}const remoteId=result.item_id||result.item?.item_id;if(!Number.isSafeInteger(remoteId)||remoteId<=0)throw new PlatformWriteError(true,'平台未返回有效商品ID');save({marker:b.marker,remoteId:String(remoteId),status:'created',createdAt:new Date().toISOString()});await this.shopsService!.audit(ctx.userId!,'LOCALIZATION_CREATE',`${id}:${remoteId}`,'SUCCESS');return {remoteId:String(remoteId)};}catch(e){if(e instanceof PlatformWriteError&&!e.uncertain)return {rejected:true,message:e.reason,diagnostic:e.diagnostic};throw e;}finally{if(hasLock)unlinkSync(lock);this.active.delete(key);}
 }
 if(!receipt?.remoteId||receipt.remoteId!==b.remoteId)throw new ForbiddenException('只能继续本工具已创建的商品');
 const lock=file+'.variations.lock';if(this.active.has(key))throw new ConflictException('商品后续操作正在进行，请稍后查询');this.active.add(key);let hasLock=false;
 try{
  try{writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});hasLock=true;}catch{throw new ConflictException('规格保存锁尚未释放，请先核对远端结果');}
  if(operation==='complete'&&await this.remoteItemStatus(ctx,id,b.remoteId)==='REVIEWING')throw new RemoteReviewPendingError();
  if(operation==='save_variations')await this.assertUnlisted(ctx,id,b.remoteId);
  await this.ensureVariations(ctx,id,d,b.remoteId,record(b.prepared).imageIds,receipt,save);
  if(operation==='save_variations'){await this.assertUnlisted(ctx,id,b.remoteId);save({...receipt,status:'variants_saved'});return {ok:true,remoteId:b.remoteId,itemStatus:'UNLIST'};}
  // Recover a lost completion response by reading this task's existing item before writing again.
  const status=await this.remoteItemStatus(ctx,id,b.remoteId);
  if(status==='NORMAL'){save({...receipt,status:'completed'});return {ok:true};}
  if(status!=='UNLIST')throw new ConflictException('商品已创建，当前远端状态尚不可上架，请稍后核对原任务');
  // Only the explicit complete operation may publish after every variant is verified.
  const published=record(await this.shopsService!.write(id,ctx.userId!,'/api/v2/product/unlist_item',{item_list:[{item_id:Number(b.remoteId),unlist:false}]}));if((published.failure_list||[]).length||!(published.success_list||[]).some((x:any)=>(typeof x==='number'?x:x.item_id)===Number(b.remoteId)))throw new ConflictException('商品已创建，但上架结果未确认；请继续核对');const finalStatus=await this.remoteItemStatus(ctx,id,b.remoteId);if(finalStatus==='REVIEWING')throw new RemoteReviewPendingError();if(finalStatus!=='NORMAL')throw new ConflictException('商品已创建，上架请求已提交，等待平台确认；请继续核对原任务');save({...receipt,status:'completed'});return {ok:true};
 }finally{if(hasLock)unlinkSync(lock);this.active.delete(key);}
 }
 private async remoteItemStatus(ctx:LocalizationContext,id:string,remoteId:string){const data=record(await this.read(ctx,id,'get_item_base_info',{item_id_list:remoteId}));return (Array.isArray(data.item_list)?data.item_list:[]).find((item:any)=>String(item.item_id)===remoteId)?.item_status;}
 async taskStatus(ctx:LocalizationContext,draft:LocalizationDraft,task:LocalizationTask){const data=record(await this.read(ctx,draft.shop.id,'get_item_base_info',{item_id_list:task.remoteId!}));const item=(data.item_list||[]).find((item:any)=>String(item.item_id)===task.remoteId);if(!item||item.item_sku!==task.marker)throw new ConflictException('远端商品与当前任务不匹配，请核对商品编号');return String(item.item_status||'UNKNOWN');}
 private async assertUnlisted(ctx:LocalizationContext,id:string,remoteId:string){const data=record(await this.read(ctx,id,'get_item_base_info',{item_id_list:remoteId}));const item=(Array.isArray(data.item_list)?data.item_list:[]).find((x:any)=>String(x.item_id)===remoteId);if(item?.item_status!=='UNLIST')throw new ConflictException('只能保存本工具已创建且仍未上架的商品；请核对远端状态，禁止修改在售商品');}
 private async ensureVariations(ctx:LocalizationContext,id:string,d:LocalizationDraft,remoteId:string,imageIds:unknown,receipt:Record<string,any>,save:(value:unknown)=>void){
  if(!d.specificationNames.length)return;
  const expected=variationPayload(d,Number(remoteId),imageIds),fingerprint=createHash('sha256').update(JSON.stringify(expected)).digest('hex');
  const prior=record(receipt.variations);if(prior.fingerprint&&prior.fingerprint!==fingerprint&&prior.status!=='rejected')throw new ConflictException('此前规格保存资料不同，请先核对远端规格，不能覆盖或重复初始化');
  const checkpoint=(status:string,diagnostic?:unknown)=>{receipt.variations={status,fingerprint,...(diagnostic?{diagnostic}:{} )};save(receipt);};
  const readModels=async()=>record(await this.read(ctx,id,'get_model_list',{item_id:remoteId}));
  const initialized=(value:Record<string,any>)=>[value.tier_variation,value.standardise_tier_variation].some(x=>Array.isArray(x)&&x.length>0)||(Array.isArray(value.model)&&value.model.some((m:any)=>Array.isArray(m.tier_index)&&m.tier_index.length>0));
  const complete=(value:Record<string,any>)=>{const models=Array.isArray(value.model)?value.model:[];return models.length===expected.model.length&&expected.model.every(v=>models.some((m:any)=>{
   if(m.model_sku!==v.model_sku||JSON.stringify(m.tier_index)!==JSON.stringify(v.tier_index))return false;
   const price=Array.isArray(m.price_info)?m.price_info[0]:m.price_info,amount=price?.original_price??m.original_price;if(typeof amount==='number'&&Math.abs(amount-Number(v.original_price))>0.000001)return false;
   const stock=Array.isArray(m.seller_stock)?m.seller_stock:Array.isArray(m.stock_info_v2?.seller_stock)?m.stock_info_v2.seller_stock:Array.isArray(m.stock_info)?m.stock_info:undefined;
   if(stock&&stock.length&&stock.every((x:any)=>typeof (x.stock??x.normal_stock)==='number')&&stock.reduce((n:number,x:any)=>n+(x.stock??x.normal_stock),0)!==v.seller_stock[0].stock)return false;
   return true;
  }));};
  let existing=await readModels();
  if(!initialized(existing)){
   if(['initializing','awaiting_readback','uncertain','verified'].includes(prior.status))throw new ConflictException('规格初始化结果尚未明确，请稍后再次查询，禁止重复初始化');
   await this.assertUnlisted(ctx,id,remoteId);checkpoint('initializing');
   try{await this.shopsService!.write(id,ctx.userId!,'/api/v2/product/init_tier_variation',expected);checkpoint('awaiting_readback');}
   catch(e){if(e instanceof PlatformWriteError&&!e.uncertain){checkpoint('rejected',e.diagnostic);throw e;}checkpoint('uncertain',e instanceof PlatformWriteError?e.diagnostic:undefined);try{existing=await readModels();}catch{throw e;}if(complete(existing)){checkpoint('verified');return;}throw e;}
   existing=await readModels();
  }
  if(!complete(existing)){checkpoint('uncertain');throw new ConflictException('商品已创建，但规格、售价或库存尚未完整匹配；请继续核对，不能重新初始化或创建商品');}
  checkpoint('verified');
 }
 async validateMarket(ctx:LocalizationContext,id:string,d:LocalizationDraft){const m=await this.rawMetadata(ctx,id,d.categoryId||undefined);const issues:string[]=[];const categories=record(m.categories).category_list||[];if(!categories.some((c:any)=>c.category_id===d.categoryId&&!c.has_children))issues.push('请选择目标市场可发布的末级类目');const channels=record(m.logistics).logistics_channel_list||[];for(const l of d.logistics.filter(x=>x.enabled)){const c=channels.find((x:any)=>x.logistics_channel_id===l.id&&x.enabled!==false);if(!c){issues.push('所选物流在目标店铺不可用');continue;}
 if(c.fee_type==='SIZE_SELECTION'&&l.sizeId===undefined)issues.push(`物流 ${l.id} 缺少 sizeId`);
 if(c.fee_type==='CUSTOM_PRICE'&&l.shippingFee===undefined)issues.push(`物流 ${l.id} 缺少 shippingFee`);
 const sizes=Array.isArray(c.size_list)?c.size_list:[];if(l.sizeId!==undefined&&sizes.length&&!sizes.some((x:any)=>x.size_id===l.sizeId))issues.push(`物流 ${l.id} 的 sizeId 不属于目标渠道`);
 const weight=record(c.weight_limit),positive=(v:any):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
 const weightKnown=typeof d.weightKg==='number'&&Number.isFinite(d.weightKg)&&d.weightKg>0;
 if((positive(weight.item_min_weight)||positive(weight.item_max_weight))&&!weightKnown)issues.push(`物流 ${l.id} 需填写重量以核对渠道限制`);
 if(weightKnown&&(positive(weight.item_min_weight)&&d.weightKg!<weight.item_min_weight||positive(weight.item_max_weight)&&d.weightKg!>weight.item_max_weight))issues.push(`物流 ${l.id} 的包裹重量超出范围`);
 const maximum=record(c.item_max_dimension),minimum=record(c.item_min_dimension),keys=['length','width','height'] as const;
 const dimensionsKnown=keys.every(k=>typeof d.dimensionsCm[k]==='number'&&Number(d.dimensionsCm[k])>0),hasDimensionsLimit=[maximum,minimum].some(v=>[...keys,'dimension_sum'].some(k=>positive(v[k]??v['max_'+k])));
 if(hasDimensionsLimit&&!dimensionsKnown)issues.push(`物流 ${l.id} 需填写长宽高以核对尺寸限制`);
 for(const [limit,kind] of [[maximum,'max'],[minimum,'min']] as const){
  if([...keys,'dimension_sum'].some(k=>positive(limit[k]??limit[kind+'_'+k]))&&limit.unit!==undefined&&String(limit.unit).toLowerCase()!=='cm')issues.push(`物流 ${l.id} 的尺寸限制单位尚未适配`);
  if(!dimensionsKnown)continue;
  for(const key of keys){const bound=limit[key]??limit[kind+'_'+key];if(positive(bound)&&(kind==='max'?Number(d.dimensionsCm[key])>bound:Number(d.dimensionsCm[key])<bound))issues.push(`物流 ${l.id} 的包裹尺寸超出范围`);}
  const sum=keys.reduce((n,k)=>n+Number(d.dimensionsCm[k]),0);if(positive(limit.dimension_sum)&&(kind==='max'?sum>limit.dimension_sum:sum<limit.dimension_sum))issues.push(`物流 ${l.id} 的包裹三边和超出范围`);
 }
 const volume=record(c.volume_limit);if(positive(volume.item_min_volume)||positive(volume.item_max_volume)){
  const unit=String(volume.unit||'').toLowerCase(),factor=unit==='cm3'||unit==='cm³'?1:unit==='m3'||unit==='m³'?1000000:null;
  if(factor===null)issues.push(`物流 ${l.id} 的体积限制单位尚未确认`);
  else if(!dimensionsKnown)issues.push(`物流 ${l.id} 需填写长宽高以核对体积限制`);
  else{const amount=Number(d.dimensionsCm.length)*Number(d.dimensionsCm.width)*Number(d.dimensionsCm.height)/factor;if(positive(volume.item_min_volume)&&amount<volume.item_min_volume||positive(volume.item_max_volume)&&amount>volume.item_max_volume)issues.push(`物流 ${l.id} 的包裹体积超出范围`);}
 }

 }const brands=record(m.brands).brand_list||[];if(!brands.some((x:any)=>x.brand_id===d.brandId))issues.push(record(m.brands).candidatesIncomplete?'品牌候选尚未读取完整，暂不能确认所选品牌':'所选品牌不属于目标市场类目候选');const limits=record(m.limits);if(record(limits.weight_limit).weight_mandatory===true&&(!Number.isFinite(d.weightKg)||Number(d.weightKg)<=0))issues.push('目标店铺必填：包裹重量 weightKg');if(record(limits.dimension_limit).dimension_mandatory===true&&!Object.values(d.dimensionsCm).every(x=>typeof x==='number'&&x>0))issues.push('目标店铺必填：包裹长宽高 dimensionsCm');for(const [key,value] of [['item_name_length_limit',[...d.title].length],['item_description_length_limit',plainDescription(d).length],['item_image_count_limit',d.images.length]] as const){const limit=record(limits[key]);if(typeof limit.min_limit==='number'&&value<limit.min_limit||typeof limit.max_limit==='number'&&value>limit.max_limit)issues.push(`${key==='item_name_length_limit'?'商品标题字数':key==='item_description_length_limit'?'商品描述字数':'商品图片数量'}：当前 ${value}，店铺要求 ${limit.min_limit??0}–${limit.max_limit??'不限'}`);}
 const outside=(key:string,value:number)=>{const range=record(limits[key]);return typeof range.min_limit==='number'&&value<range.min_limit||typeof range.max_limit==='number'&&value>range.max_limit;};
 for(const variant of d.variants){if(outside('price_limit',Number(variant.price)))issues.push(`SKU ${variant.sku} 的最终售价超出目标市场范围`);if(outside('stock_limit',Number(variant.stock)))issues.push(`SKU ${variant.sku} 的库存超出目标市场范围`);for(const option of variant.options)if(outside('tier_variation_option_length_limit',[...option].length))issues.push('规格选项文字长度不符合目标市场限制');}
 for(const name of d.specificationNames)if(outside('tier_variation_name_length_limit',[...name].length))issues.push('规格名称长度不符合目标市场限制');
 if(outside('weight_limit',Number(d.weightKg)))issues.push('包裹重量超出目标市场范围');
 const details=mediaReferences(d.media,d.images).details;if(details.some(b=>b.type==='image')){const lim=record(limits.extended_description_limit),texts=[...d.sellingPoints,d.description,...details.filter(x=>x.type==='text').map(x=>x.text)].join('\n\n'),count=details.filter(x=>x.type==='image').length;if(typeof lim.description_text_length_min==='number'&&texts.length<lim.description_text_length_min||typeof lim.description_text_length_max==='number'&&texts.length>lim.description_text_length_max)issues.push('图文详情文字总长度不符合目标市场限制');if(typeof lim.description_image_num_min==='number'&&count<lim.description_image_num_min||typeof lim.description_image_num_max==='number'&&count>lim.description_image_num_max)issues.push('图文详情图片数量不符合目标市场限制');}
 const gtin=typeof limits.gtin_validation_rule==='string'?limits.gtin_validation_rule.toLowerCase():undefined;
 for(const v of d.variants){if(gtin==='mandatory'&&(!v.gtinCode||v.gtinCode==='00')||gtin==='flexible'&&!v.gtinCode)issues.push(`SKU ${v.sku} 缺少目标市场要求的 GTIN`);if(v.gtinCode&&v.gtinCode!=='00'&&!validGtin(v.gtinCode))issues.push(`SKU ${v.sku} 的 GTIN 长度或校验位无效`);}
 if(limits.gtin_validation_rule!==undefined&&!['optional','mandatory','flexible'].includes(gtin||''))issues.push('目标GTIN规则尚未适配，不能确认发布资料完整');

 if(d.preOrder?.isPreOrder&&d.preOrder.daysToShip===undefined)issues.push('预售商品缺少 daysToShip');const dts=record(limits.dts_limit);if(d.preOrder?.isPreOrder&&d.preOrder.daysToShip!==undefined){const min=dts.pre_order_days_to_ship_min,max=dts.pre_order_days_to_ship_max;if(typeof min==='number'&&d.preOrder.daysToShip<min||typeof max==='number'&&d.preOrder.daysToShip>max)issues.push('预售 daysToShip 超出目标店铺范围');if(typeof min!=='number'||typeof max!=='number')issues.push('目标店铺预售天数范围尚未确认，暂不能发布预售商品');}
 if(d.shop.region==='BR'&&!d.condition)issues.push('目标市场需要明确商品成色 condition');
 if(['BR','MX','CO','CL'].includes(d.shop.region))issues.push('此市场税务与地区附加必填规则尚未完整适配，暂不支持发布');
 const attrs=attributeRows(m.attributes,d.categoryId||undefined);for(const a of attrs)if(a.is_mandatory&&!d.attributes.some(x=>x.id===a.attribute_id&&x.values.length))issues.push(`请补齐必填属性：${a.attribute_name||a.attribute_id}`);for(const a of d.attributes){const target=attrs.find((x:any)=>x.attribute_id===a.id);if(!target){issues.push('存在不属于目标市场类目的属性');continue;}for(const value of a.values){if(value.id&&!(target.attribute_value_list||[]).some((x:any)=>x.value_id===value.id))issues.push('属性值不属于目标市场候选');if(!value.value.trim())issues.push('属性值不能为空');const units=target.attribute_unit||target.unit_list||[];if(Array.isArray(units)&&units.length&&(!value.unit||!units.some((u:any)=>(typeof u==='string'?u:u.unit||u.value_unit)===value.unit)))issues.push(`属性 ${a.id} 缺少有效单位`);}}return issues;}
}
export function validGtin(code:string){if(!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(code))return false;const digits=[...code].map(Number),check=digits.pop()!;const sum=digits.reverse().reduce((n,x,i)=>n+x*(i%2===0?3:1),0);return (10-sum%10)%10===check;}
function plainDescription(d:LocalizationDraft){return [...new Set([...d.sellingPoints,d.description,...mediaReferences(d.media,d.images).details.filter(b=>b.type==='text').map(b=>b.text)].filter(Boolean))].join('\n\n');}
export function productPayload(d:LocalizationDraft,marker:string,imageIds:unknown){if(!Array.isArray(imageIds)||!imageIds.length||imageIds.length>39||!imageIds.every(x=>typeof x==='string'&&x.length<300))throw new BadRequestException('请先上传商品图片');const refs=mediaReferences(d.media,d.images),urls=mediaUrls(d.media,d.images);if(imageIds.length!==urls.length)throw new BadRequestException('图片上传尚未完整，请继续准备图片');const imageId=(url:string)=>imageIds[urls.indexOf(url)];const description=plainDescription(d);const details=refs.details.some(b=>b.type==='image')?refs.details.map(b=>b.type==='text'?{field_type:'text',text:b.text}:{field_type:'image',image_info:{image_id:imageId(b.url)}}):[];return {...(details.length?{description_type:'extended',description_info:{extended_description:{field_list:[{field_type:'text',text:[...d.sellingPoints,d.description].filter(Boolean).join('\n\n')},...details]}}}:{}),item_name:d.title,description,item_sku:marker,category_id:d.categoryId,brand:{brand_id:d.brandId,...(d.brandName?{original_brand_name:d.brandName}:{})},attribute_list:d.attributes.map(a=>({attribute_id:a.id,attribute_value_list:a.values.map(v=>({value_id:v.id||0,original_value_name:v.value,...(v.unit?{value_unit:v.unit}:{})}))})),original_price:d.variants[0].price,seller_stock:[{stock:d.specificationNames.length?0:d.variants[0].stock,...(d.variants[0].locationId?{location_id:d.variants[0].locationId}:{})}],...(!d.specificationNames.length&&d.variants[0].gtinCode?{gtin_code:d.variants[0].gtinCode}:{}),...(d.weightKg===null?{}:{weight:d.weightKg}),...(Object.values(d.dimensionsCm).every(x=>typeof x==='number'&&x>0)?{dimension:{package_length:d.dimensionsCm.length,package_width:d.dimensionsCm.width,package_height:d.dimensionsCm.height}}:{}),logistic_info:d.logistics.filter(x=>x.enabled).map(l=>({logistic_id:l.id,enabled:true,...(l.sizeId===undefined?{}:{size_id:l.sizeId}),...(l.shippingFee===undefined?{}:{shipping_fee:l.shippingFee}),...(l.isFree===undefined?{}:{is_free:l.isFree})})),image:{image_id_list:refs.gallery.map(imageId)},item_status:'UNLIST',...(d.condition?{condition:d.condition}:{}),...(d.preOrder?{pre_order:{is_pre_order:d.preOrder.isPreOrder,...(d.preOrder.daysToShip===undefined?{}:{days_to_ship:d.preOrder.daysToShip})}}:{})};}
export function variationPayload(d:LocalizationDraft,itemId:number,imageIds?:unknown){const refs=mediaReferences(d.media,d.images),urls=mediaUrls(d.media,d.images);const optionImage=(option:string)=>{const sku=d.variants.find(v=>v.options[0]===option&&refs.variants.some(i=>i.sku===v.sku))?.sku,url=refs.variants.find(i=>i.sku===sku)?.url;if(!url)return {};if(!Array.isArray(imageIds)||imageIds.length!==urls.length)throw new BadRequestException('规格图片尚未上传完成');return {image_id:imageIds[urls.indexOf(url)]};};const options=d.specificationNames.map((_,i)=>[...new Set(d.variants.map(v=>v.options[i]))]);return {item_id:itemId,standardise_tier_variation:d.specificationNames.map((name,i)=>({variation_name:name,variation_id:0,variation_group_id:0,variation_option_list:options[i].map(option=>({variation_option_name:option,variation_option_id:0,...(i===0?optionImage(option):{})}))})),model:d.variants.map(v=>({tier_index:v.options.map((option,i)=>options[i].indexOf(option)),model_sku:v.sku,original_price:v.price,seller_stock:[{stock:v.stock,...(v.locationId?{location_id:v.locationId}:{})}],...(v.gtinCode?{gtin_code:v.gtinCode}:{})}))};}
@Controller('development/localization')
@UseGuards(DevelopmentGuard)
export class LocalizationDevelopmentController{
 constructor(private platform:LocalizationPlatform,private db:Database){}
 @Post('shops/:id/:operation') async run(@Req() req:AuthRequest,@Param('id') id:string,@Param('operation') op:string,@Body() body:unknown){const user=await this.db.user.findUniqueOrThrow({where:{id:req.userId},select:{email:true}});return this.platform.operation({owner:user.email,userId:req.userId},id,op,body);}
}
