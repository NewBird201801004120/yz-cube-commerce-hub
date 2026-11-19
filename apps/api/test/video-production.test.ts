import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VideoService} from '../src/tools/short-video/video';
import {ProductionVideoClient} from '../src/tools/short-video/production-client';
test('production video uses the existing admin session and ignores any supplied team cookie',async()=>{
 for(const session of [null,{userId:'user',user:{email:'user@example.test',role:'USER'}},{userId:'admin',user:{email:'admin@example.test',role:'ADMIN'}}]){
  let teamCalls=0;const service=new VideoService({me:async()=>{teamCalls++;throw Error('must not trust team cookie');}} as never,undefined,{session:async()=>session} as never),req={cookies:{yz_team:'untrusted',yz_session:'existing'}} as any;
  if(session?.user.role==='ADMIN'){assert.deepEqual(await service.list(req),[]);assert.equal(req.cookies.yz_team,'admin');assert.equal(req.cookies.yz_session,'existing');}
  else await assert.rejects(()=>service.list(req),/请先登录中台管理员账号/);
  assert.equal(teamCalls,0);
 }
});
test('production video transport reuses the validated shop read and video operation routes',async()=>{
 const calls:any[]=[];const client=new ProductionVideoClient({} as never,{} as never,{audit:async()=>{},read:async(...args:any[])=>{calls.push(args);return {};},video:async(...args:any[])=>{calls.push(args);return {};}} as never);
 await client.read('actor','shop','get_item_base_info',{item_id_list:'123'});assert.equal(calls[0][0],'shop');assert.equal(calls[0][1],'actor');assert.equal(calls[0][2],'/api/v2/product/get_item_base_info');
 assert.deepEqual(await client.videoCapabilities(),{version:2});await assert.rejects(()=>client.video('actor','shop','unknown',{}),/请求无效/);
});
