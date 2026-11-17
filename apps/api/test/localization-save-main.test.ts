import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {Database} from '../src/database';
import {Auth} from '../src/auth';
import {DevelopmentGuard} from '../src/development';
import {LocalizationPlatform} from '../src/localization-platform';
import {PlatformError} from '../src/shopee-client';
import {hash} from '../src/crypto';
import {LocalizationSaveOnlyController,LocalizationSaveOnlyHealthController,configureSaveOnlyHttp,SAVE_ONLY_TEST_TITLE,createLocalizationSaveApp} from '../src/localization-save-main';

test('isolated save channel restricts real HTTP to authenticated admin, one shop and specified UNLIST mock; no publish operation exists',async()=>{
 const previous=process.env.LOCALIZATION_SAVE_SHOP_ID;process.env.LOCALIZATION_SAVE_SHOP_ID='authorized-shop';
 const token='fixture_save_only_development_token_12345',viewer='fixture_save_only_viewer_token_123456789';
 const calls:{operation:string;ctx:unknown;body:unknown}[]=[];
 const platform={operation:async(ctx:unknown,_shop:string,operation:string,body:unknown)=>{calls.push({operation,ctx,body});return {operation,remoteId:operation==='create'?'12345':undefined};},metadata:async(ctx:unknown,_shop:string,categoryId?:number)=>{calls.push({operation:'metadata',ctx,body:{categoryId}});return {categories:[]};}};
 const db={session:{findUnique:async({where}:{where:{tokenHash:string}})=>[hash(token),hash(viewer)].includes(where.tokenHash)?{id:'session',userId:'operator',kind:'DEV',expiresAt:new Date(Date.now()+60000),user:{role:where.tokenHash===hash(viewer)?'VIEWER':'ADMIN'}}:null},user:{findUniqueOrThrow:async()=>({email:'operator@fixture.test'})}};
 @Module({controllers:[LocalizationSaveOnlyController,LocalizationSaveOnlyHealthController],providers:[DevelopmentGuard,{provide:Database,useValue:db},{provide:Auth,useValue:{session:async()=>null}},{provide:LocalizationPlatform,useValue:platform}]})
 class FixtureModule{}
 const app=await NestFactory.create(FixtureModule,{logger:false});configureSaveOnlyHttp(app);await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1/development/localization';
 const call=(operation:string,body:unknown={},auth:string|null=token,headers:Record<string,string>={},shop='authorized-shop')=>fetch(base+'/shops/'+shop+'/'+operation,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{}),...headers},body:JSON.stringify(body)});
 const draft={title:SAVE_ONLY_TEST_TITLE,specificationNames:[],variants:[{sku:'MOCK-NOT-FOR-SALE',options:[],price:10,stock:0}]};
 const multi={...draft,specificationNames:['Color','Size'],variants:[['White','Small'],['White','Large'],['Black','Small'],['Black','Large']].map((options,index)=>({sku:`MOCK-NOT-FOR-SALE-${index+1}`,options,price:10+index,stock:0}))};
 try{
  const health=await fetch(base+'/health');assert.equal(health.status,200);assert.equal((await health.json()).publishing,false);
  assert.equal((await call('capabilities',{},null)).status,401);
  assert.equal((await call('capabilities',{},viewer)).status,403);
  assert.equal((await call('capabilities',{},'wrong_save_only_token_123456789')).status,401);
  assert.equal((await call('capabilities',{},token,{origin:'https://commerce.aicbec.cn'})).status,401);
  assert.equal((await call('capabilities',{},token,{cookie:'yz_session=fixture'})).status,401);
  assert.equal((await call('capabilities',{},token,{},'another-shop')).status,403);
  for(const operation of ['complete','publish','unlist_item','init_tier_variation','delete','arbitrary'])assert.equal((await call(operation,{draft})).status,403);
  assert.equal(calls.length,0);
  assert.equal((await call('create',{draft:{...draft,title:'Ordinary product'}})).status,400);
  assert.equal((await call('create',{draft:{...draft,variants:[{...draft.variants[0],stock:1}]}})).status,400);
  assert.equal((await call('create',{draft:{...draft,specificationNames:['Color']}})).status,400);
  assert.equal((await call('create',{draft:{...draft,variants:[draft.variants[0],draft.variants[0]]}})).status,400);
  assert.equal((await call('create',{draft:{...multi,variants:multi.variants.map((v,i)=>i===0?{...v,sku:'ORDINARY-SKU'}:v)}})).status,400);
  assert.equal((await call('create',{draft:{...multi,variants:multi.variants.map((v,i)=>i===0?{...v,stock:1}:v)}})).status,400);
  assert.equal((await call('create',{draft:{...multi,variants:[...multi.variants,{...multi.variants[0],sku:'MOCK-NOT-FOR-SALE-5'}]}})).status,400);
  assert.equal((await call('create',{draft:{...multi,variants:multi.variants.map((v,i)=>i===1?{...v,sku:multi.variants[0].sku}:v)}})).status,400);
  assert.equal((await call('create',{draft:{...multi,variants:multi.variants.map((v,i)=>i===0?{...v,options:['White']}:v)}})).status,400);
  assert.equal((await call('create',{draft:{...multi,variants:multi.variants.map((v,i)=>i===0?{...v,price:null}:v)}})).status,400);
  assert.equal((await call('save_variations',{draft:multi,marker:'fixture'})).status,400);
  assert.equal((await call('save_variations',{draft:multi,marker:'fixture',remoteId:'12345'},token,{},'another-shop')).status,403);
  assert.equal(calls.length,0);
  assert.equal((await call('capabilities')).status,201);
  assert.equal((await call('metadata',{categoryId:12})).status,201);
  assert.equal((await call('metadata',{categoryId:12.5})).status,400);
  assert.equal((await call('metadata',{categoryId:12,owner:'untrusted'})).status,400);
  assert.equal((await call('upload',{data:'fixture'})).status,201);
  assert.equal((await call('create',{draft,marker:'fixture'})).status,201);
  assert.equal((await call('create',{draft:multi,marker:'fixture-multi'})).status,201);
  assert.equal((await call('save_variations',{draft:multi,marker:'fixture-multi',remoteId:'12345'})).status,201);
  assert.equal((await call('complete',{draft:multi,marker:'fixture-multi',remoteId:'12345'})).status,403);
  assert.equal((await call('publish',{draft:multi,marker:'fixture-multi',remoteId:'12345'})).status,403);
  assert.equal((await call('reconcile',{marker:'fixture'})).status,201);
  assert.deepEqual(calls.map(c=>c.operation),['capabilities','metadata','upload','create','create','save_variations','reconcile']);
  assert.ok(calls.every(c=>JSON.stringify(c.ctx)===JSON.stringify({owner:'operator@fixture.test',userId:'operator'})));
  delete process.env.LOCALIZATION_SAVE_SHOP_ID;assert.equal((await call('create',{draft})).status,403);assert.equal(calls.length,7);
 }finally{await app.close();if(previous===undefined)delete process.env.LOCALIZATION_SAVE_SHOP_ID;else process.env.LOCALIZATION_SAVE_SHOP_ID=previous;}
});

test('isolated save channel passes rejected creation unchanged and returns only safe platform diagnostics',async()=>{
 const previous=process.env.LOCALIZATION_SAVE_SHOP_ID;process.env.LOCALIZATION_SAVE_SHOP_ID='authorized-shop';
 let failure=false;
 const platform={operation:async()=>{if(failure)throw new PlatformError('PERMISSION_DENIED',{upstreamCode:'error_permission',upstreamRequestId:'1234567890abcdef',secret:'PRIVATE_TOKEN'});return {rejected:true,message:'平台拒绝测试商品',diagnostic:{upstreamCode:'error_param'}};}};
 const db={session:{findUnique:async()=>({id:'s',userId:'operator',kind:'DEV',expiresAt:new Date(Date.now()+60000),user:{role:'ADMIN'}})},user:{findUniqueOrThrow:async()=>({email:'operator@fixture.test'})}};
 @Module({controllers:[LocalizationSaveOnlyController],providers:[DevelopmentGuard,{provide:Database,useValue:db},{provide:Auth,useValue:{}},{provide:LocalizationPlatform,useValue:platform}]})
 class FixtureModule{}
 const app=await NestFactory.create(FixtureModule,{logger:false});configureSaveOnlyHttp(app);await app.listen(0,'127.0.0.1');const url=(await app.getUrl())+'/api/v1/development/localization/shops/authorized-shop/create';
 const run=()=>fetch(url,{method:'POST',headers:{Authorization:'Bearer fixture_save_only_token_123456789','Content-Type':'application/json'},body:JSON.stringify({draft:{title:SAVE_ONLY_TEST_TITLE,specificationNames:[],variants:[{sku:'MOCK-NOT-FOR-SALE',options:[],price:10,stock:0}]}})});
 try{const rejected=await run();assert.equal(rejected.status,201);assert.equal((await rejected.json()).rejected,true);failure=true;const response=await run();assert.equal(response.status,502);const body=await response.json();assert.deepEqual(body.diagnostic,{upstreamCode:'error_permission',upstreamRequestId:'1234567890abcdef'});assert.equal(JSON.stringify(body).includes('PRIVATE_TOKEN'),false);}
 finally{await app.close();if(previous===undefined)delete process.env.LOCALIZATION_SAVE_SHOP_ID;else process.env.LOCALIZATION_SAVE_SHOP_ID=previous;}
});

test('isolated save service refuses startup without an explicit shop scope or persistent absolute directory',async()=>{
 const shop=process.env.LOCALIZATION_SAVE_SHOP_ID,data=process.env.LOCALIZATION_DATA_DIR;
 try{delete process.env.LOCALIZATION_SAVE_SHOP_ID;await assert.rejects(createLocalizationSaveApp(),/authorized save-test shop/);process.env.LOCALIZATION_SAVE_SHOP_ID='shop';process.env.LOCALIZATION_DATA_DIR='relative/data';await assert.rejects(createLocalizationSaveApp(),/absolute persistent data directory/);}
 finally{if(shop===undefined)delete process.env.LOCALIZATION_SAVE_SHOP_ID;else process.env.LOCALIZATION_SAVE_SHOP_ID=shop;if(data===undefined)delete process.env.LOCALIZATION_DATA_DIR;else process.env.LOCALIZATION_DATA_DIR=data;}
});
