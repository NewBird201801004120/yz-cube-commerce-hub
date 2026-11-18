import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ShopeeClient,PlatformError} from '../src/shopee-client';
import type {ShopeeApp} from '../src/config';
const app:ShopeeApp={id:'fixture',name:'Fixture',environment:'sandbox',partnerId:1,partnerKey:'secret',baseUrl:'https://partner.test-stable.shopeemobile.com'};
test('category reads retry transport once, coalesce and cache per token/shop/language without sharing mutable data',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;if(calls===1)throw new TypeError('private URL',{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});return Response.json({response:{category_list:[{category_id:5}]}});};
 try{const client=new ShopeeClient(),read=(token='token',language='en')=>client.read(app,'/api/v2/product/get_category',token,'123',{language});
 const [a,b]=await Promise.all([read(),read()]);assert.equal(calls,2);(a as any).category_list.length=0;assert.equal((b as any).category_list.length,1);assert.equal(((await read()) as any).category_list.length,1);assert.equal(calls,2);
 await read('other-token');await read('token','fil');assert.equal(calls,4);
 }finally{globalThis.fetch=original;}
});
test('business rejections are not retried or cached; exhausted transport diagnostic excludes raw error',async()=>{
 const original=globalThis.fetch;let calls=0;const client=new ShopeeClient();
 try{globalThis.fetch=async()=>{calls++;return Response.json({error:'error_permission'});};await assert.rejects(client.read(app,'/api/v2/product/get_category','token','123',{}));assert.equal(calls,1);
 globalThis.fetch=async()=>{calls++;throw new Error('secret-token signed-url');};await assert.rejects(client.read(app,'/api/v2/product/get_category','token','123',{}),(e:unknown)=>{assert.ok(e instanceof PlatformError);assert.equal(e.diagnostic?.upstreamCode,'transport_connection_failed');assert.ok(!JSON.stringify(e).includes('secret-token'));return true;});assert.equal(calls,3);
 }finally{globalThis.fetch=original;}
});
