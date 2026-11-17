import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {DevelopmentController} from '../src/development';
import {ShopeeClient,PlatformError,safePlatformDiagnostic} from '../src/shopee-client';
import type {ShopeeApp} from '../src/config';
import type {AuthRequest} from '../src/auth';

test('market read routing aliases legacy attributes to current tree API, validates one category and supplies required brand status',async()=>{
 const reads:{path:string;query:Record<string,string>}[]=[];
 const shops={read:async(_id:string,_actor:string,path:string,query:Record<string,string>)=>{reads.push({path,query});return {};},audit:async()=>{}};
 const controller=new DevelopmentController({} as any,{} as any,shops as any),req={userId:'operator'} as AuthRequest;
 await controller.read('shop','get_attributes',{category_id:'101100',language:'en'},req);
 await controller.read('shop','get_attribute_tree',{category_id:'101100',language:'en'},req);
 await controller.read('shop','get_shop_info',{},req);
 await controller.read('shop','get_brand_list',{category_id:'101100'},req);
 assert.equal(reads[0].path,'/api/v2/product/get_attribute_tree');assert.equal(reads[1].path,reads[0].path);
 assert.deepEqual(reads[0].query,{category_id_list:'101100',language:'en'});assert.deepEqual(reads[1].query,reads[0].query);
 assert.equal(reads[2].path,'/api/v2/shop/get_shop_info');
 assert.deepEqual(reads[3].query,{category_id:'101100',offset:'0',page_size:'100',status:'1'});
 await controller.read('shop','get_attribute_tree',{category_id_list:'101255',language:'en'},req);
 assert.deepEqual(reads[4],{path:'/api/v2/product/get_attribute_tree',query:{category_id_list:'101255',language:'en'}});
 await assert.rejects(()=>controller.read('shop','add_item',{},req));
 await assert.rejects(()=>controller.read('shop','get_shop_info',{access_token:'untrusted'},req));
 await assert.rejects(()=>controller.read('shop','get_attributes',{category_id:'0'},req));
 await assert.rejects(()=>controller.read('shop','get_attribute_tree',{category_id_list:'101255,101256'},req));
 await assert.rejects(()=>controller.read('shop','get_attribute_tree',{category_id:'101255',category_id_list:'101256'},req));
 await assert.rejects(()=>controller.read('shop','get_attributes',{category_id_list:'-1'},req));
 await assert.rejects(()=>controller.read('shop','get_brand_list',{category_id:'101100',page_size:'101'},req));
 await assert.rejects(()=>controller.read('shop','get_brand_list',{category_id:'101100',status:'approved'},req));
 assert.equal(reads.length,5);
});

test('upstream read diagnostics retain only allowlisted codes and request IDs without leaking messages or credentials',async()=>{
 const secret='a'.repeat(32),requestId='1234567890abcdef1234567890abcdef';let mode='param';
 const server=createServer((req,res)=>{res.setHeader('content-type','application/json');const u=new URL(req.url!,'http://fixture');
  assert.equal(u.searchParams.get('access_token'),secret);
  if(mode==='info'){res.end(JSON.stringify({shop_id:1,shop_name:'Fixture',region:'PH',is_cb:false,access_token:secret}));return;}
  if(mode==='nested-info'){res.end(JSON.stringify({response:{shop_id:1,shop_name:'Fixture',region:'PH',is_cb:'false',access_token:secret}}));return;}
  if(mode==='permission'){res.statusCode=403;res.end(JSON.stringify({error:'error_permission',message:secret,request_id:requestId}));return;}
  if(mode==='suspended'){res.statusCode=403;res.end(JSON.stringify({error:'api_suspended',message:secret,request_id:requestId}));return;}
  if(mode==='brand-param'){res.end(JSON.stringify({error:'product.error_param',message:'status required '+secret,request_id:requestId}));return;}
  if(mode==='hostile'){res.end(JSON.stringify({error:'private-token-'+secret,message:secret,request_id:secret}));return;}
  res.end(JSON.stringify({error:'error_param',message:'signed URL and token '+secret,request_id:requestId}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 const app:ShopeeApp={id:'fixture',name:'Fixture',environment:'sandbox',partnerId:1,partnerKey:'fixture-key',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}`},client=new ShopeeClient();
 try{
  let caught:PlatformError|undefined;try{await client.read(app,'/api/v2/product/get_brand_list',secret,'1',{category_id:'101100'});}catch(e){caught=e as PlatformError;}
  assert.equal(caught?.code,'PLATFORM_UNAVAILABLE');assert.deepEqual(caught?.diagnostic,{upstreamCode:'error_param',upstreamRequestId:requestId});assert.ok(!JSON.stringify(caught).includes(secret));
  const controller=new DevelopmentController({} as any,{} as any,{read:async()=>{throw caught;},audit:async()=>{}} as any);
  await assert.rejects(()=>controller.read('shop','get_brand_list',{category_id:'101100'},{userId:'operator'} as AuthRequest),(e:any)=>{assert.equal(e.getStatus(),502);assert.deepEqual(e.getResponse().diagnostic,caught?.diagnostic);assert.ok(!JSON.stringify(e.getResponse()).includes(secret));return true;});
  mode='permission';await assert.rejects(()=>client.read(app,'/api/v2/product/get_brand_list',secret,'1',{}),(e:any)=>e instanceof PlatformError&&e.code==='PERMISSION_DENIED'&&e.diagnostic?.upstreamCode==='error_permission');
  mode='suspended';await assert.rejects(()=>client.read(app,'/api/v2/product/get_attributes',secret,'1',{}),(e:any)=>{assert.equal(e.diagnostic?.upstreamCode,'api_suspended');assert.ok(!JSON.stringify(e).includes(secret));return true;});
  mode='brand-param';await assert.rejects(()=>client.read(app,'/api/v2/product/get_brand_list',secret,'1',{}),(e:any)=>{assert.equal(e.diagnostic?.upstreamCode,'product.error_param');assert.ok(!JSON.stringify(e).includes(secret));return true;});
  mode='hostile';await assert.rejects(()=>client.read(app,'/api/v2/product/get_brand_list',secret,'1',{}),(e:any)=>{assert.deepEqual(e.diagnostic,{upstreamCode:'unknown'});assert.ok(!JSON.stringify(e).includes(secret));return true;});
  mode='info';assert.deepEqual(await client.read(app,'/api/v2/shop/get_shop_info',secret,'1',{}),{shop_id:1,shop_name:'Fixture',region:'PH',is_cb:false});
  mode='nested-info';assert.deepEqual(await client.read(app,'/api/v2/shop/get_shop_info',secret,'1',{}),{shop_id:1,shop_name:'Fixture',region:'PH',is_cb:undefined});
  assert.deepEqual(safePlatformDiagnostic({upstreamCode:'unexpected-private-content',upstreamRequestId:'https://example.com/?token=secret',message:secret}),{upstreamCode:'unknown'});
 }finally{server.close();await once(server,'close');}
});
