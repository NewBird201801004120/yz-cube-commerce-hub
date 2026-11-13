import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {ShopeeClient} from '../src/shopee-client';
import {DevelopmentController} from '../src/development';
import type {AuthRequest} from '../src/auth';
import type {Shops} from '../src/shops';

test('Shopee client signs and sends a multipart video part, accepts empty success response',async()=>{
 const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));const body=Buffer.concat(chunks).toString();const url=new URL(req.url!,'http://127.0.0.1');assert.equal(url.pathname,'/api/v2/media_space/upload_video_part');assert.equal(url.searchParams.get('shop_id'),'123');assert.ok(url.searchParams.get('sign'));assert.match(req.headers['content-type']||'',/^multipart\/form-data/);assert.match(body,/name="part_seq"/);assert.match(body,/hello/);res.setHeader('content-type','application/json');res.end(JSON.stringify({error:'',request_id:'fixture'}));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const address=server.address();assert.ok(address&&typeof address==='object');const app={id:'test',name:'test',environment:'sandbox' as const,partnerId:1,partnerKey:'fixture',baseUrl:`http://127.0.0.1:${address.port}`};assert.deepEqual(await new ShopeeClient().video(app,'token','123','part',{video_upload_id:'ph_test',part_seq:0,content_md5:'x',data:Buffer.from('hello').toString('base64')}),{});}finally{server.close();}
});

test('gateway rejects changed product videos before any update',async()=>{
 let writes=0;const shops={read:async()=>({item_list:[{item_id:123,video_info:[{video_url:'changed'}]}]}),video:async()=>{writes++;return {};},audit:async()=>{}} as unknown as Shops;
 const controller=new DevelopmentController({} as never,{} as never,shops);const req={userId:'owner'} as AuthRequest;
 await assert.rejects(controller.video('shop','update',{item_id:'123',video_upload_id:'ph_test',expected_video_info:[]},req),/变化/);assert.equal(writes,0);
});

test('gateway accepts a full 4 MB part and calculates its checksum',async()=>{
 let sent:Record<string,unknown>|undefined;const shops={video:async(_id:string,_actor:string,_op:string,input:Record<string,unknown>)=>{sent=input;return {};},audit:async()=>{}} as unknown as Shops;
 const controller=new DevelopmentController({} as never,{} as never,shops);const data=Buffer.alloc(4*1024*1024).toString('base64');
 await controller.video('shop','part',{video_upload_id:'ph_test',part_seq:0,data},{userId:'owner'} as AuthRequest);
 assert.equal(sent?.content_md5,'b5cfa9d6c8febd618f91ac2843d50a1c');assert.equal(sent?.data,data);
});
