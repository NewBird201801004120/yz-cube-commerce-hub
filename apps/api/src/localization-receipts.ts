import {Controller,Get,Post,Param,Req,Body,UseGuards,Optional,NotFoundException,BadRequestException} from '@nestjs/common';
import {LocalizationNotifications} from './localization-notifications';
import type {Request} from 'express';
import {LocalizationService,LocalizationGuard} from './localization';
import {LocalizationIntegrationService,receiptReviewSourceId} from './localization-integration';
import {LocalizationContext} from './localization-platform';
import {TeamShopClient} from './team-client';
import {DevelopmentGuard} from './development';
import {Database} from './database';
import type {AuthRequest} from './auth';

@Controller('localization/receipts')
@UseGuards(LocalizationGuard)
export class LocalizationReceiptsController {
 constructor(@Optional() private integrations?:LocalizationIntegrationService,@Optional() private team?:TeamShopClient,@Optional() private service?:LocalizationService){}
 private opening=new Map<string,Promise<unknown>>();
 private centralIds=new Map<string,Set<string>>();
 @Get('notifications') notifications(@Req() req:Request&{localization:LocalizationContext}){
  const {owner,sessionId}=req.localization;
  if(this.team)return this.team.receiptNotifications(sessionId!);
  return new LocalizationNotifications(this.service!.engine.dir).list(owner,this.integrations!.listForOwner(owner).records);
 }
 @Post('notifications/read') readNotifications(@Req() req:Request&{localization:LocalizationContext},@Body() body:unknown){
  const {owner,sessionId}=req.localization;
  if(this.team)return this.team.readReceiptNotifications(sessionId!,body);
  return new LocalizationNotifications(this.service!.engine.dir).markRead(owner,this.integrations!.listForOwner(owner).records,body);
 }
 private localReceipt(owner:string,id:string){if(!this.team||this.centralIds.get(owner)?.has(id))return undefined;return this.integrations?.listForOwner(owner).records.find(r=>r.id===id);}
 @Get() async list(@Req() req:Request&{localization:LocalizationContext}){
  if(this.team){const data=await this.team.receipts(req.localization.sessionId!),owner=req.localization.owner;const central=data.records.map((r:any)=>({...r,origin:'central' as const,reviewSourceId:r.reviewSourceId||(r.draftId?receiptReviewSourceId(r.id):r.sourceId)}));const ids=new Set<string>(central.map((r:any)=>r.id));this.centralIds.set(owner,ids);const local=(this.integrations?.listForOwner(owner).records||[]).filter(r=>!ids.has(r.id)).map(r=>({...r,origin:'local' as const}));return {records:[...central,...local].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')),environment:'team',reviewOrigin:this.team.managementOrigin};}
  return this.integrations!.listForOwner(req.localization.owner);
 }
 @Get(':id/source') sourceRead(@Req() req:Request&{localization:LocalizationContext},@Param('id') id:string){return this.source(req,id);}
 private sourceOpening=new Map<string,Promise<ReturnType<LocalizationService['engine']['getSource']>>>();
 @Post(':id/source') async source(@Req() req:Request&{localization:LocalizationContext},@Param('id') id:string){const key=req.localization.owner+':'+id;const active=this.sourceOpening.get(key);if(active)return active;const work=this.sourceOnce(req,id);this.sourceOpening.set(key,work);try{return await work;}finally{this.sourceOpening.delete(key);}}
 private async sourceOnce(req:Request&{localization:LocalizationContext},id:string){
  const {owner,sessionId}=req.localization;
  if(!this.team||this.localReceipt(owner,id))return this.integrations!.sourceForOwner(owner,id);
  if(!/^[a-f0-9-]{36}$/.test(id))throw new NotFoundException('接收记录不存在');
  let source:any;
  try{source=await this.team.reviewRead(sessionId!,'/receipts/'+id+'/source');}
  catch(error){
   // Older central deployments expose complete legacy snapshots through read-only review routes.
   if((error as {status?:number}).status!==404)throw error;
   const records=await this.team.receipts(sessionId!),row=records.records.find((r:any)=>r.id===id);
   if(!row?.draftId)throw error;
   const draft=await this.team.reviewRead(sessionId!,'/drafts/'+row.draftId),sources=await this.team.reviewRead(sessionId!,'/sources');
   const original=sources.find((s:any)=>s.id===draft.sourceId&&s.id===row.sourceId);if(!original)throw new NotFoundException('来源商品不存在');
   source={...original,id:receiptReviewSourceId(id),publishing:{currency:draft.shop.currency,variants:draft.variants.map(({sku,price,stock,gtinCode}:any)=>({sku,price,stock,...(gtinCode?{gtinCode}:{})})),...(draft.condition?{condition:draft.condition}:{}),...(draft.preOrder?{preOrder:draft.preOrder}:{})}};
  }
  if(!source?.id)throw new NotFoundException('来源商品不存在');
  const engine=this.service!.engine,existing=engine.listSources(owner).find(s=>s.id===source.id);if(existing)return existing;
  // Only download central authenticated assets; public HTTPS images retain their original URLs.
  const mapped=new Map<string,string>(),urls=new Set<string>([...source.images,...(source.media?.assets||[]).map((a:any)=>a.url)]);
  for(const url of urls)if(/^\/api\/v1\/localization\/assets\/[a-f0-9-]{36}$/.test(url)){const bytes=await this.team.reviewRead(sessionId!,url.replace('/api/v1/localization',''),true);mapped.set(url,this.service!.content.store(owner,bytes));}
  source.images=source.images.map((url:string)=>mapped.get(url)||url);if(source.media)for(const asset of source.media.assets)asset.url=mapped.get(asset.url)||asset.url;
  engine.ensureImportedSource(owner,source,source.id);
  if(source.publishing){try{engine.attachSourcePublishing(owner,source.id,source.publishing);}catch(error){if(!(error instanceof BadRequestException))throw error;engine.markSourcePublishingIssue(owner,source.id);/* Historical incomplete facts remain reviewable; draft validation blocks publication. */}}else engine.markSourcePublishingIssue(owner,source.id);
  return engine.getSource(owner,source.id);
 }
 @Post(':id/open') async open(@Req() req:Request&{localization:LocalizationContext},@Param('id') id:string){
  const {owner,sessionId}=req.localization;
  if(!this.team||this.localReceipt(owner,id)){const row=this.integrations!.listForOwner(owner).records.find(r=>r.id===id);if(!row)throw new NotFoundException('接收记录不存在');if(!row.draftId)throw new BadRequestException('请先选择目标店铺和语言');return this.service!.engine.getDraft(owner,row.draftId);}
  const key=owner+':'+id;if(this.opening.has(key))return this.opening.get(key);
  const work=(async()=>{
   const data=await this.team!.receipts(sessionId!),row=data.records.find((r:any)=>r.id===id);if(!row)throw new NotFoundException('接收记录不存在');
   if(!row.draftId)throw new BadRequestException('请先选择目标店铺和语言');const engine=this.service!.engine,existing=engine.listDrafts(owner).find(d=>d.id===row.draftId);if(existing)return existing;
   const draft=await this.team!.reviewRead(sessionId!,'/drafts/'+row.draftId),sources=await this.team!.reviewRead(sessionId!,'/sources'),source=sources.find((s:any)=>s.id===draft.sourceId);
   if(!source||draft.id!==row.draftId||source.id!==row.sourceId)throw new NotFoundException('接收记录对应资料不完整');
   const urls=new Set<string>([...source.images,...draft.images,...(source.media?.assets||[]).map((a:any)=>a.url),...(draft.media?.assets||[]).map((a:any)=>a.url)]),mapped=new Map<string,string>();
   for(const url of urls)if(/^\/api\/v1\/localization\/assets\/[a-f0-9-]{36}$/.test(url)){const bytes=await this.team!.reviewRead(sessionId!,url.replace('/api/v1/localization',''),true);mapped.set(url,this.service!.content.store(owner,bytes));}
   for(const item of [source,draft]){item.images=item.images.map((url:string)=>mapped.get(url)||url);if(item.media)for(const a of item.media.assets)a.url=mapped.get(a.url)||a.url;}
   return engine.restoreReviewCopy(owner,source,draft);
  })();this.opening.set(key,work);try{return await work;}finally{this.opening.delete(key);}
 }
 @Post(':id/localize') retry(@Req() req:Request&{localization:LocalizationContext},@Param('id') id:string){
  return this.team&&!this.localReceipt(req.localization.owner,id)?this.team.retryReceipt(req.localization.sessionId!,id):this.integrations!.retryForOwner(req.localization.owner,id);
 }
}

@Controller('development/localization/imports')
@UseGuards(DevelopmentGuard)
export class LocalizationReceiptsDevelopmentController {
 constructor(private integrations:LocalizationIntegrationService,private db:Database,@Optional() private service?:LocalizationService){}
 private async owner(req:AuthRequest){return (await this.db.user.findUniqueOrThrow({where:{id:req.userId},select:{email:true}})).email;}
 @Get() async list(@Req() req:AuthRequest){return this.integrations.listForOwner(await this.owner(req));}
 @Get('notifications') async notifications(@Req() req:AuthRequest){const owner=await this.owner(req);return new LocalizationNotifications(this.service!.engine.dir).list(owner,this.integrations.listForOwner(owner).records);}
 @Post('notifications/read') async readNotifications(@Req() req:AuthRequest,@Body() body:unknown){const owner=await this.owner(req);return new LocalizationNotifications(this.service!.engine.dir).markRead(owner,this.integrations.listForOwner(owner).records,body);}
 @Post(':id/localize') async retry(@Req() req:AuthRequest,@Param('id') id:string){return this.integrations.retryForOwner(await this.owner(req),id);}
}
