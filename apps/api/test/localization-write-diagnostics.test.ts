import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {ShopeeClient,PlatformWriteError} from '../src/shopee-client';
import {LocalizationPlatform} from '../src/localization-platform';
import type {ShopeeApp} from '../src/config';
import type {LocalizationDraft} from '../src/localization-engine';

test('write diagnostics preserve bounded error code/request ID without provider messages, tokens or signed URLs',async()=>{
 const token='a'.repeat(32),key='b'.repeat(32),requestId='0123456789abcdef0123456789abcdef';let mode='reject';
 const server=createServer(async(req,res)=>{for await(const _ of req){}const url=new URL(req.url!,'http://fixture');assert.equal(url.searchParams.get('access_token'),token);res.setHeader('content-type','application/json');
  if(mode==='malformed'){res.end('null');return;}
  if(mode==='uncertain'){res.statusCode=502;res.end(JSON.stringify({request_id:requestId,message:'secret '+token}));return;}
  if(mode==='hostile'){res.end(JSON.stringify({error:'private-'+token,request_id:token,message:url.href+' '+key}));return;}
  if(mode==='key-id'){res.end(JSON.stringify({error:'error_permission',request_id:key,message:key}));return;}
  res.end(JSON.stringify({error:'error_param',request_id:requestId,message:'signed URL '+url.href+' key '+key}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 const app:ShopeeApp={id:'fixture',name:'Fixture',environment:'sandbox',partnerId:1,partnerKey:key,baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}`},client=new ShopeeClient();
 const write=()=>client.write(app,'/api/v2/product/add_item',token,'123',{item_status:'UNLIST'});
 const check=(e:unknown,uncertain:boolean,diagnostic:unknown)=>{assert.ok(e instanceof PlatformWriteError);assert.equal(e.uncertain,uncertain);assert.deepEqual(e.diagnostic,diagnostic);const serialized=JSON.stringify(e);assert.ok(!serialized.includes(token));assert.ok(!serialized.includes(key));assert.ok(!serialized.includes('http://'));assert.ok(!serialized.includes('signed URL'));return true;};
 try{
  await assert.rejects(write,(e)=>check(e,false,{upstreamCode:'error_param',upstreamRequestId:requestId}));
  mode='uncertain';await assert.rejects(write,(e)=>check(e,true,{upstreamCode:'unknown',upstreamRequestId:requestId}));
  mode='hostile';await assert.rejects(write,(e)=>check(e,false,{upstreamCode:'unknown'}));
  mode='key-id';await assert.rejects(write,(e)=>check(e,false,{upstreamCode:'error_permission'}));
  mode='malformed';await assert.rejects(write,(e)=>check(e,true,undefined));
  const legacy=new PlatformWriteError(true,'Fixture timeout');assert.equal(legacy.uncertain,true);assert.equal(legacy.diagnostic,undefined);
 }finally{server.close();await once(server,'close');}
});

test('definitive central create rejection carries only sanitized diagnostic and never reports a remote item',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localization-write-diagnostic-')),previous=process.env.LOCALIZATION_DATA_DIR;process.env.LOCALIZATION_DATA_DIR=dir;
 const diagnostic={upstreamCode:'error_param',upstreamRequestId:'0123456789abcdef0123456789abcdef'};
 const d:LocalizationDraft={id:randomUUID(),owner:'operator@fixture.test',sourceId:randomUUID(),revision:1,shop:{id:'shop',shopId:'123',shopName:'Fixture',region:'PH',currency:'PHP',language:'English'},language:'English',title:'API Integration Test - Not For Sale',description:'Fixture for a private integration test.',sellingPoints:[],specificationNames:[],variants:[{sku:'MOCK',options:[],price:10,stock:0}],weightKg:.2,dimensionsCm:{length:20,width:12,height:8},categoryId:5,brandId:0,attributes:[],logistics:[{id:9,enabled:true}],images:['https://images.example.com/mock.png'],marketConfirmed:true,imagesReviewed:true,createdAt:'',updatedAt:''};
 const shops={write:async()=>{throw new PlatformWriteError(false,'平台拒绝本次操作', {...diagnostic,message:'private-token',url:'https://secret.example/?access_token=private-token'});},audit:async()=>{}};
 const db={shopConnection:{findUnique:async()=>({status:'CONNECTED'})}};
 const platform=new LocalizationPlatform(undefined,db as never,shops as never);platform.capabilities=async()=>({path:'product',issues:[],writePermission:'unverified',note:'Fixture'});platform.validateMarket=async()=>[];
 try{
  const result=await platform.operation({owner:d.owner,userId:'admin'},'shop','create',{draft:d,marker:'LOC-'+randomUUID(),prepared:{imageIds:['image']}});
  assert.equal(result.rejected,true);assert.deepEqual(result.diagnostic,diagnostic);assert.equal(result.remoteId,undefined);assert.ok(!JSON.stringify(result).includes('private-token'));
 }finally{if(previous===undefined)delete process.env.LOCALIZATION_DATA_DIR;else process.env.LOCALIZATION_DATA_DIR=previous;rmSync(dir,{recursive:true,force:true});}
});
