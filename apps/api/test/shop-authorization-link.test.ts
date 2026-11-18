import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Shops,ShopsController} from '../src/shops';
import {hash} from '../src/crypto';
test('cross-browser callback consumes one-use state with original active WEB admin; replay and revoked initiator are denied',async()=>{
 let used=false,valid=true,exchanges=0;const actors:string[]=[];
 const app={id:'app',partnerId:1,environment:'live',partnerKey:'secret'};
 const db={authorizationAttempt:{findUnique:async(q:any)=>q.where.stateHash===hash('one-use')?{id:'a',sessionId:'original',appId:'app',partnerId:'1',environment:'live',expiresAt:new Date(Date.now()+60000),usedAt:used?new Date():null}:null,updateMany:async()=>{if(used)return {count:0};used=true;return {count:1};},update:async()=>({})},session:{findUnique:async()=>valid?{kind:'WEB',userId:'original-admin',expiresAt:new Date(Date.now()+60000),user:{role:'ADMIN'}}:null},shopConnection:{upsert:async()=>({id:'shop'})},auditLog:{create:async(q:any)=>{actors.push(q.data.actorId);}}};
 const service=new Shops(db as never,{getApp:()=>app,encryptionKey:Buffer.alloc(32)} as never,{exchange:async()=>{exchanges++;return {access_token:'access',refresh_token:'refresh',expire_in:3600};}} as never);service.verify=async(_id,actor)=>{actors.push(actor);return {ok:true};};
 const query={state:'one-use',code:'code',shop_id:'123'};
 await service.callback(query);assert.equal(exchanges,1);assert.ok(actors.every(v=>v==='original-admin'));await assert.rejects(service.callback(query));assert.equal(exchanges,1);
 used=false;valid=false;await assert.rejects(service.callback(query));assert.equal(exchanges,1);
 await assert.rejects(service.callback({...query,state:'tampered'}));
});
test('callback controller does not require or mint a browser session and uses a public result page',async()=>{
 let called=false;const c=new ShopsController({callback:async()=>{called=true;}} as never,{session:async()=>{throw Error('must not read callback cookies');}} as never,{webOrigin:'https://example.test'} as never,{} as never);
 let location='';const res={setHeader:()=>{},redirect:(_status:number,url:string)=>{location=url;}};
 await c.callback({state:'fixture'},{} as never,res as never);assert.ok(called);assert.equal(location,'https://example.test/api/v1/shopee/authorization-result?status=saved');assert.ok(!('cookie' in res));
});
test('authorization progress is visible only to its initiating session and reports completion, failure and expiry',async()=>{
 let result='PENDING',expired=false;
 const db={authorizationAttempt:{findUnique:async()=>({sessionId:'origin',result,expiresAt:new Date(expired?0:Date.now()+60000)})}};
 const service=new Shops(db as never,{} as never,{} as never);
 await assert.rejects(service.authorizationStatus('attempt','other'));
 assert.deepEqual(await service.authorizationStatus('attempt','origin'),{status:'pending'});
 result='TOKEN_SAVED';assert.deepEqual(await service.authorizationStatus('attempt','origin'),{status:'saved'});
 result='FAILED';assert.deepEqual(await service.authorizationStatus('attempt','origin'),{status:'failed'});
 result='PENDING';expired=true;assert.deepEqual(await service.authorizationStatus('attempt','origin'),{status:'expired'});
});
