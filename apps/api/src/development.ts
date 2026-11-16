import {Injectable,CanActivate,ExecutionContext,UnauthorizedException,ForbiddenException,BadRequestException,Controller,Get,Post,Body,Req,Param,UseGuards,Query} from '@nestjs/common';
import type {Request} from 'express';
import {Database} from './database';
import {Auth,AuthRequest} from './auth';
import {hash} from './crypto';
import {Shops} from './shops';
import {createHash} from 'node:crypto';
import type {VideoOperation} from './shopee-client';
@Injectable()
export class DevelopmentGuard implements CanActivate {
 constructor(private db:Database,private auth:Auth){}
 async canActivate(ctx:ExecutionContext){
  const req=ctx.switchToHttp().getRequest<AuthRequest>();
  const token=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,200})$/)?.[1];
  const s=token?await this.db.session.findUnique({where:{tokenHash:hash(token)},include:{user:true}}):await this.auth.session(req);
  if(!s||s.expiresAt<=new Date()||(token&&s.kind!=='DEV'))throw new UnauthorizedException('请先登录中台');
  if(s.user.role!=='ADMIN')throw new ForbiddenException('账号已停用或不可用');
  req.userId=s.userId;req.sessionId=s.id;return true;
 }
}
@Controller('development')
export class DevelopmentController {
 private rates=new Map<string,{start:number;count:number}>();
 constructor(private db:Database,private auth:Auth,private shops:Shops){}
 @Post('login') async login(@Body() b:{email?:unknown;password?:unknown},@Req() req:Request){
  if(typeof b?.email!=='string'||b.email.length>254||typeof b.password!=='string'||b.password.length>256)throw new UnauthorizedException('请输入中台账号');
  return {token:await this.auth.login(b.email.trim().toLowerCase(),b.password,req.ip||'unknown','DEV'),expiresIn:28800};
 }
 @Get('me') @UseGuards(DevelopmentGuard) async me(@Req() req:AuthRequest){return this.db.user.findUniqueOrThrow({where:{id:req.userId},select:{email:true,role:true}});}
 @Post('logout') @UseGuards(DevelopmentGuard) async logout(@Req() req:AuthRequest){await this.db.session.deleteMany({where:{id:req.sessionId}});return {ok:true};}
 @Get('shops') @UseGuards(DevelopmentGuard) async list(@Req() req:AuthRequest){
  return this.db.shopConnection.findMany({select:{id:true,shopId:true,shopName:true,region:true,status:true},orderBy:{authorizedAt:'desc'}});
 }
 @Get('video-capabilities') @UseGuards(DevelopmentGuard) videoCapabilities(){return {version:2};}
 @Post('shops/:id/video/:operation') @UseGuards(DevelopmentGuard)
 async video(@Param('id') id:string,@Param('operation') operation:string,@Body() b:Record<string,unknown>,@Req() req:AuthRequest){
  const ops:VideoOperation[]=['init','part','complete','result','update'];if(!ops.includes(operation as VideoOperation)||!b||typeof b!=='object'||Array.isArray(b))throw new BadRequestException('请求无效');
  const op=operation as VideoOperation;const uploadId=b.video_upload_id;
  if(op!=='init'&&(typeof uploadId!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(uploadId)))throw new BadRequestException('视频上传 ID 无效');
  let input:Record<string,unknown>;
  if(op==='init'){
   if(!Number.isInteger(b.file_size)||Number(b.file_size)<1||Number(b.file_size)>30*1024*1024||typeof b.file_md5!=='string'||!/^[a-f0-9]{32}$/.test(b.file_md5))throw new BadRequestException('视频大小或校验值无效');
   input={file_size:b.file_size,file_md5:b.file_md5};
  }else if(op==='part'){
   if(!Number.isInteger(b.part_seq)||Number(b.part_seq)<0||Number(b.part_seq)>100||typeof b.data!=='string'||b.data.length>5600000||b.data.length%4!==0||/[^A-Za-z0-9+/=]/.test(b.data))throw new BadRequestException('视频分片无效');
   const bytes=Buffer.from(b.data,'base64');if(!bytes.length||bytes.length>4*1024*1024||bytes.toString('base64')!==b.data)throw new BadRequestException('视频分片大小无效');
   input={video_upload_id:uploadId,part_seq:b.part_seq,content_md5:createHash('md5').update(bytes).digest('hex'),data:b.data};
  }else if(op==='complete'){
   if(!Array.isArray(b.part_seq_list)||!b.part_seq_list.length||b.part_seq_list.length>8||b.part_seq_list.some((n,i)=>n!==i))throw new BadRequestException('分片序号无效');
   input={video_upload_id:uploadId,part_seq_list:b.part_seq_list,report_data:{upload_cost:Math.max(0,Math.min(3600000,Number(b.upload_cost)||0))}};
  }else if(op==='result')input={video_upload_id:uploadId};
  else {
   const unknown=b.expected_video_info===null&&b.unknown_video_acknowledged===true;
   if(typeof b.item_id!=='string'||!/^\d{1,15}$/.test(b.item_id)||!Number.isSafeInteger(Number(b.item_id))||(!Array.isArray(b.expected_video_info)&&!unknown))throw new BadRequestException('商品或视频核对信息无效');
   const current=await this.shops.read(id,req.userId,'/api/v2/product/get_item_base_info',{item_id_list:b.item_id}) as {item_list?:Array<{item_id:number;video_info?:unknown}>};
   const item=current.item_list?.find(i=>String(i.item_id)===b.item_id);
   if(!item||(unknown?Object.hasOwn(item,'video_info'):!Array.isArray(item.video_info)||JSON.stringify(item.video_info)!==JSON.stringify(b.expected_video_info)))throw new BadRequestException('商品视频信息已变化或不可确认，请重新核对');
   const result=await this.shops.video(id,req.userId,'result',{video_upload_id:uploadId}) as {status?:string};if(result.status!=='SUCCEEDED')throw new BadRequestException('视频尚未完成转码');
   input={item_id:Number(b.item_id),video_upload_id:[uploadId]};
  }
  try {const result=await this.shops.video(id,req.userId,op,input);await this.shops.audit(req.userId,'DEV_VIDEO_'+op.toUpperCase(),id,'SUCCESS');return result;}
  catch(e){await this.shops.audit(req.userId,'DEV_VIDEO_'+op.toUpperCase(),id,'FAILED_OR_UNKNOWN');throw e;}
 }
 @Get('shops/:id/read/:operation') @UseGuards(DevelopmentGuard)
 async read(@Param('id') id:string,@Param('operation') operation:string,@Query() q:Record<string,unknown>,@Req() req:AuthRequest){
  // Only read methods are exposed. Caller cannot supply a URL, signature or token.
  const allowed:Record<string,string[]>={get_item_list:['offset','page_size','item_status'],get_item_base_info:['item_id_list'],get_model_list:['item_id'],get_category:['language'],get_attribute_tree:['category_id','language'],get_brand_list:['offset','page_size','category_id','status'],get_item_limit:[],get_channel_list:[]};
  if(!Object.hasOwn(allowed,operation))throw new BadRequestException('此接口未开放；写入接口需随工具另行接入');
  const query:Record<string,string>={};
  for(const [k,v] of Object.entries(q)){
   if(!allowed[operation].includes(k)||typeof v!=='string'||v.length>1000)throw new BadRequestException('不支持的查询参数');
   if(['offset','page_size','category_id','item_id'].includes(k)&&(!/^\d{1,15}$/.test(v)||Number(v)>Number.MAX_SAFE_INTEGER))throw new BadRequestException('数字参数无效');
   query[k]=v;
  }
  if(query.page_size&&(Number(query.page_size)<1||Number(query.page_size)>100))throw new BadRequestException('每页需1—100条');
  if(operation==='get_item_list'){
   query.offset||='0';query.page_size||='20';query.item_status||='NORMAL';
   if(!['NORMAL','UNLIST','BANNED','DELETED'].includes(query.item_status))throw new BadRequestException('商品状态无效');
  }
  if(operation==='get_item_base_info'&&(!query.item_id_list||!/^\d{1,15}(,\d{1,15}){0,49}$/.test(query.item_id_list)))throw new BadRequestException('需1—50个商品ID');
  if(operation==='get_model_list'&&!query.item_id)throw new BadRequestException('需要商品ID');
  if(['get_attribute_tree','get_brand_list'].includes(operation)&&!query.category_id)throw new BadRequestException('需要类目ID');
  const now=Date.now(),rate=this.rates.get(req.userId);if(!rate||now-rate.start>60000)this.rates.set(req.userId,{start:now,count:1});else if(++rate.count>60)throw new ForbiddenException('调用过于频繁，请稍后重试');
  if(this.rates.size>10000)for(const [k,v] of this.rates)if(now-v.start>60000)this.rates.delete(k);
  const path=`/api/v2/${operation==='get_channel_list'?'logistics':'product'}/${operation}`;
  try{const result=await this.shops.read(id,req.userId,path,query);await this.shops.audit(req.userId,'DEV_READ',`${id}:${operation}`,'SUCCESS');return result;}
  catch(e){await this.shops.audit(req.userId,'DEV_READ',`${id}:${operation}`,'FAILED');throw e;}
 }
}
