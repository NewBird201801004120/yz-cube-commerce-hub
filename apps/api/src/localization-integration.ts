import {PublishingInput,parsePublishingInput} from './localization-publishing-input';
import {Injectable,Controller,Get,Post,Param,Query,Req,Body,UseGuards,CanActivate,ExecutionContext,UnauthorizedException,ForbiddenException,BadRequestException,ConflictException,NotFoundException} from '@nestjs/common';
import type {Request} from 'express';
import {createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {readFileSync,readdirSync,mkdirSync,existsSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {LocalizationService} from './localization';
import {LocalizationPlatform} from './localization-platform';
import {parseSource,SourceInput,LocalizationShop} from './localization-engine';
import {supportedLanguages} from './localization-languages';
import {isLocalLocalizationMode,localLocalizationShops} from './localization-development';

export type IntegrationClient={id:string;tokenSha256:string;ownerEmail:string;sourceSystem:string;allowedShopIds:string[];shopScope?:'all_connected';enabled:boolean};
type MachineRequest=Request&{integration:IntegrationClient};
type ImportInput={schemaVersion:1;requestId:string;product:SourceInput;target:{connectionId?:string;country?:string;language?:string;publishing?:PublishingInput}};
type Receipt={id:string;clientId:string;owner:string;fingerprint:string;requestId:string;sourceId:string;draftId:string;product:SourceInput;shop:LocalizationShop;language:string;publishing?:PublishingInput;createdAt:string;localizationStatus:'pending'|'localizing'|'awaiting_review'|'localization_failed';localizationError?:string};
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
// All-shop access must be explicit in server configuration, never in caller input.
const allowsShop=(client:IntegrationClient,id:string)=>client.shopScope==='all_connected'||client.allowedShopIds.includes(id);
function stable(v:any):string{return JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(stable(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])):v);}
function uuid(seed:string){const h=digest(seed);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
function fields(v:any,keys:string[]){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw new BadRequestException('请求包含不支持的字段');}
/** Reject incomplete sender facts before any source, receipt, draft or AI work is created. */
function requireCompleteProduct(b:ImportInput){
 const errors:{field:string;message:string}[]=[];
 const add=(field:string,message:string)=>errors.push({field,message});
 const positive=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0;
 if(typeof b.product.title!=='string'||!b.product.title.trim())add('product.title','必须提供非空商品标题');
 if(typeof b.product.description!=='string'||!b.product.description.trim())add('product.description','必须提供非空商品描述');
 if(!Array.isArray(b.product.images)||!b.product.images.length)add('product.images','至少提供一张商品图片');
 if(!positive(b.product.weightKg))add('product.weightKg','必须提供大于0的包装重量，单位kg');
 for(const key of ['length','width','height'] as const)if(!positive(b.product.dimensionsCm?.[key]))add('product.dimensionsCm.'+key,'必须提供大于0的包装尺寸，单位cm');
 const variants=b.target.publishing?.variants;
 if(!Array.isArray(variants)||!variants.length)add('target.publishing.variants','必须提供全部SKU的最终售价和库存');
 else for(const [i,v] of variants.entries()){
  if(!v||!positive(v.price))add(`target.publishing.variants[${i}].price`,'必须提供大于0的目标币种最终售价');
  if(!v||!Number.isSafeInteger(v.stock)||v.stock<0)add(`target.publishing.variants[${i}].stock`,'必须提供非负整数库存，允许0');
 }
 if(errors.length)throw new BadRequestException({message:'商品资料不完整：'+errors.map(e=>e.field+'：'+e.message).join('；'),fieldErrors:errors});
}
export function parseImport(raw:unknown):ImportInput{
 fields(raw,['schemaVersion','requestId','product','target']);const b=raw as ImportInput;
 if(b.schemaVersion!==1||typeof b.requestId!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,149}$/.test(b.requestId))throw new BadRequestException('schemaVersion 或 requestId 无效');
 fields(b.product,['schemaVersion','sourceSystem','sourceProductId','title','description','images','parameters','variants','specificationNames','weightKg','dimensionsCm','media']);
 fields(b.target,['connectionId','country','language','publishing']);requireCompleteProduct(b);
 const product=parseSource(JSON.parse(stable(b.product)));for(const v of product.variants)fields(v,['sku','options','stock']);if(product.dimensionsCm)fields(product.dimensionsCm,['length','width','height']);fields(b.target,['connectionId','country','language','publishing']);
 if(new Set(product.variants.map(v=>JSON.stringify(v.options))).size!==product.variants.length)throw new BadRequestException('SKU规格组合不能重复；无规格商品只能包含一个SKU');
 // connectionId/country/language are optional (2026-11-19): omitted shop falls back to the client's first authorized connected shop; operators can change it on the review page.
 if((b.target.connectionId!==undefined&&(typeof b.target.connectionId!=='string'||!b.target.connectionId||b.target.connectionId.length>150))||(b.target.country!==undefined&&(typeof b.target.country!=='string'||! /^[A-Z]{2}$/.test(b.target.country)))||(b.target.language!==undefined&&(typeof b.target.language!=='string'||!b.target.language.trim()||b.target.language.length>80)))throw new BadRequestException('目标店铺、国家或语言格式无效');
 if([...product.images,...(product.media?.assets.map(x=>x.url)||[])].some(x=>!x.startsWith('https://')))throw new BadRequestException('仿真平台图片必须是公开 HTTPS 地址');
 return {schemaVersion:1,requestId:b.requestId,product,target:{...b.target,...(b.target.publishing===undefined?{}:{publishing:parsePublishingInput(b.target.publishing,product.variants.map(v=>v.sku))})}};
}
/** Exempt only these machine routes from browser Origin checks. The guard always rejects cookies/origins. */
export function integrationServerRequest(req:Pick<Request,'path'|'headers'|'method'>){return !req.headers.origin&&!req.headers.cookie&&typeof req.headers.authorization==='string'&&req.method==='POST'&&(req.path==='/api/v1/localization/integration/imports'||/^\/api\/v1\/localization\/integration\/imports\/[a-f0-9-]{36}\/localize$/.test(req.path)||/^\/api\/v1\/development\/localization\/imports\/[a-f0-9-]{36}\/localize$/.test(req.path));}
@Injectable()
export class LocalizationIntegrationGuard implements CanActivate{
 canActivate(context:ExecutionContext){const req=context.switchToHttp().getRequest<MachineRequest>();
  if(req.headers.origin||req.headers.cookie)throw new UnauthorizedException('此接口仅允许服务端调用');
  const token=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)?.[1];if(!token)throw new UnauthorizedException('缺少接入凭据');
  let clients:IntegrationClient[]=[];try{clients=JSON.parse(readFileSync(process.env.LOCALIZATION_INTEGRATIONS_FILE||'', 'utf8'));if(!Array.isArray(clients))throw Error();}catch{throw new UnauthorizedException('仿真接入未配置');}
  const hash=Buffer.from(digest(token),'hex');const client=clients.find(c=>c?.enabled===true&&typeof c.tokenSha256==='string'&&/^[a-f0-9]{64}$/.test(c.tokenSha256)&&timingSafeEqual(hash,Buffer.from(c.tokenSha256,'hex')));
  if(!client||typeof client.id!=='string'||!client.id||typeof client.ownerEmail!=='string'||!client.ownerEmail||typeof client.sourceSystem!=='string'||!client.sourceSystem||!Array.isArray(client.allowedShopIds)||!client.allowedShopIds.every(x=>typeof x==='string')||(client.shopScope!==undefined&&client.shopScope!=='all_connected'))throw new UnauthorizedException('接入凭据无效');
  req.integration=client;return true;
 }
}
@Injectable()
export class LocalizationIntegrationService{
 private active=new Set<string>();
 constructor(private service:LocalizationService,private platform:LocalizationPlatform){}
 private get dir(){const dir=join(this.service.engine.dir,'imports');mkdirSync(dir,{recursive:true,mode:0o700});return dir;}
 async shops(client:IntegrationClient){const available=isLocalLocalizationMode()?localLocalizationShops:await this.platform.shops({owner:client.ownerEmail});return available.filter(s=>s.status==='CONNECTED'&&allowsShop(client,s.id)&&typeof s.currency==='string'&&!!s.currency&&typeof s.language==='string'&&!!s.language).map(s=>({...s,supportedLanguages:supportedLanguages(s.language,s.region)}));}
 async requirements(client:IntegrationClient,id:string,categoryId?:string){if(categoryId!==undefined&&!/^[1-9]\d{0,14}$/.test(categoryId))throw new BadRequestException('categoryId 必须是正整数');if(!allowsShop(client,id))throw new ForbiddenException('目标店铺不在接入授权范围');if(!(await this.shops(client)).some(s=>s.id===id))throw new BadRequestException('目标店铺未连接');return this.platform.requirements({owner:client.ownerEmail},id,categoryId?Number(categoryId):undefined);}
 private read(client:IntegrationClient,id:string):Receipt{if(!/^[a-f0-9-]{36}$/.test(id)||!existsSync(join(this.dir,id+'.json')))throw new NotFoundException('导入记录不存在');const r=JSON.parse(readFileSync(join(this.dir,id+'.json'),'utf8')) as Receipt;if(r.clientId!==client.id||r.owner!==client.ownerEmail)throw new NotFoundException('导入记录不存在');return r;}
 private materialize(r:Receipt){this.service.engine.ensureImportedSource(r.owner,r.product,r.sourceId);this.service.engine.ensureImportedDraft(r.owner,r.sourceId,r.shop,r.language,r.draftId,r.publishing);}
 private result(r:Receipt){const d=this.service.engine.getDraft(r.owner,r.draftId);const tasks=this.service.engine.listTasks(r.owner).filter(t=>t.draftId===d.id);return {id:r.id,requestId:r.requestId,status:r.localizationStatus==='pending'?'localization_failed':r.localizationStatus,localizationError:r.localizationError,sourceId:r.sourceId,draftId:r.draftId,reviewPath:'/tools/localization?draft='+encodeURIComponent(r.draftId),title:r.product.title,sourceSystem:r.product.sourceSystem,sourceProductId:r.product.sourceProductId,shopName:d.shop.shopName,country:d.shop.region,language:d.language,createdAt:r.createdAt,publishTasks:tasks.map(t=>({id:t.id,status:t.status,stage:t.stage,remoteId:t.remoteId,error:t.error})),note:'已接收来源资料；请在中台核对文案、补齐市场信息并预览确认。导入不会发布商品。'};}
 async accept(client:IntegrationClient,raw:unknown){const b=parseImport(raw);if(b.product.sourceSystem!==client.sourceSystem||(b.target.connectionId!==undefined&&!allowsShop(client,b.target.connectionId)))throw new ForbiddenException('来源系统或目标店铺不在接入授权范围');
  const id=uuid(stable([client.id,client.ownerEmail,b.requestId])),fingerprint=digest(stable(b)),file=join(this.dir,id+'.json');
  if(existsSync(file)){const r=this.read(client,id);if(r.fingerprint!==fingerprint)throw new ConflictException('requestId 已用于其他内容，请使用新的 requestId');this.materialize(r);return this.get(client,id);}
  const shops=await this.shops(client),shop=b.target.connectionId!==undefined?shops.find(s=>s.id===b.target.connectionId):client.allowedShopIds.map(id=>shops.find(s=>s.id===id)).find(Boolean)??shops[0];if(!shop)throw new BadRequestException(b.target.connectionId!==undefined?'目标店铺未连接':'没有可用的已连接目标店铺');if(b.target.country!==undefined&&shop.region!==b.target.country)throw new BadRequestException('目标店铺未连接或国家不匹配');
  const language=b.target.language??shop.language;
  if(!shop.supportedLanguages.includes(language))throw new BadRequestException('目标语言不支持，请使用店铺查询返回的supportedLanguages值');
  // Recheck after the asynchronous shop read, before writing the journal.
  if(existsSync(file)){const r=this.read(client,id);if(r.fingerprint!==fingerprint)throw new ConflictException('requestId 已用于其他内容');this.materialize(r);return this.get(client,id);}
  const r:Receipt={id,clientId:client.id,owner:client.ownerEmail,fingerprint,requestId:b.requestId,sourceId:uuid(stable([client.ownerEmail,b.product])),draftId:uuid('draft:'+id),product:b.product,shop,language,...(b.target.publishing===undefined?{}:{publishing:b.target.publishing}),createdAt:new Date().toISOString(),localizationStatus:'pending'};
  this.save(r);this.materialize(r);this.startLocalization(r);return this.result(r);
 }
 private save(r:Receipt){const file=join(this.dir,r.id+'.json'),tmp=file+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(r),{mode:0o600});renameSync(tmp,file);}
 private startLocalization(r:Receipt){if(this.service.engine.listTasks(r.owner).some(t=>t.draftId===r.draftId&&(t.status!=='failed'||t.remoteId)))throw new ConflictException('草稿已有发布任务，请先查看发布结果，不能重新生成文案');if(this.active.has(r.id)||r.localizationStatus==='awaiting_review')return;this.active.add(r.id);r.localizationStatus='localizing';r.localizationError=undefined;this.save(r);void (async()=>{try{const d=this.service.engine.getDraft(r.owner,r.draftId),source=this.service.engine.getSource(r.owner,r.sourceId);const patch=await this.service.content.localize(source,d);this.service.engine.updateDraft(r.owner,d.id,patch,d.revision);await this.service.adapt({owner:r.owner},d.id);r.localizationStatus='awaiting_review';}catch{r.localizationStatus='localization_failed';r.localizationError='文案生成未完成，请核对中台 AI 配置或草稿是否已编辑，修正后可重新生成；草稿已保留。';}finally{this.save(r);this.active.delete(r.id);}})();}
 private recover(r:Receipt){this.materialize(r);if((r.localizationStatus==='localizing'||r.localizationStatus==='pending')&&!this.active.has(r.id)){r.localizationStatus='localization_failed';r.localizationError='服务曾中断，草稿已保留，请主动重新生成文案。';this.save(r);}return r;}
 private owned(owner:string,id:string){if(!/^[a-f0-9-]{36}$/.test(id)||!existsSync(join(this.dir,id+'.json')))throw new NotFoundException('接收记录不存在');const r=JSON.parse(readFileSync(join(this.dir,id+'.json'),'utf8')) as Receipt;if(r.owner!==owner)throw new NotFoundException('接收记录不存在');return this.recover(r);}
 listForOwner(owner:string){const records:ReturnType<LocalizationIntegrationService['result']>[]=[];for(const file of readdirSync(this.dir).filter(f=>/^[a-f0-9-]{36}\.json$/.test(f))){const r=JSON.parse(readFileSync(join(this.dir,file),'utf8')) as Receipt;if(r.owner===owner)records.push(this.result(this.recover(r)));}return {environment:'central' as const,records:records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))};}
 retryForOwner(owner:string,id:string){const r=this.owned(owner,id);if(r.localizationStatus==='localization_failed'||r.localizationStatus==='pending')this.startLocalization(r);return this.result(r);}

 retry(client:IntegrationClient,id:string){this.get(client,id);const r=this.read(client,id);if(r.localizationStatus==='localization_failed'||r.localizationStatus==='pending')this.startLocalization(r);return this.result(r);}
 get(client:IntegrationClient,id:string){const r=this.read(client,id);if(!allowsShop(client,r.shop.id)||client.sourceSystem!==r.product.sourceSystem)throw new ForbiddenException('导入记录已不在接入授权范围');this.materialize(r);if((r.localizationStatus==='localizing'||r.localizationStatus==='pending')&&!this.active.has(r.id)){r.localizationStatus='localization_failed';r.localizationError='服务曾中断，草稿已保留，请主动重新生成文案。';this.save(r);}return this.result(r);}
}
@Controller('localization/integration')
@UseGuards(LocalizationIntegrationGuard)
export class LocalizationIntegrationController{
 constructor(private service:LocalizationIntegrationService){}
 @Get('shops') shops(@Req() r:MachineRequest){return this.service.shops(r.integration);}
 @Get('shops/:id/requirements') requirements(@Req() r:MachineRequest,@Param('id') id:string,@Query('categoryId') categoryId?:string){return this.service.requirements(r.integration,id,categoryId);}
 @Post('imports') accept(@Req() r:MachineRequest,@Body() b:unknown){return this.service.accept(r.integration,b);}
 @Post('imports/:id/localize') retry(@Req() r:MachineRequest,@Param('id') id:string){return this.service.retry(r.integration,id);}
 @Get('imports/:id') get(@Req() r:MachineRequest,@Param('id') id:string){return this.service.get(r.integration,id);}
}
