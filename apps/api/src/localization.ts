import {isLocalLocalizationMode} from './localization-development';
import {adaptMarket,attributeRows} from './localization-adaptation';
import {supportedLanguages} from './localization-languages';
import {mediaWarnings} from './localization-media';
import {Injectable,Optional,Controller,Get,Post,Put,Body,Param,Query,Req,Res,UseGuards,CanActivate,ExecutionContext,UnauthorizedException,BadRequestException,ConflictException} from '@nestjs/common';
import type {Request,Response} from 'express';
import {resolve} from 'node:path';
import {Auth} from './auth';
import {TeamShopClient} from './team-client';
import {ListingService} from './listing';
import {LocalizationContent} from './localization-content';
import {LocalizationEngine} from './localization-engine';
import {LocalizationPlatform,LocalizationContext,withMarketRuleSnapshot,MarketRuleReadError} from './localization-platform';
type LocalizationRequest=Request&{localization:LocalizationContext};
@Injectable()
export class LocalizationGuard implements CanActivate {
 constructor(@Optional() private auth?:Auth,@Optional() private team?:TeamShopClient){}
 async canActivate(context:ExecutionContext){const req=context.switchToHttp().getRequest<LocalizationRequest>();
  if(this.auth){const s=await this.auth.session(req);if(!s||s.user.role!=='ADMIN')throw new UnauthorizedException('请先登录中台管理员账号');req.localization={owner:s.user.email,userId:s.userId};}
  else if(this.team){const me=await this.team.me(req.cookies?.yz_team);if(!me.email||me.role!=='ADMIN')throw new UnauthorizedException('当前账号没有商品发布权限');req.localization={owner:me.email,sessionId:req.cookies?.yz_team};}
  else throw new UnauthorizedException('请先登录中台');return true;
 }
}
@Injectable()
export class LocalizationService {
 readonly engine=new LocalizationEngine(resolve(process.env.LOCALIZATION_DATA_DIR||'.local/localization'));
 readonly content:LocalizationContent;
 private adapting=new Map<string,Promise<{draft:ReturnType<LocalizationEngine['getDraft']>;issues:string[]}>>();
 constructor(private platform:LocalizationPlatform,listing:ListingService,@Optional() private team?:TeamShopClient){this.content=new LocalizationContent(listing);}
 private sourceSync=new Map<string,Promise<ReturnType<LocalizationEngine['listSources']>>>();
 async sources(ctx:LocalizationContext){
  if(!this.team)return this.engine.listSources(ctx.owner);
  const key=ctx.owner+':'+ctx.sessionId,active=this.sourceSync.get(key);if(active)return active;
  const work=(async()=>{
   const rows=await this.team!.reviewRead(ctx.sessionId!,'/sources');
   if(!Array.isArray(rows))throw new BadRequestException('商品来源读取失败，请刷新重试');
   const existing=new Set(this.engine.listSources(ctx.owner).map(s=>s.id));
   for(const raw of rows){
    if(existing.has(raw.id))continue;
    const source=structuredClone(raw),mapped=new Map<string,string>();
    for(const url of new Set<string>([...source.images,...(source.media?.assets||[]).map((a:any)=>a.url)])){
     if(/^\/api\/v1\/localization\/assets\/[a-f0-9-]{36}$/.test(url))mapped.set(url,this.content.store(ctx.owner,await this.team!.reviewRead(ctx.sessionId!,url.replace('/api/v1/localization',''),true)));
    }
    source.images=source.images.map((url:string)=>mapped.get(url)||url);
    if(source.media)for(const asset of source.media.assets)asset.url=mapped.get(asset.url)||asset.url;
    this.engine.ensureImportedSource(ctx.owner,source,source.id,source.createdAt);
    if(source.publishing){try{this.engine.attachSourcePublishing(ctx.owner,source.id,source.publishing);}catch(error){if(!(error instanceof BadRequestException))throw error;this.engine.markSourcePublishingIssue(ctx.owner,source.id);}}
    existing.add(source.id);
   }
   return this.engine.listSources(ctx.owner);
  })().finally(()=>this.sourceSync.delete(key));this.sourceSync.set(key,work);return work;
 }
 publisher(ctx:LocalizationContext){return this.platform.publisher(ctx,async url=>{const match=url.match(/^\/api\/v1\/localization\/assets\/([a-f0-9-]{36})$/);if(!match)throw new BadRequestException('图片地址无效');return this.content.asset(ctx.owner,match[1]).bytes;});}
 async create(ctx:LocalizationContext,sourceId:string,shopId:string,language?:string,purpose:'original'|'localized'='localized'){const shop=(await this.platform.shops(ctx)).find(s=>s.id===shopId&&s.status==='CONNECTED');if(!shop)throw new BadRequestException('请选择连接正常的目标店铺');return this.engine.createDraft(ctx.owner,sourceId,shop,language,purpose);}
 async changeShop(ctx:LocalizationContext,id:string,shopId:string,revision:number){const shop=(await this.platform.shops(ctx)).find(s=>s.id===shopId&&s.status==='CONNECTED');if(!shop)throw new BadRequestException('请选择连接正常的目标店铺');const changed=this.engine.changeDraftShop(ctx.owner,id,shop,revision);return changed.revision===revision?changed:(await this.adapt(ctx,id)).draft;}
 private translating=new Map<string,Promise<ReturnType<LocalizationEngine['getDraft']>>>();
 async localize(ctx:LocalizationContext,id:string){const key=ctx.owner+':'+id;const active=this.translating.get(key);if(active)return active;const work=(async()=>{const d=this.engine.getDraft(ctx.owner,id);if(d.purpose==='original')throw new BadRequestException('原文上架版本不能转译，请从商品本地化创建独立版本');if(this.engine.listTasks(ctx.owner).some(t=>t.draftId===id&&(t.status!=='failed'||t.remoteId)))throw new BadRequestException('此版本已有发布任务，不能重新生成文案');if(!supportedLanguages(d.shop.language,d.shop.region).includes(d.language))throw new BadRequestException('目标语言不适用于当前店铺市场，请重新选择');const source=this.engine.getSource(ctx.owner,d.sourceId);const patch=await (source.sourceSystem==='fastmoss-selection'?this.content.selectionCopy(source,d):this.content.localize({...source,parameters:source.sourceSystem==='shopee-shop'?Object.fromEntries(Object.entries(source.parameters).filter(([key])=>!key.startsWith('来源'))):source.parameters,title:d.title,description:d.description,specificationNames:d.specificationNames,variants:d.variants.map(v=>({sku:v.sku,options:v.options})),weightKg:d.weightKg??undefined,dimensionsCm:Object.values(d.dimensionsCm).every(v=>typeof v==='number')?d.dimensionsCm as {length:number;width:number;height:number}:undefined},d));this.engine.updateDraft(ctx.owner,id,{...patch,localizedAt:new Date().toISOString()},d.revision);return (await this.adapt(ctx,id)).draft;})().finally(()=>this.translating.delete(key));this.translating.set(key,work);return work;}
 async adapt(ctx:LocalizationContext,id:string){const key=ctx.owner+':'+id;const running=this.adapting.get(key);if(running)return running;const work=this.adaptOnce(ctx,id).finally(()=>this.adapting.delete(key));this.adapting.set(key,work);return work;}
 private async adaptOnce(ctx:LocalizationContext,id:string){const draft=this.engine.getDraft(ctx.owner,id);
  if(this.engine.listTasks(ctx.owner).some(t=>t.draftId===id&&(t.status!=='failed'||t.remoteId)))return {draft,issues:['此版本已有发布任务，请先核对结果，不能重新适配。']};
  let stage='读取目标店铺规则';
  try{const source=this.engine.getSource(ctx.owner,draft.sourceId);let raw=await this.platform.rawMetadata(ctx,draft.shop.id,draft.categoryId||undefined);
   const categories=(raw.categories as any)?.category_list||[],valid=categories.some((c:any)=>c.category_id===draft.categoryId&&!c.has_children);let next=structuredClone(draft);
   if(!valid){stage='匹配目标市场类目';const match=await this.content.matchCategory(source,categories.map((c:any)=>({id:c.category_id,name:c.display_category_name||c.original_category_name,parentId:c.parent_category_id,hasChildren:c.has_children})));next={...next,categoryId:match?.id??null,brandId:null,brandName:undefined,attributes:[]};if(match){stage='读取目标类目属性和品牌';raw=await this.platform.rawMetadata(ctx,next.shop.id,match.id);}}
   const titleLimits=(raw.limits as any)?.item_name_length_limit||{},titleLength=[...next.title].length;if(next.localizedAt&&(typeof titleLimits.min_limit==='number'&&titleLength<titleLimits.min_limit||typeof titleLimits.max_limit==='number'&&titleLength>titleLimits.max_limit)){stage='适配转译标题字数';next.title=await this.content.fitTitle(next,titleLimits);}
   stage='匹配目标市场属性';
   const missingAttributes=attributeRows(raw.attributes,next.categoryId).filter(a=>!next.attributes.some(v=>v.id===a.attribute_id&&v.values.length));
   const matched=await this.content.matchAttributes(source,missingAttributes);
   if(matched.length)next.attributes=[...next.attributes.filter(a=>!matched.some(m=>m.id===a.id)),...matched];
   const result=adaptMarket(source,next,raw);
   if(JSON.stringify(next.attributes)!==JSON.stringify(draft.attributes)&&!result.patch.attributes)result.patch.attributes=next.attributes;
   if(!next.categoryId)result.issues.unshift('未能可靠匹配目标市场类目，请补充准确的商品名称或来源类目信息后重新适配。');const patch={...result.patch,...(next.title!==draft.title?{title:next.title,marketConfirmed:false}:{}),...(!valid?{categoryId:next.categoryId,attributes:result.patch.attributes||[],brandId:result.patch.brandId??null}:{} )};const issues=[...new Set([...(!next.categoryId?['未找到可靠的目标市场末级类目，请补充来源类目或商品资料后重新适配。']:[]),...result.issues])],status=issues.length?'needs_input' as const:'ready' as const;
   const changed=Object.entries(patch).some(([k,v])=>JSON.stringify((draft as any)[k])!==JSON.stringify(v));if(!changed&&draft.marketAdaptation?.status===status&&JSON.stringify(draft.marketAdaptation.issues)===JSON.stringify(issues))return {draft,issues};
   const saved=this.engine.updateDraft(ctx.owner,id,{...patch,marketAdaptation:{status,issues,checkedAt:new Date().toISOString()}},draft.revision);return {draft:saved,issues};
  }catch(e){if((e as any)?.status===409)throw e;const issues=[e instanceof MarketRuleReadError?e.message:stage+'未完成，请检查店铺连接、中央接口及 AI 文本配置后重新适配。'];const current=this.engine.getDraft(ctx.owner,id);if(current.revision!==draft.revision)throw new BadRequestException('草稿已更新，请重新适配');const saved=this.engine.updateDraft(ctx.owner,id,{marketAdaptation:{status:'failed',issues,checkedAt:new Date().toISOString()}},current.revision);return {draft:saved,issues};}
 }
 async preview(ctx:LocalizationContext,id:string){return withMarketRuleSnapshot(async()=>{const adapted=await this.adapt(ctx,id),draft=adapted.draft,issues=[...this.engine.validate(ctx.owner,id),...adapted.issues];try{const caps=await this.platform.capabilities(ctx,draft.shop.id);issues.push(...caps.issues.filter((issue:string)=>!isLocalLocalizationMode()||issue!=='本地联调允许读取真实市场资料；商品写入与发布已禁用。'));}catch(e){const status=(e as {getStatus?:()=>number})?.getStatus?.(),response=(e as {getResponse?:()=>unknown})?.getResponse?.();const message=typeof response==='object'&&response!==null?(response as {message?:unknown}).message:response;issues.push(message==='目标店铺不在本次保存测试范围'?'店铺发布通道受限：当前中央服务仅开放指定店铺的未上架保存测试，尚未开放此店铺的真实发布。':status===401?'店铺资格核验失败：登录已失效，请重新登录。':status===403?'店铺资格核验失败：当前账号或发布通道无权操作目标店铺。':'店铺资格核验失败：发布服务暂不可用，请稍后重试。');}try{issues.push(...await this.platform.validateMarket(ctx,draft.shop.id,draft));}catch(e){issues.push(e instanceof MarketRuleReadError?e.message:'商品市场规则检查未完成：规则服务暂时不可用，请重试。');}return {draft,source:this.engine.getSource(ctx.owner,draft.sourceId),issues:[...new Set(issues)].filter(issue=>!issue.startsWith('请补齐必填属性：')||!issues.some(other=>other==='缺少可可靠匹配的必填属性：'+issue.slice('请补齐必填属性：'.length))),warnings:[...mediaWarnings(draft.media),'图片内的文字不会随文案自动翻译，请核对图片与目标语言。','真实写入权限以平台发布结果为准。'],canPublish:issues.length===0&&!isLocalLocalizationMode()};});}
}
@Controller('localization')
@UseGuards(LocalizationGuard)
export class LocalizationController {
 constructor(private service:LocalizationService,private platform:LocalizationPlatform){}
 @Get('sources') sources(@Req() r:LocalizationRequest){return this.service.sources(r.localization);}
 @Get('shops') shops(@Req() r:LocalizationRequest){return this.platform.shops(r.localization);}
 @Get('shops/:id/metadata') metadata(@Req() r:LocalizationRequest,@Param('id') id:string,@Query('categoryId') categoryId?:string){if(categoryId&&!/^[1-9]\d{0,14}$/.test(categoryId))throw new BadRequestException('类目编号无效');return this.platform.metadata(r.localization,id,categoryId?Number(categoryId):undefined);}
 @Get('drafts') drafts(@Req() r:LocalizationRequest){return this.service.engine.listDrafts(r.localization.owner);}
 @Post('drafts') create(@Req() r:LocalizationRequest,@Body() b:{sourceId:string;shopId:string;language?:string;purpose?:'original'|'localized'}){if(!b||typeof b.sourceId!=='string'||typeof b.shopId!=='string')throw new BadRequestException('请选择源商品和目标店铺');return this.service.create(r.localization,b.sourceId,b.shopId,b.language,b.purpose);}
 @Get('drafts/:id') draft(@Req() r:LocalizationRequest,@Param('id') id:string){return this.service.engine.getDraft(r.localization.owner,id);}
 @Put('drafts/:id') save(@Req() r:LocalizationRequest,@Param('id') id:string,@Body() b:Record<string,unknown>){if(!b||!Number.isSafeInteger(b.revision))throw new BadRequestException('缺少草稿版本');const {id:bodyId,sourceId,owner,shop,revision,createdAt,updatedAt,purpose,localizedAt,...patch}=b;return this.service.engine.updateDraft(r.localization.owner,id,patch,revision as number);}
 @Post('drafts/:id/shop') changeShop(@Req() r:LocalizationRequest,@Param('id') id:string,@Body() b:{shopId:string;revision:number}){if(typeof b?.shopId!=='string'||!Number.isSafeInteger(b.revision))throw new BadRequestException('请选择目标店铺');return this.service.changeShop(r.localization,id,b.shopId,b.revision);}
 @Post('drafts/:id/adapt') adapt(@Req() r:LocalizationRequest,@Param('id') id:string){return this.service.adapt(r.localization,id);}
 @Post('drafts/:id/match-category') async matchCategory(@Req() r:LocalizationRequest,@Param('id') id:string){const result=await this.service.adapt(r.localization,id);return {...result,match:result.draft.categoryId?{id:result.draft.categoryId}:null,status:result.draft.categoryId?'matched':'unmatched'};}
 @Post('drafts/:id/localize') localize(@Req() r:LocalizationRequest,@Param('id') id:string){return this.service.localize(r.localization,id);}
 @Post('drafts/:id/preview') preview(@Req() r:LocalizationRequest,@Param('id') id:string){return this.service.preview(r.localization,id);}
 @Post('drafts/:id/publish') async publish(@Req() r:LocalizationRequest,@Param('id') id:string,@Body() b:{revision:number;confirmed:boolean}){if(b?.confirmed!==true||!Number.isSafeInteger(b.revision))throw new BadRequestException('请预览并主动确认发布');const p=await this.service.preview(r.localization,id);if(p.issues.length)throw new BadRequestException(p.issues.join('；'));return this.service.engine.startPublish(r.localization.owner,id,this.service.publisher(r.localization),b.revision);}
 @Get('jobs') jobs(@Req() r:LocalizationRequest){return this.service.engine.listTasks(r.localization.owner);}
 @Get('jobs/:id') job(@Req() r:LocalizationRequest,@Param('id') id:string){return this.service.engine.getTask(r.localization.owner,id);}
 @Post('jobs/:id/resume') async resume(@Req() r:LocalizationRequest,@Param('id') id:string){let task=this.service.engine.getTask(r.localization.owner,id);if(task.status!=='failed'&&!(task.status==='created'&&task.error&&task.stage!=='等待虾皮审核'))throw new BadRequestException('仅发布失败的任务可以重试；审核中或已发布的商品不能重新发布');
  // A delayed Shopee state must be reconciled before any retry can mutate the item.
  if(task.remoteId){task=await this.checkStatus(r,id);if(task.status==='succeeded'||task.stage==='等待虾皮审核')return task;}
  return this.service.engine.startResume(r.localization.owner,id,this.service.publisher(r.localization));}
 @Post('jobs/:id/reconcile') reconcile(@Req() r:LocalizationRequest,@Param('id') id:string){return this.checkStatus(r,id);}
 @Post('jobs/:id/status') checkStatus(@Req() r:LocalizationRequest,@Param('id') id:string){return this.service.engine.checkStatus(r.localization.owner,id,this.service.publisher(r.localization),(draft,task)=>this.platform.taskStatus(r.localization,draft,task));}
 @Get('listing-images') listing(@Req() r:LocalizationRequest){return this.service.content.listingImages(r.localization.owner);}
 @Post('drafts/:id/listing-images') attach(@Req() r:LocalizationRequest,@Param('id') id:string,@Body() b:{jobId:string;slotIds:string[];revision:number}){const d=this.service.engine.getDraft(r.localization.owner,id);if(!b||typeof b.jobId!=='string'||!Number.isSafeInteger(b.revision))throw new BadRequestException('请选择组图任务并提供当前版本');if(d.revision!==b.revision)throw new ConflictException('商品版本已更新，请刷新后重试');if(this.service.engine.listTasks(r.localization.owner).some(t=>t.draftId===id&&(t.status!=='failed'||t.remoteId)))throw new ConflictException('此版本已有发布任务，不能替换图片');const images=this.service.content.attach(r.localization.owner,b.jobId,b.slotIds);return this.service.engine.updateDraft(r.localization.owner,id,{images,imagesReviewed:false,marketConfirmed:false},d.revision);}
 @Post('assets') upload(@Req() r:LocalizationRequest,@Body() b:{data:string}){if(typeof b?.data!=='string'||b.data.length>12*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(b.data))throw new BadRequestException('图片数据无效');return {url:this.service.content.store(r.localization.owner,Buffer.from(b.data,'base64'))};}
 @Get('assets/:id') asset(@Req() r:LocalizationRequest,@Param('id') id:string,@Res() res:Response){const a=this.service.content.asset(r.localization.owner,id);res.type(a.mime).setHeader('X-Content-Type-Options','nosniff');res.send(a.bytes);}
}
