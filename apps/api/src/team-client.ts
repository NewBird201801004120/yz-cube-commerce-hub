import {safePlatformDiagnostic} from './shopee-client';
import {ForbiddenException,Injectable,UnauthorizedException} from '@nestjs/common';
/** Local tool modules inject this service; the browser never receives the remote bearer. */
@Injectable()
export class TeamShopClient {
 private sessions=new Map<string,{token:string;expiresAt:number;webCookie?:string}>();
 private origin=process.env.TEAM_API_ORIGIN||'https://commerce.aicbec.cn';
 constructor(){const u=new URL(this.origin);if(u.protocol!=='https:'&&!(process.env.NODE_ENV==='test'&&u.hostname==='127.0.0.1'))throw Error('Team API requires HTTPS');if(u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Team API must be an origin');this.origin=u.origin;}
 get managementOrigin(){return this.origin;}
 async request(path:string,token?:string,body?:unknown){
  const res=await fetch(`${this.origin}/api/v1/development${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000),redirect:'error'});
  const data=await res.json();if(!res.ok){const {HttpException}=await import('@nestjs/common');throw new HttpException({message:data.message||'团队服务请求失败',diagnostic:safePlatformDiagnostic(data.diagnostic)},res.status);}return data;
 }
 async login(email:string,password:string,id:string){
  const r=await this.request('/login',undefined,{email,password});
  for(const [k,v] of this.sessions)if(v.expiresAt<Date.now())this.sessions.delete(k);
  if(this.sessions.size>=100)throw new UnauthorizedException('本地会话过多，请重启开发服务');
  let webCookie:string|undefined;
  try{const web=await fetch(this.origin+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:this.origin},body:JSON.stringify({email,password}),signal:AbortSignal.timeout(25000),redirect:'error'});if(web.ok)webCookie=web.headers.getSetCookie().find(c=>c.startsWith('yz_session='))?.split(';')[0];}catch{}
  this.sessions.set(id,{token:r.token,expiresAt:Date.now()+r.expiresIn*1000,webCookie});
 }
 private token(id:string){const s=this.sessions.get(id);if(!s||s.expiresAt<Date.now()){this.sessions.delete(id);throw new UnauthorizedException('请重新登录中台账号');}return s.token;}
 me(id:string){return this.request('/me',this.token(id));}
 shops(id:string){return this.request('/shops',this.token(id));}
 read(id:string,connectionId:string,operation:string,query:Record<string,string>={}){return this.request(`/shops/${encodeURIComponent(connectionId)}/read/${encodeURIComponent(operation)}?${new URLSearchParams(query)}`,this.token(id));}
 localization(id:string,connectionId:string,operation:string,body:unknown={}){if(process.env.LOCALIZATION_LOCAL_MODE==='true')throw new ForbiddenException('本地模拟模式不允许调用中央 Shopee 商品接口');return this.request(`/localization/shops/${encodeURIComponent(connectionId)}/${encodeURIComponent(operation)}`,this.token(id),body);}
 async reviewRead(id:string,path:string,binary=false):Promise<any>{
  this.token(id);const cookie=this.sessions.get(id)?.webCookie;if(!cookie)throw new UnauthorizedException('请重新登录本地中台，以读取生产完整商品资料');
  if(!/^\/(sources|drafts\/[a-f0-9-]{36}|assets\/[a-f0-9-]{36})$/.test(path))throw new ForbiddenException('资料读取路径无效');
  const res=await fetch(this.origin+'/api/v1/localization'+path,{headers:{Cookie:cookie},signal:AbortSignal.timeout(25000),redirect:'error'});
  if(!res.ok){const {HttpException}=await import('@nestjs/common');throw new HttpException('生产商品资料读取失败，请核对账号权限后重试',res.status);}
  if(binary){if(Number(res.headers.get('content-length'))>8*1024*1024)throw new ForbiddenException('生产图片超过8MB');const bytes=Buffer.from(await res.arrayBuffer());if(bytes.length>8*1024*1024)throw new ForbiddenException('生产图片超过8MB');return bytes;}return res.json();
 }
 async auditLogs(id:string){
  this.token(id);const me=await this.me(id);if(me.role!=='ADMIN')throw new ForbiddenException('当前账号没有查看授权记录的权限');
  const cookie=this.sessions.get(id)?.webCookie;if(!cookie)throw new UnauthorizedException('请重新登录本地中台，以读取授权操作记录');
  const res=await fetch(this.origin+'/api/v1/audit-logs',{headers:{Cookie:cookie},signal:AbortSignal.timeout(25000),redirect:'error'});
  if(!res.ok){const {HttpException}=await import('@nestjs/common');throw new HttpException('授权操作记录读取失败，请核对登录状态和权限',res.status);}
  const rows=await res.json();if(!Array.isArray(rows))throw new Error('Invalid audit response');
  return rows.slice(0,50).map(({id,action,target,result,createdAt})=>({id,action,target,result,createdAt}));
 }
 receipts(id:string){return this.request('/localization/imports',this.token(id));}
 retryReceipt(id:string,receiptId:string){return this.request(`/localization/imports/${encodeURIComponent(receiptId)}/localize`,this.token(id),{});}
 async logout(id:string){const cookie=this.sessions.get(id)?.webCookie;try{if(cookie)await fetch(this.origin+'/api/v1/auth/logout',{method:'POST',headers:{Cookie:cookie,Origin:this.origin},signal:AbortSignal.timeout(25000),redirect:'error'});await this.request('/logout',this.token(id),{});}finally{this.sessions.delete(id);}}
}
