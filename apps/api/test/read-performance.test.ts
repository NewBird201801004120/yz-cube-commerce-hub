import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ReadCache} from '../src/read-cache';
import {TeamShopClient} from '../src/team-client';

test('display snapshots coalesce, expire, isolate mutable results and retry failures',async()=>{
 let now=0,calls=0;const cache=new ReadCache(()=>now);
 const load=async()=>{calls++;return {items:[calls]};};
 const [a,b]=await Promise.all([cache.read('shop-a',30,load),cache.read('shop-a',30,load)]);
 assert.equal(calls,1);a.items.length=0;assert.deepEqual(b.items,[1]);
 assert.deepEqual((await cache.read('shop-a',30,load)).items,[1]);
 now=31;await cache.read('shop-a',30,load);assert.equal(calls,2);
 await cache.read('shop-b',30,load);assert.equal(calls,3);
 await assert.rejects(cache.read('failure',30,async()=>{throw Error('unavailable');}));
 await cache.read('failure',30,load);assert.equal(calls,4);
});

test('forced refresh and invalidation prevent old in-flight responses refilling snapshots',async()=>{
 const cache=new ReadCache();let resolve!:(v:number)=>void;
 const old=cache.read('same',30000,()=>new Promise<number>(r=>{resolve=r;}));
 await Promise.resolve();
 assert.equal(await cache.read('same',30000,async()=>2,true),2);
 resolve(1);assert.equal(await old,1);
 assert.equal(await cache.read('same',30000,async()=>3),2);
 let release!:(v:number)=>void;
 const pending=cache.read('other',30000,()=>new Promise<number>(r=>{release=r;}));
 await Promise.resolve();cache.clear();release(4);await pending;
 assert.equal(await cache.read('other',30000,async()=>5),5);
});

test('snapshot count and payload size are bounded',async()=>{
 let calls=0;const cache=new ReadCache(Date.now,1,32);const load=async()=>++calls;
 await cache.read('a',30000,load);await cache.read('b',30000,load);await cache.read('a',30000,load);assert.equal(calls,3);
 const large=async()=>{calls++;return 'x'.repeat(40);};
 await cache.read('large',30000,large);await cache.read('large',30000,large);assert.equal(calls,5);
});

test('team display cache is scoped by session, shop, query; internal and write checks remain live',async()=>{
 const original=globalThis.fetch;const requests:string[]=[];let serial=0;
 globalThis.fetch=async(input)=>{
  const path=new URL(String(input)).pathname;requests.push(path);
  if(path==='/api/v1/development/login')return Response.json({token:'fixture-bearer',expiresIn:3600});
  if(path==='/api/v1/auth/login')return Response.json({});
  return Response.json({item_list:[{item_id:++serial}]});
 };
 try{
  const team=new TeamShopClient();await team.login('test@example.test','fixture','s1');await team.login('test@example.test','fixture','s2');requests.length=0;
  const display=(session='s1',shop='a',query={item_id_list:'1'},fresh=false)=>team.displayRead(session,shop,'get_item_base_info',query,fresh);
  await Promise.all([display(),display()]);assert.equal(requests.length,1);
  await display();assert.equal(requests.length,1);
  await display('s2');await display('s1','b');await display('s1','a',{item_id_list:'2'});assert.equal(requests.length,4);
  await display('s1','a',{item_id_list:'1'},true);assert.equal(requests.length,5);
  await team.read('s1','a','get_item_base_info',{item_id_list:'1'});await team.read('s1','a','get_item_base_info',{item_id_list:'1'});assert.equal(requests.length,7);
  await team.video('s1','a','update',{});await display();assert.equal(requests.length,9);
  assert.throws(()=>team.displayRead('unknown','a','get_item_base_info',{}));
 }finally{globalThis.fetch=original;}
});

test('preview rule reads share one snapshot but later checks and writes read fresh rules',async()=>{
 const {LocalizationPlatform,withMarketRuleSnapshot}=await import('../src/localization-platform');
 const platform:any=Object.create(LocalizationPlatform.prototype);let calls=0;
 platform.team={read:async()=>({values:[++calls]})};const ctx={owner:'owner',sessionId:'session'};
 await withMarketRuleSnapshot(async()=>{
  const [a,b]=await Promise.all([platform.read(ctx,'shop','get_channel_list'),platform.read(ctx,'shop','get_channel_list')]);
  assert.equal(calls,1);a.values.length=0;assert.deepEqual(b.values,[1]);
  await platform.read({...ctx,owner:'other'},'shop','get_channel_list');assert.equal(calls,2);
  await platform.read(ctx,'other-shop','get_channel_list');assert.equal(calls,3);
 });
 await platform.read(ctx,'shop','get_channel_list');assert.equal(calls,4);
 await withMarketRuleSnapshot(()=>platform.read(ctx,'shop','get_channel_list'));assert.equal(calls,5);
});

test('failed rule reads are not cached and identify the actual failed rule without private diagnostics',async()=>{
 const {LocalizationPlatform,withMarketRuleSnapshot,MarketRuleReadError}=await import('../src/localization-platform');
 const platform:any=Object.create(LocalizationPlatform.prototype);let calls=0;
 platform.team={read:async()=>{if(++calls===1)throw Error('secret-provider-token');return {};}};
 await withMarketRuleSnapshot(async()=>{
  await assert.rejects(platform.read({owner:'owner'},'shop','get_channel_list'),(e:any)=>e instanceof MarketRuleReadError&&e.message.includes('店铺物流')&&!e.message.includes('secret'));
  await platform.read({owner:'owner'},'shop','get_channel_list');assert.equal(calls,2);
 });
});

test('team retries a transient read once, never permissions or writes',async()=>{
 const {BadGatewayException,ForbiddenException}=await import('@nestjs/common');
 const client:any=new TeamShopClient();client.sessions.set('fixture',{token:'fixture',expiresAt:Date.now()+60000});
 let calls=0;client.request=async()=>{if(++calls===1)throw new BadGatewayException();return {ok:true};};
 assert.deepEqual(await client.read('fixture','shop','get_channel_list'),{ok:true});assert.equal(calls,2);
 calls=0;client.request=async()=>{calls++;throw new ForbiddenException();};
 await assert.rejects(client.read('fixture','shop','get_channel_list'));assert.equal(calls,1);
 calls=0;client.request=async()=>{calls++;throw new BadGatewayException();};
 await assert.rejects(client.read('fixture','shop','get_channel_list'));assert.equal(calls,2);
 calls=0;await assert.rejects(client.localization('fixture','shop','create',{}));assert.equal(calls,1);
});
