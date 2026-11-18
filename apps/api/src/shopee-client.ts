import { Injectable } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import type { ShopeeApp } from './config';
export type PlatformDiagnostic={upstreamCode:string;upstreamRequestId?:string};
const diagnosticCodes=new Set(['api_suspended','product.error_param','error_param','error_params','error_permission','error_auth','error_token','error_access_token','error_sign','error_not_found','error_unknown','error_server','error_api','invalid_param','invalid_parameter','invalid_access_token','invalid_refresh_token','invalid_code','invalid_token','invalid_permission','access_denied','permission_denied','shop_not_authorized','common.error_param','common.error_permission','common.error_auth','common.error_token','common.error_sign','common.error_server','common.error_not_found','transport_timeout','transport_connection_failed','transport_response_timeout']);
/** Deliberately exclude upstream messages, URLs, body fragments and arbitrary error strings. */
export function safePlatformDiagnostic(value:unknown):PlatformDiagnostic|undefined {
  if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
  const v=value as Record<string,unknown>,upstreamCode=typeof v.upstreamCode==='string'&&diagnosticCodes.has(v.upstreamCode.toLowerCase())?v.upstreamCode.toLowerCase():'unknown';
  const id=v.upstreamRequestId;
  return {upstreamCode,...(typeof id==='string'&&(/^[a-f0-9]{16,64}$/i.test(id)||/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))?{upstreamRequestId:id}:{})};
}
export class PlatformError extends Error {
  readonly diagnostic?:PlatformDiagnostic;
  constructor(public readonly code: 'TOKEN_INVALID' | 'PERMISSION_DENIED' | 'PLATFORM_UNAVAILABLE' | 'INVALID_RESPONSE',diagnostic?:unknown) { super(code);this.diagnostic=safePlatformDiagnostic(diagnostic); }
}
/** A platform rejection is definitive; transport/malformed-response failures are ambiguous for writes. */
export class PlatformWriteError extends Error {
  readonly diagnostic?:PlatformDiagnostic;
  constructor(public readonly uncertain:boolean,public readonly reason:string,diagnostic?:unknown){super(reason);this.diagnostic=safePlatformDiagnostic(diagnostic);}
}
export function signature(app: ShopeeApp, path: string, timestamp: number, accessToken = '', shopId = '') {
  return createHmac('sha256', app.partnerKey).update(`${app.partnerId}${path}${timestamp}${accessToken}${shopId}`).digest('hex');
}
export type VideoOperation = 'init'|'part'|'complete'|'result'|'update';
export type Tokens = { access_token: string; refresh_token: string; expire_in: number; shop_id_list?: number[] };
@Injectable()
export class ShopeeClient {
  private categoryCache=new Map<string,{expires:number;value:unknown}>();
  private categoryPending=new Map<string,Promise<unknown>>();
  authorizationUrl(app: ShopeeApp, redirect: string) {
    const path='/api/v2/shop/auth_partner', ts=Math.floor(Date.now()/1000), u=new URL(path,app.baseUrl);
    u.search=new URLSearchParams({partner_id:String(app.partnerId),timestamp:String(ts),sign:signature(app,path,ts),redirect}).toString();return u.toString();
  }
  private async request(app: ShopeeApp, path: string, body?: object, token='', shopId='', query:Record<string,string>={}) {
    const ts=Math.floor(Date.now()/1000),u=new URL(path,app.baseUrl);
    u.search=new URLSearchParams({...query,partner_id:String(app.partnerId),timestamp:String(ts),sign:signature(app,path,ts,token,shopId),...(token?{access_token:token,shop_id:shopId}:{})}).toString();
    let response: Response;
    try {response=await fetch(u,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(!body&&path==='/api/v2/product/get_category'?75000:15000),redirect:'error'});} catch(e) {throw new PlatformError('PLATFORM_UNAVAILABLE',{upstreamCode:e instanceof Error&&e.name==='TimeoutError'?'transport_response_timeout':e instanceof Error&&(e as Error&{cause?:{code?:string}}).cause?.code==='UND_ERR_CONNECT_TIMEOUT'?'transport_timeout':'transport_connection_failed'});}
    let data: Record<string,unknown>;
    try {data=await response.json() as Record<string,unknown>;}catch{throw new PlatformError('INVALID_RESPONSE');}
    if(!data||typeof data!=='object'||Array.isArray(data))throw new PlatformError('INVALID_RESPONSE');
    const diagnostic=safePlatformDiagnostic({upstreamCode:data.error,upstreamRequestId:data.request_id===token||data.request_id===app.partnerKey?undefined:data.request_id});
    if(data.error) {
      const code=typeof data.error==='string'?data.error.toLowerCase():'';
      if(/permission|scope|access_denied/.test(code))throw new PlatformError('PERMISSION_DENIED',diagnostic);
      if(/token|auth|shop_not_authorized/.test(code)||code==='invalid_code')throw new PlatformError('TOKEN_INVALID',diagnostic);
      throw new PlatformError('PLATFORM_UNAVAILABLE',diagnostic);
    }
    if(!response.ok) throw new PlatformError('PLATFORM_UNAVAILABLE',diagnostic);
    return data;
  }
  async read(app:ShopeeApp,path:string,token:string,shopId:string,query:Record<string,string>) {
    // Retry transport failures only for read-only requests; writes retain uncertain-result handling.
    const load=async()=>{for(let attempt=0;;attempt++){try{return await this.request(app,path,undefined,token,shopId,query);}catch(e){if(attempt||!(e instanceof PlatformError)||!['transport_timeout','transport_connection_failed'].includes(e.diagnostic?.upstreamCode||''))throw e;}}};
    const category=path==='/api/v2/product/get_category';
    const key=category?createHash('sha256').update(JSON.stringify([app.id,app.baseUrl,app.partnerId,token,shopId,query])).digest('hex'):'';
    const cached=category?this.categoryCache.get(key):undefined;
    let data:Record<string,unknown>;
    if(cached&&cached.expires>Date.now())data=structuredClone(cached.value) as Record<string,unknown>;
    else if(category){
      let pending=this.categoryPending.get(key);
      if(!pending){pending=load().then(value=>{if(value.response&&typeof value.response==='object'){if(this.categoryCache.size>=100)this.categoryCache.delete(this.categoryCache.keys().next().value!);this.categoryCache.set(key,{expires:Date.now()+300000,value:structuredClone(value)});}return value;}).finally(()=>this.categoryPending.delete(key));this.categoryPending.set(key,pending);}
      data=structuredClone(await pending) as Record<string,unknown>;
    }else data=await load();
    if(path==='/api/v2/shop/get_shop_info'){const info=data.response&&typeof data.response==='object'?data.response as Record<string,unknown>:data;return {shop_id:info.shop_id,shop_name:info.shop_name,region:info.region,is_cb:typeof info.is_cb==='boolean'?info.is_cb:undefined};}
    if(!data.response || typeof data.response!=='object')throw new PlatformError('INVALID_RESPONSE');
    return data.response;
  }
  async write(app:ShopeeApp,path:string,token:string,shopId:string,body:object|FormData){
    const ts=Math.floor(Date.now()/1000),u=new URL(path,app.baseUrl);
    u.search=new URLSearchParams({partner_id:String(app.partnerId),timestamp:String(ts),sign:signature(app,path,ts,token,shopId),access_token:token,shop_id:shopId}).toString();
    let res:Response;
    try{res=await fetch(u,{method:'POST',headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(20000),redirect:'error'});}catch{throw new PlatformWriteError(true,'平台请求超时或连接中断，需先核对远端结果');}
    let data:Record<string,unknown>;try{data=await res.json() as Record<string,unknown>;}catch{throw new PlatformWriteError(true,'平台未返回可识别结果，需先核对远端结果');}
    if(!data||typeof data!=='object'||Array.isArray(data))throw new PlatformWriteError(true,'平台未返回可识别结果，需先核对远端结果');
    const diagnostic=safePlatformDiagnostic({upstreamCode:data.error,upstreamRequestId:data.request_id===token||data.request_id===app.partnerKey?undefined:data.request_id});
    if(data.error)throw new PlatformWriteError(false,'平台拒绝本次操作，请核对商品资料、店铺资格及应用权限',diagnostic);
    if(!res.ok||!data.response||typeof data.response!=='object'||Array.isArray(data.response))throw new PlatformWriteError(true,'平台结果不明确，需先核对远端结果',diagnostic);
    return data.response as Record<string,unknown>;
  }
  async video(app:ShopeeApp,token:string,shopId:string,operation:VideoOperation,input:Record<string,unknown>) {
    const names:Record<VideoOperation,string>={init:'media_space/init_video_upload',part:'media_space/upload_video_part',complete:'media_space/complete_video_upload',result:'media_space/get_video_upload_result',update:'product/update_item'};
    const path=`/api/v2/${names[operation]}`,ts=Math.floor(Date.now()/1000),u=new URL(path,app.baseUrl);
    const query:Record<string,string>={partner_id:String(app.partnerId),timestamp:String(ts),sign:signature(app,path,ts,token,shopId),access_token:token,shop_id:shopId};
    if(operation==='result')query.video_upload_id=String(input.video_upload_id);
    u.search=new URLSearchParams(query).toString();
    let body:BodyInit|undefined;const headers:Record<string,string>={};
    if(operation==='part') {const f=new FormData();f.set('video_upload_id',String(input.video_upload_id));f.set('part_seq',String(input.part_seq));f.set('content_md5',String(input.content_md5));f.set('part_content',new Blob([Buffer.from(String(input.data),'base64')],{type:'video/mp4'}),'part.mp4');body=f;}
    else if(operation!=='result'){headers['Content-Type']='application/json';body=JSON.stringify(input);}
    let response:Response;try{response=await fetch(u,{method:operation==='result'?'GET':'POST',headers,body,signal:AbortSignal.timeout(30000),redirect:'error'});}catch{throw new PlatformError('PLATFORM_UNAVAILABLE');}
    let data:Record<string,unknown>;try{data=await response.json() as Record<string,unknown>;}catch{throw new PlatformError('INVALID_RESPONSE');}
    if(!response.ok||data.error)throw new PlatformError('PLATFORM_UNAVAILABLE');
    if((operation==='part'||operation==='complete')&&data.response===undefined)return {};
    if(!data.response||typeof data.response!=='object')throw new PlatformError('INVALID_RESPONSE');
    return data.response;
  }
  private tokens(data: Record<string,unknown>): Tokens {
    if(typeof data.access_token!=='string'||!data.access_token||typeof data.refresh_token!=='string'||!data.refresh_token||typeof data.expire_in!=='number'||!Number.isFinite(data.expire_in)||data.expire_in<=0)throw new PlatformError('INVALID_RESPONSE');
    return data as Tokens;
  }
  async exchange(app: ShopeeApp, code: string, shopId: string) {return this.tokens(await this.request(app,'/api/v2/auth/token/get',{partner_id:app.partnerId,code,shop_id:Number(shopId)}));}
  async refresh(app: ShopeeApp, token: string, shopId: string) {return this.tokens(await this.request(app,'/api/v2/auth/access_token/get',{partner_id:app.partnerId,refresh_token:token,shop_id:Number(shopId)}));}
  async shop(app: ShopeeApp, token: string, shopId: string) {
    const d=await this.request(app,'/api/v2/shop/get_shop_info',undefined,token,shopId);
    if(typeof d.shop_name!=='string'||typeof d.region!=='string')throw new PlatformError('INVALID_RESPONSE');
    return {shopName:d.shop_name,region:d.region};
  }
}
