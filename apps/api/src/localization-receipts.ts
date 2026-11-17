import {Controller,Get,Post,Param,Req,UseGuards,Optional,NotFoundException} from '@nestjs/common';
import type {Request} from 'express';
import {LocalizationService,LocalizationGuard} from './localization';
import {LocalizationIntegrationService} from './localization-integration';
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
 @Get() async list(@Req() req:Request&{localization:LocalizationContext}){
  if(this.team){const data=await this.team.receipts(req.localization.sessionId!);return {records:data.records,environment:'team',reviewOrigin:this.team.managementOrigin};}
  return this.integrations!.listForOwner(req.localization.owner);
 }
 @Post(':id/open') async open(@Req() req:Request&{localization:LocalizationContext},@Param('id') id:string){
  const {owner,sessionId}=req.localization;
  if(!this.team){const row=this.integrations!.listForOwner(owner).records.find(r=>r.id===id);if(!row)throw new NotFoundException('接收记录不存在');return this.service!.engine.getDraft(owner,row.draftId);}
  const key=owner+':'+id;if(this.opening.has(key))return this.opening.get(key);
  const work=(async()=>{
   const data=await this.team!.receipts(sessionId!),row=data.records.find((r:any)=>r.id===id);if(!row)throw new NotFoundException('接收记录不存在');
   const engine=this.service!.engine,existing=engine.listDrafts(owner).find(d=>d.id===row.draftId);if(existing)return existing;
   const draft=await this.team!.reviewRead(sessionId!,'/drafts/'+row.draftId),sources=await this.team!.reviewRead(sessionId!,'/sources'),source=sources.find((s:any)=>s.id===draft.sourceId);
   if(!source||draft.id!==row.draftId||source.id!==row.sourceId)throw new NotFoundException('接收记录对应资料不完整');
   const urls=new Set<string>([...source.images,...draft.images,...(source.media?.assets||[]).map((a:any)=>a.url),...(draft.media?.assets||[]).map((a:any)=>a.url)]),mapped=new Map<string,string>();
   for(const url of urls)if(/^\/api\/v1\/localization\/assets\/[a-f0-9-]{36}$/.test(url)){const bytes=await this.team!.reviewRead(sessionId!,url.replace('/api/v1/localization',''),true);mapped.set(url,this.service!.content.store(owner,bytes));}
   for(const item of [source,draft]){item.images=item.images.map((url:string)=>mapped.get(url)||url);if(item.media)for(const a of item.media.assets)a.url=mapped.get(a.url)||a.url;}
   return engine.restoreReviewCopy(owner,source,draft);
  })();this.opening.set(key,work);try{return await work;}finally{this.opening.delete(key);}
 }
 @Post(':id/localize') retry(@Req() req:Request&{localization:LocalizationContext},@Param('id') id:string){
  return this.team?this.team.retryReceipt(req.localization.sessionId!,id):this.integrations!.retryForOwner(req.localization.owner,id);
 }
}

@Controller('development/localization/imports')
@UseGuards(DevelopmentGuard)
export class LocalizationReceiptsDevelopmentController {
 constructor(private integrations:LocalizationIntegrationService,private db:Database){}
 private async owner(req:AuthRequest){return (await this.db.user.findUniqueOrThrow({where:{id:req.userId},select:{email:true}})).email;}
 @Get() async list(@Req() req:AuthRequest){return this.integrations.listForOwner(await this.owner(req));}
 @Post(':id/localize') async retry(@Req() req:AuthRequest,@Param('id') id:string){return this.integrations.retryForOwner(await this.owner(req),id);}
}
