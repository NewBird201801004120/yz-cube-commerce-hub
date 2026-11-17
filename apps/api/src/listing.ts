import {Injectable,Controller,Get,Post,Put,Delete,Body,Param,Req,Res,UseGuards,CanActivate,ExecutionContext,Optional,UnauthorizedException,BadRequestException,NotFoundException,ConflictException,OnModuleInit} from '@nestjs/common';
import type {Request,Response} from 'express';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {zipSync,unzipSync} from 'fflate';
import {Auth} from './auth';
import {TeamShopClient} from './team-client';
import {encrypt,decrypt} from './crypto';
import {Asset,Fact,Slot,ModelConfig,publicUrl,imageMime,provider,planListing,generateImage,readLimited,reviewImage} from './listing-engine';
type AiConfig={planner:ModelConfig;image:ModelConfig};
type Document={id:string;name:string;text:string};
type Job={sku?:string;brand?:string;visualBrief?:string;planVersion?:number;seoTitle?:string;sellingPoints?:{text:string;sourceId:string;reason:string}[];verificationNotes?:string[];id:string;owner:string;name:string;market:string;language:string;notes:string;count:number;createdAt:string;updatedAt:string;status:'planning'|'running'|'stopping'|'paused'|'done'|'partial'|'error';requestId?:string;requestDigest?:string;deletedAt?:string;deletedSlots?:Slot[];categoryProfile?:string;visualIdentity?:string;designSystem?:string;primary:Asset;supplements:Asset[];documents:Document[];facts:Fact[];skipped:string[];slots:Slot[];error?:string};
type ListingRequest=Request&{listingOwner:string};
const MB=1024*1024;
function text(v:unknown,max:number,fallback=''){if(v===undefined)return fallback;if(typeof v!=='string'||v.length>max)throw new BadRequestException('文字参数格式或长度不正确');return v.trim();}
function atomic(file:string,value:string|Buffer){const tmp=`${file}.${randomUUID()}.tmp`;writeFileSync(tmp,value,{mode:0o600});renameSync(tmp,file);}
function decode(raw:unknown,max:number){if(typeof raw!=='string'||raw.length>Math.ceil(max/3)*4||!raw.length||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw))throw new BadRequestException('文件内容无效或超过限制');const b=Buffer.from(raw,'base64');if(b.length>max)throw new BadRequestException('文件过大');return b;}
function asset(raw:unknown,id:string):Asset{const a=raw as Record<string,unknown>;if(!a)throw new BadRequestException('请上传产品图片');const b=decode(a.data,8*MB),mime=imageMime(b);if(!mime)throw new BadRequestException('图片仅支持 PNG、JPEG、WebP');return {id,name:text(a.name,160,'产品图片'),mime,data:b.toString('base64')};}
export async function parameterFile(raw:unknown,id:string):Promise<Document>{
 const f=raw as Record<string,unknown>;if(!f)throw new BadRequestException('参数文件无效');const name=text(f.name,160),b=decode(f.data,8*MB),ext=name.split('.').pop()?.toLowerCase();let value='';
 try{
  if(['txt','csv','json','md'].includes(ext||'')){value=new TextDecoder('utf-8',{fatal:true}).decode(b);}
  else if(ext==='pdf'){const {extractText}=await import('unpdf');value=(await extractText(new Uint8Array(b),{mergePages:true})).text;}
  else if(ext==='docx'){checkArchive(b);value=(await (await import('mammoth')).extractRawText({buffer:b})).value;}
  else if(ext==='xlsx'){checkArchive(b);const {Workbook}=await import('exceljs');const w=new Workbook();await w.xlsx.load(b as never);let rows=0;w.eachSheet(s=>{value+=`\n[工作表：${s.name}]\n`;s.eachRow(r=>{if(++rows>2000)throw Error('too many rows');value+=`行${r.number}: ${r.values?.toString()}\n`;});});}
  else throw new BadRequestException('参数文件支持 PDF、DOCX、XLSX、CSV、TXT、JSON、Markdown');
 }catch(e){if(e instanceof BadRequestException)throw e;throw new BadRequestException(`无法读取参数文件 ${name}，请确认文件未加密，或另存为 TXT / CSV`);}
 if(!value.trim())throw new BadRequestException(`${name} 没有可读取的文字；扫描件请转成补充图片上传`);
 if(value.length>40000)throw new BadRequestException(`${name} 文字超过 4 万字，请仅保留相关产品参数`);
 return {id,name,text:value};
}
function checkArchive(bytes:Buffer){let size=0,count=0;unzipSync(bytes,{filter(file){size+=file.originalSize;count++;if(size>40*MB||count>2000)throw Error('archive too large');return false;}});}
@Injectable()
export class ListingGuard implements CanActivate{
 constructor(@Optional() private auth?:Auth,@Optional() private team?:TeamShopClient){}
 async canActivate(ctx:ExecutionContext){const r=ctx.switchToHttp().getRequest<ListingRequest>();
  if(this.auth){const s=await this.auth.session(r);if(!s||s.user.role!=='ADMIN')throw new UnauthorizedException('请先登录中台');r.listingOwner=s.user.email;}
  else if(this.team){const me=await this.team.me(r.cookies?.yz_team);r.listingOwner=me.email;}
  else throw new UnauthorizedException('请先登录中台');if(!r.listingOwner)throw new UnauthorizedException('请先登录中台');return true;
 }
}
@Injectable()
export class ListingService implements OnModuleInit{
 readonly dir=resolve(process.env.LISTING_DATA_DIR||'.local/listing');private key:Buffer;private active=new Set<string>();private configBusy=false;private stops=new Set<string>();private reviewing=new Set<string>();private submissions=new Map<string,{digest:string;promise:Promise<ReturnType<ListingService['view']>>}>();
 constructor(){mkdirSync(join(this.dir,'jobs'),{recursive:true,mode:0o700});mkdirSync(join(this.dir,'images'),{recursive:true,mode:0o700});const keyPath=join(this.dir,'encryption.key');
  if(!existsSync(keyPath))writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});this.key=readFileSync(keyPath);if(this.key.length!==32)throw Error('Listing encryption key invalid');
 }
 onModuleInit(){for(const f of readdirSync(join(this.dir,'jobs'))){if(!f.endsWith('.json'))continue;const j=JSON.parse(readFileSync(join(this.dir,'jobs',f),'utf8')) as Job;if(['running','planning','stopping'].includes(j.status)){j.status='partial';j.error='服务已重启，可继续未完成的图片';for(const s of j.slots)if(s.status==='generating')s.status='error';this.save(j);}}}
 private save(j:Job){if(this.stops.has(j.id)&&j.status==='running')j.status='stopping';j.updatedAt=new Date().toISOString();atomic(join(this.dir,'jobs',`${j.id}.json`),JSON.stringify(j));}
 private config():AiConfig|null{const p=join(this.dir,'config.enc');return existsSync(p)?JSON.parse(decrypt(readFileSync(p,'utf8'),this.key)):null;}
 settings(){const c=this.config();const masked=(v?:ModelConfig)=>({baseUrl:v?.baseUrl||'https://api.openai.com/v1',model:v?.model||'',hasKey:!!v?.apiKey});return {planner:masked(c?.planner),image:masked(c?.image)};}
 async configure(raw:unknown){
  if(this.configBusy||this.active.size)throw new ConflictException('任务执行期间不能修改配置，请稍后再试');this.configBusy=true;
  try{const b=raw as Record<string,unknown>;if(!b)throw new BadRequestException('配置格式无效');const old=this.config(),next={} as AiConfig;
   for(const kind of ['planner','image'] as const){const value=b[kind] as Record<string,unknown>;if(!value)throw new BadRequestException('请配置策划模型和生图模型');const model=text(value.model,150),baseUrl=await publicUrl(text(value.baseUrl,400)),apiKey=text(value.apiKey,2048)||(old?.[kind].baseUrl===baseUrl?old[kind].apiKey:'');if(!model||!apiKey||/[\r\n]/.test(apiKey))throw new BadRequestException('请填写模型和 API 密钥');next[kind]={baseUrl,model,apiKey};}
   atomic(join(this.dir,'config.enc'),encrypt(JSON.stringify(next),this.key));return this.settings();
  }finally{this.configBusy=false;}
 }
 async models(kind:string,raw:unknown){
  if(!['planner','image'].includes(kind))throw new BadRequestException('模型类型无效');
  const b=raw as Record<string,unknown>;if(!b||typeof b!=='object')throw new BadRequestException('请填写 API 地址和密钥');
  const saved=this.config()?.[kind as keyof AiConfig],base=await publicUrl(text(b.baseUrl,400)),entered=text(b.apiKey,2048);
  // A saved credential must never be forwarded to a newly entered host.
  const apiKey=entered||(saved?.baseUrl===base?saved.apiKey:'');
  if(!apiKey||/[\r\n]/.test(apiKey))throw new BadRequestException('请填写当前 API 的密钥；地址变更后需重新填写密钥');
  let res:globalThis.Response;try{res=await fetch(`${base}/models`,{headers:{Authorization:`Bearer ${apiKey}`},redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new BadRequestException('模型列表获取超时或连接失败，请检查 API 地址');}
  if(!res.ok){await res.body?.cancel();throw new BadRequestException(res.status===401||res.status===403?'模型列表访问被拒绝，请检查 API 密钥和权限':`无法获取模型列表（HTTP ${res.status}），可手动填写模型名称`);}
  let payload:unknown;try{payload=JSON.parse((await readLimited(res,2*MB)).toString());}catch{throw new BadRequestException('API 返回的模型列表格式无效，可手动填写模型名称');}
  const data=(payload as {data?:unknown})?.data;
  if(!Array.isArray(data))throw new BadRequestException('当前 API 未返回兼容的模型列表，可手动填写模型名称');
  const models=[...new Set(data.map((m:unknown)=>typeof m==='string'?m:(m as {id?:unknown})?.id).filter((id:unknown):id is string=>typeof id==='string'&&!!id.trim()&&id.length<=150).map(id=>id.trim()))].sort((a,b)=>a.localeCompare(b));
  if(!models.length)throw new BadRequestException('当前 API 未返回可选模型，可手动填写模型名称');
  return {models};
 }
 async test(kind:string){if(!['planner','image'].includes(kind))throw new BadRequestException('模型类型无效');const c=this.config()?.[kind as keyof AiConfig];if(!c)throw new BadRequestException('请先保存 API 配置');
  if(kind==='planner'){const r=await provider(c,'/chat/completions',JSON.stringify({model:c.model,messages:[{role:'user',content:'Reply OK.'}],max_completion_tokens:32}),true);if(!r.choices?.[0]?.message?.content)throw new BadRequestException('模型没有返回可用文本');return {message:'文本连接测试通过；图片理解能力以实际生成任务为准'};}
  const base=await publicUrl(c.baseUrl);const r=await fetch(`${base}/models/${encodeURIComponent(c.model)}`,{headers:{Authorization:`Bearer ${c.apiKey}`},redirect:'error',signal:AbortSignal.timeout(20000)}).catch(()=>null);await r?.body?.cancel();if(!r?.ok)throw new BadRequestException('模型查询未通过；部分服务商不提供此接口，请以实际生图结果为准');return {message:'模型查询通过；未产生图片，生图权限和出图结果需在实际任务中验证'};
 }
 private load(id:string,owner:string){if(!/^[a-f0-9-]{36}$/.test(id))throw new NotFoundException('任务不存在');const p=join(this.dir,'jobs',`${id}.json`);if(!existsSync(p))throw new NotFoundException('任务不存在');const j=JSON.parse(readFileSync(p,'utf8')) as Job;if(j.owner!==owner||j.deletedAt)throw new NotFoundException('任务不存在');return j;}
 private view(j:Job,full=true){return {id:j.id,name:j.name,sku:j.sku,brand:j.brand,visualBrief:j.visualBrief,market:j.market,language:j.language,createdAt:j.createdAt,updatedAt:j.updatedAt,status:j.status,error:j.error,count:j.count,completed:j.slots.filter(s=>s.status==='success').length,total:j.slots.length,...(full?{notes:j.notes,planVersion:j.planVersion,seoTitle:j.seoTitle,sellingPoints:j.sellingPoints,verificationNotes:j.verificationNotes,attachments:[j.primary,...j.supplements,...j.documents].map(a=>({id:a.id,name:a.name})),facts:j.facts,skipped:j.skipped,categoryProfile:j.categoryProfile,visualIdentity:j.visualIdentity,designSystem:j.designSystem,slots:j.slots.map(s=>({...s,hasPrevious:!!s.previousFiles?.length,imageUrl:s.file?`/api/v1/listing/jobs/${j.id}/images/${s.file}`:undefined}))}:{})};}
 list(owner:string){return readdirSync(join(this.dir,'jobs')).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(join(this.dir,'jobs',f),'utf8')) as Job).filter(j=>j.owner===owner&&!j.deletedAt).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100).map(j=>this.view(j,false));}
 get(id:string,owner:string){return this.view(this.load(id,owner));}
 async create(raw:unknown,owner:string){
  const b=raw as Record<string,unknown>;if(!b||typeof b!=='object')throw new BadRequestException('任务参数无效');
  const requestId=b.requestId===undefined?undefined:text(b.requestId,100);if(requestId!==undefined&&!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId))throw new BadRequestException('请求标识无效');
  const {requestId:ignored,...payload}=b;void ignored;
  const digest=createHash('sha256').update(JSON.stringify(payload)).digest('hex'),key=JSON.stringify([owner,requestId||digest]);
  const same=(j:Job)=>j.owner===owner&&((requestId&&j.requestId===requestId)||(this.active.has(j.id)&&j.requestDigest===digest));
  const existing=readdirSync(join(this.dir,'jobs')).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(join(this.dir,'jobs',f),'utf8')) as Job).find(same);
  if(existing){if(existing.deletedAt)throw new ConflictException('此请求对应的组图已删除，请新建组图');if(existing.requestDigest!==digest)throw new ConflictException('同一请求标识不能用于不同产品资料');return this.view(existing);}
  const pending=this.submissions.get(key);if(pending){if(pending.digest!==digest)throw new ConflictException('同一请求标识不能用于不同产品资料');return pending.promise;}
  const promise=this.createNew(raw,owner,requestId,digest);this.submissions.set(key,{digest,promise});
  try{return await promise;}finally{this.submissions.delete(key);}
 }
 private async createNew(raw:unknown,owner:string,requestId:string|undefined,requestDigest:string){
  if(!this.config())throw new BadRequestException('请先到系统设置完成 AI API 配置');if(this.active.size>=2||this.configBusy)throw new ConflictException('当前任务较多，请等待任务完成后再试');
  const b=raw as Record<string,unknown>;if(!b)throw new BadRequestException('任务参数无效');const count=b.count===undefined?6:b.count;if(![4,6,8].includes(count as number))throw new BadRequestException('请选择 4、6 或 8 张');
  const supplements=b.supplements===undefined?[]:b.supplements,documents=b.documents===undefined?[]:b.documents;if(!Array.isArray(supplements)||supplements.length>5||!Array.isArray(documents)||documents.length>3)throw new BadRequestException('最多补充 5 张图片和 3 个文件');
  // Reserve capacity before awaiting document parsers.
  const id=randomUUID();this.active.add(id);
  try{const primary=asset(b.primary,'primary'),images=supplements.map((s,i)=>asset(s,`image-${i+1}`));let size=primary.data.length+images.reduce((n,s)=>n+s.data.length,0);for(const d of documents)size+=typeof d?.data==='string'?d.data.length:0;if(size>28*MB)throw new BadRequestException('附件总大小不能超过 20MB');
   const docs:Document[]=[];for(let i=0;i<documents.length;i++)docs.push(await parameterFile(documents[i],`file-${i+1}`));
   const j:Job={id,owner,requestId,requestDigest,sku:text(b.sku,150),brand:text(b.brand,100),visualBrief:text(b.visualBrief,2000),name:text(b.name,150,'未命名产品')||'未命名产品',market:text(b.market,80,'菲律宾'),language:text(b.language,80,'英语'),notes:text(b.notes,10000),count:count as number,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),status:'planning',primary,supplements:images,documents:docs,facts:[],skipped:[],slots:[]};this.save(j);void this.run(j,true);return this.view(j);
  }catch(e){this.active.delete(id);throw e;}
 }
 private assertEditable(id:string){if(this.active.has(id)||[...this.reviewing].some(key=>JSON.parse(key)[0]===id))throw new ConflictException('请先停止任务并等待当前生成或检查完成后再删除');}
 remove(id:string,owner:string,slotId?:string){const j=this.load(id,owner);this.assertEditable(id);
  if(slotId){const index=j.slots.findIndex(s=>s.id===slotId);if(index<0)throw new NotFoundException('图片不存在');const [slot]=j.slots.splice(index,1);j.deletedSlots=[...(j.deletedSlots||[]),slot];j.status=j.slots.every(s=>s.status==='success')?'done':'partial';j.error=undefined;}
  else j.deletedAt=new Date().toISOString();
  this.save(j);return slotId?this.view(j):{id:j.id,deleted:true};
 }
 async review(id:string,owner:string,slotId:string){const j=this.load(id,owner),slot=j.slots.find(s=>s.id===slotId),key=JSON.stringify([id,slotId]);if(this.active.has(id)||this.reviewing.has(key))throw new ConflictException('请等待当前任务结束后检查');if(!slot?.file||slot.status!=='success')throw new BadRequestException('请先生成图片');const c=this.config();if(!c)throw new BadRequestException('请先配置 AI API');this.reviewing.add(key);
  try{const file=slot.file,bytes=readFileSync(this.image(id,file,owner)),review=await reviewImage(c.planner,j.primary,bytes,imageMime(bytes)||'image/png',JSON.stringify({market:j.market,language:j.language,facts:j.facts,visualIdentity:j.visualIdentity,designSystem:j.designSystem,prompt:slot.prompt}));const current=this.load(id,owner),latest=current.slots.find(s=>s.id===slotId);if(this.active.has(id)||latest?.file!==file)throw new ConflictException('图片已更新，请对新图片重新检查');latest.review=review;this.save(current);return this.view(current);}finally{this.reviewing.delete(key);}}
 restore(id:string,owner:string,slotId:string){const j=this.load(id,owner);if(this.active.has(id))throw new ConflictException('请等待任务结束后还原');const slot=j.slots.find(s=>s.id===slotId);if(!slot?.previousFiles?.length)throw new BadRequestException('没有可还原的图片');const previous=slot.previousFiles.pop()!;if(slot.file)slot.previousFiles.unshift(slot.file);slot.file=previous;slot.output=undefined;slot.review=undefined;slot.status='success';slot.error=undefined;j.status=j.slots.every(s=>s.status==='success')?'done':'partial';this.save(j);return this.view(j);}
 stop(id:string,owner:string){const j=this.load(id,owner);if(!this.active.has(id))return this.view(j);this.stops.add(id);j.status='stopping';this.save(j);return this.view(j);}
 async retry(id:string,owner:string,slotId?:string,prompt?:string){const j=this.load(id,owner);if(!j.slots.length&&j.deletedSlots?.length)throw new BadRequestException('本组图片已全部删除，请新建组图');if(this.active.has(id)||this.active.size>=2||this.configBusy)throw new ConflictException('任务正在执行，请稍后再试');
  if(slotId){const s=j.slots.find(s=>s.id===slotId);if(!s)throw new NotFoundException('图片不存在');if(prompt!==undefined)s.prompt=text(prompt,8000)||s.prompt;s.status='pending';s.error=undefined;}
  else for(const s of j.slots)if(s.status!=='success'){s.status='pending';s.error=undefined;}
  this.active.add(id);j.status=j.slots.length?'running':'planning';j.error=undefined;this.save(j);void this.run(j,!j.slots.length,slotId);return this.view(j);
 }
 private async run(j:Job,plan:boolean,onlySlot?:string){try{const c=this.config();if(!c)throw Error('请先配置 AI API');if(plan){const result=await planListing(c.planner,j);Object.assign(j,result);}j.status=this.stops.has(j.id)?'stopping':'running';this.save(j);
  for(const slot of j.slots){if(this.stops.has(j.id))break;if(slot.status==='success'||onlySlot&&slot.id!==onlySlot)continue;slot.status='generating';this.save(j);try{const {bytes,mime,output}=await generateImage(c.image,slot,j.primary,j.supplements,JSON.stringify({market:j.market,language:j.language,brand:j.brand,visualBrief:j.visualBrief,sellingPoints:j.sellingPoints,facts:j.facts,categoryProfile:j.categoryProfile,visualIdentity:j.visualIdentity,designSystem:j.designSystem}));const ext=mime==='image/jpeg'?'jpg':mime.split('/')[1];const file=`${j.id}-${slot.id}-${randomUUID()}.${ext}`;atomic(join(this.dir,'images',file),bytes);if(slot.file)slot.previousFiles=[...(slot.previousFiles||[]),slot.file].slice(-5);slot.file=file;slot.output=output;slot.review=undefined;slot.status='success';slot.error=undefined;}catch(e){slot.status='error';slot.error=e instanceof BadRequestException?e.message:e instanceof Error?e.message:'生成失败，请重试';}this.save(j);}
  j.status=j.slots.length&&j.slots.every(s=>s.status==='success')?'done':this.stops.has(j.id)?'paused':'partial';
 }catch(e){j.status=this.stops.has(j.id)?'paused':'error';j.error=e instanceof Error?e.message:'生成未完成';}finally{this.save(j);this.active.delete(j.id);this.stops.delete(j.id);}}
 image(id:string,file:string,owner:string){const j=this.load(id,owner);if(!j.slots.some(s=>s.file===file)||!/^[-_a-z0-9]+\.(png|jpg|webp)$/.test(file))throw new NotFoundException('图片不存在');const path=join(this.dir,'images',file);if(!existsSync(path))throw new NotFoundException('图片文件不存在');return path;}
 download(id:string,owner:string){const j=this.load(id,owner),files:Record<string,Uint8Array>={};for(const s of j.slots)if(s.status==='success'&&s.file)files[`${s.id}.${s.file.split('.').pop()}`]=readFileSync(this.image(id,s.file,owner));if(!Object.keys(files).length)throw new BadRequestException('还没有成功生成的图片');
 if(j.planVersion===2){files['SEO-title.txt']=Buffer.from(j.seoTitle||'未生成标题');files['核验说明.txt']=Buffer.from([
  `产品：${j.name}\nSKU：${j.sku||'未填写'}\n品牌：${j.brand||'未填写'}\n市场：${j.market}\n图片语言：${j.language}`,
  '以下为AI基于上传资料整理的核对信息，非人工验收或实测。图片及标题用于发布前仍需人工核对。',
  `SEO 标题（${Array.from(j.seoTitle||'').length}/100）：${j.seoTitle||'无'}`,
  '卖点依据：',...(j.sellingPoints||[]).map(p=>`${p.text}；来源：${[j.primary,...j.supplements,...j.documents].find(a=>a.id===p.sourceId)?.name||p.sourceId}；选择理由：${p.reason}`),
  '产品事实：',...j.facts.map(f=>`${f.key}：${f.value}；来源：${[j.primary,...j.supplements,...j.documents].find(a=>a.id===f.sourceId)?.name||(f.sourceId==='notes'?'产品说明':f.sourceId)}`),
  '缺项与冲突：',...(j.verificationNotes||[]),'跳过内容：',...j.skipped,
  '导出：新生成图片为800×800 JPG，小于2,000,000字节；历史版本可能采用旧格式。下载仅包含当前已成功图片，失败或已删图片不包含在内。'
 ].join('\n'));}
 return Buffer.from(zipSync(files,{level:0}));}
}
@Controller()
@UseGuards(ListingGuard)
export class ListingController{
 constructor(private listings:ListingService){}
 @Get('settings/ai') settings(){return this.listings.settings();}
 @Put('settings/ai') configure(@Body() b:unknown){return this.listings.configure(b);}
 @Post('settings/ai/models/:kind') models(@Param('kind') kind:string,@Body() b:unknown){return this.listings.models(kind,b);}
 @Post('settings/ai/test/:kind') async test(@Param('kind') kind:string){try{return await this.listings.test(kind);}catch(e){if(e instanceof BadRequestException)throw e;throw new BadRequestException(e instanceof Error?e.message:'连接测试失败');}}
 @Get('listing/jobs') list(@Req() r:ListingRequest){return this.listings.list(r.listingOwner);}
 @Post('listing/jobs') create(@Body() b:unknown,@Req() r:ListingRequest){return this.listings.create(b,r.listingOwner);}
 @Get('listing/jobs/:id') get(@Param('id') id:string,@Req() r:ListingRequest){return this.listings.get(id,r.listingOwner);}
 @Delete('listing/jobs/:id') remove(@Param('id') id:string,@Req() r:ListingRequest){return this.listings.remove(id,r.listingOwner);}
 @Delete('listing/jobs/:id/slots/:slotId') removeSlot(@Param('id') id:string,@Param('slotId') slotId:string,@Req() r:ListingRequest){return this.listings.remove(id,r.listingOwner,slotId);}
 @Get('listing/jobs/:id/download') download(@Param('id') id:string,@Req() r:ListingRequest,@Res() res:Response){const bytes=this.listings.download(id,r.listingOwner);res.type('application/zip').setHeader('Content-Disposition',`attachment; filename="listing-${id}.zip"`);res.send(bytes);}
 @Post('listing/jobs/:id/slots/:slotId/review') async review(@Param('id') id:string,@Param('slotId') slotId:string,@Req() r:ListingRequest){try{return await this.listings.review(id,r.listingOwner,slotId);}catch(e){if(e instanceof Error&&'getStatus' in e)throw e;throw new BadRequestException(e instanceof Error?e.message:'图片检查失败');}}
 @Post('listing/jobs/:id/slots/:slotId/restore') restore(@Param('id') id:string,@Param('slotId') slotId:string,@Req() r:ListingRequest){return this.listings.restore(id,r.listingOwner,slotId);}
 @Post('listing/jobs/:id/stop') stop(@Param('id') id:string,@Req() r:ListingRequest){return this.listings.stop(id,r.listingOwner);}
 @Post('listing/jobs/:id/retry') retry(@Param('id') id:string,@Req() r:ListingRequest,@Body() b:{slotId?:unknown;prompt?:unknown}){if(b?.slotId!==undefined&&typeof b.slotId!=='string'||b?.prompt!==undefined&&typeof b.prompt!=='string')throw new BadRequestException('重试参数无效');return this.listings.retry(id,r.listingOwner,b?.slotId as string|undefined,b?.prompt as string|undefined);}
 @Get('listing/jobs/:id/images/:file') image(@Param('id') id:string,@Param('file') file:string,@Req() r:ListingRequest,@Res() res:Response){res.setHeader('Content-Disposition',`${r.query.download==='1'?'attachment':'inline'}; filename="${file}"`);res.sendFile(this.listings.image(id,file,r.listingOwner),{dotfiles:'allow'});}
}
