import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VideoService} from '../src/tools/short-video/video';
import {TeamShopClient} from '../src/team-client';
import type {Request} from 'express';

test('video generation authenticates before checking configuration or reading a shop',async()=>{
 let reads=0;
 const team={me:async()=>{throw new Error('unauthenticated');},read:async()=>{reads++;}} as unknown as TeamShopClient;
 const service=new VideoService(team);
 await assert.rejects(service.create({cookies:{}} as Request,{shopId:'s',itemId:'123',prompt:'商品视频'}),/unauthenticated/);
 assert.equal(reads,0);
});
test('video generation fails before submitting when cloud configuration is missing',async()=>{
 const key=process.env.DASHSCOPE_API_KEY;delete process.env.DASHSCOPE_API_KEY;
 let reads=0;
 try {const team={me:async()=>({email:'test@example.test'}),read:async()=>{reads++;}} as unknown as TeamShopClient;
 const service=new VideoService(team);
 await assert.rejects(service.create({cookies:{}} as Request,{shopId:'s',itemId:'123',prompt:'商品视频'}),/配置百炼和 OSS/);
 assert.equal(reads,0);}finally{if(key!==undefined)process.env.DASHSCOPE_API_KEY=key;}
});

test('generated video is saved before it becomes available for preview', async()=>{
 const originalFetch=global.fetch; const uploads:Array<{key:string;contents:Buffer}>=[];
 const team={me:async()=>({email:'owner@example.test'}),read:async()=>({item_list:[{item_id:123,item_name:'商品',image:{image_url_list:['https://example.com/product.jpg']}}]})} as unknown as TeamShopClient;
 const service=new VideoService(team);
 const internals=service as unknown as {config:()=>unknown;save:()=>Promise<void>;jobs:Array<{id:string;status:string}>};
 internals.config=()=>({key:'test',base:'https://workspace.example/api/v1',oss:{put:async(key:string,contents:Buffer)=>{uploads.push({key,contents});},signatureUrlV4:async(_method:string,_seconds:number,_options:unknown,key:string)=>`https://oss.example/${key}`}});
 internals.save=async()=>{};
 const requests:string[]=[];let generationBody="";
 global.fetch=async(input,init)=>{const url=String(input);requests.push(url);if(init?.method==='POST'){generationBody=String(init.body);return Response.json({output:{task_id:'task-1'}});}if(url.includes('/tasks/'))return Response.json({output:{task_status:'SUCCEEDED',video_url:'https://result.oss-cn-beijing.aliyuncs.com/video.mp4'}});return new Response(Buffer.from('video'),{headers:{'content-length':'5'}});};
 try{
  const req={cookies:{yz_team:'session'}} as unknown as Request;
  const created=await service.create(req,{shopId:'shop',itemId:'123',prompt:'展示商品'});
  assert.equal(created.status,'PENDING');
  assert.equal(JSON.parse(generationBody).parameters.audio,true);
  await service.advance(internals.jobs[0] as never);
  assert.equal(internals.jobs[0].status,'READY');
  assert.equal(uploads[0].contents.toString(),'video');
  assert.equal(uploads[0].key,`short-video/${created.id}.mp4`);
  assert.equal((await service.preview(req,created.id)).url,`https://oss.example/short-video/${created.id}.mp4`);
  assert.equal(requests.length,3);
 }finally{global.fetch=originalFetch;}
});

test('analysis uses the selected product and accepts a list of selling points',async()=>{
 const originalFetch=global.fetch;let submitted='';
 const team={me:async()=>({email:'owner@example.test'}),read:async(_session:string,shop:string,operation:string,query:{item_id_list:string})=>{assert.equal(shop,'shop');assert.equal(operation,'get_item_base_info');assert.equal(query.item_id_list,'123');return {item_list:[{item_id:123,item_name:'行车记录仪',description:'前后录像'}]};}} as unknown as TeamShopClient;
 const service=new VideoService(team);(service as unknown as {config:()=>unknown}).config=()=>({key:'test',base:'https://workspace.example/api/v1'});
 global.fetch=async(_input,init)=>{submitted=String(init?.body);return Response.json({output:{choices:[{message:{content:JSON.stringify({sellingPoints:['前后录像','循环录像'],style:'电商风格',prompt:'产品特写',warnings:'核对参数'})}}]}});};
 try{const result=await service.analyze({cookies:{yz_team:'session'}} as unknown as Request,{shopId:'shop',itemId:'123'});assert.equal(result.sellingPoints,'前后录像\n循环录像');assert.match(submitted,/行车记录仪/);assert.match(submitted,/前后录像/);}finally{global.fetch=originalFetch;}
});

test('analysis removes disputed numeric claims from the editable draft',async()=>{
 const originalFetch=global.fetch;
 const team={me:async()=>({email:'owner@example.test'}),read:async()=>({item_list:[{item_id:123,item_name:'记录仪',description:'标题1080P，描述1440P'}]})} as unknown as TeamShopClient;
 const service=new VideoService(team);(service as unknown as {config:()=>unknown}).config=()=>({key:'test',base:'https://workspace.example'});
 global.fetch=async()=>Response.json({output:{choices:[{message:{content:JSON.stringify({sellingPoints:'前后录制\n1440P高清',style:'简洁风格',prompt:'展示1440P。展示外观。',warnings:'1080P与1440P冲突'})}}]}});
 try{const draft=await service.analyze({cookies:{}} as unknown as Request,{shopId:'shop',itemId:'123'});assert.doesNotMatch(String(draft.sellingPoints)+String(draft.prompt),/1080|1440/);assert.match(String(draft.warnings),/1080/);}finally{global.fetch=originalFetch;}
});

test('analysis sends extended text in order and ignores description images',async()=>{
 const originalFetch=global.fetch;let sent='';
 const team={me:async()=>({email:'owner@example.test'}),read:async()=>({item_list:[{item_id:123,item_name:'除湿机',description_info:{extended_description:{field_list:[{field_type:'text',text:'安静运行'},{field_type:'image',image_info:{image_url:'https://example.test/image'}},{field_type:'text',text:'便携设计'}]}}}]})} as unknown as TeamShopClient;
 const service=new VideoService(team);(service as unknown as {config:()=>unknown}).config=()=>({key:'test',base:'https://workspace.example'});
 global.fetch=async(_input,init)=>{sent=String(init?.body);return Response.json({output:{choices:[{message:{content:JSON.stringify({sellingPoints:'便携',style:'简洁',prompt:'展示商品',warnings:''})}}]}});};
 try{await service.analyze({cookies:{}} as Request,{shopId:'shop',itemId:'123'});const messages=JSON.parse(sent).input.messages;const input=JSON.parse(messages[1].content);assert.equal(input.description,'安静运行\n\n便携设计');assert.doesNotMatch(input.description,/example/);}finally{global.fetch=originalFetch;}
});

test('description extraction falls back to plain text for empty or image-only blocks',()=>{
 const {productDescriptionText}=require('../src/tools/short-video/product-description') as typeof import('../src/tools/short-video/product-description');
 assert.equal(productDescriptionText({description:'普通描述'}),'普通描述');
 assert.equal(productDescriptionText({description:' 备用描述 ',description_info:{extended_description:{field_list:[{field_type:'image'}]}}}),'备用描述');
 assert.equal(productDescriptionText({}), '');
});

test('analysis includes product attributes and keeps unrelated supported figures',async()=>{
 const originalFetch=global.fetch;let sent='';
 const team={me:async()=>({email:'owner@example.test'}),read:async()=>({item_list:[{item_id:123,item_name:'Mini fan',description:'The speed is uncertain.',attribute_list:[{original_attribute_name:'Weight',attribute_value_list:[{original_value_name:'1',value_unit:'kg'}]},{original_attribute_name:'Empty',attribute_value_list:[]}]}]})} as unknown as TeamShopClient;
 const service=new VideoService(team);(service as unknown as {config:()=>unknown}).config=()=>({key:'test',base:'https://workspace.example'});
 global.fetch=async(_input,init)=>{sent=String(init?.body);return Response.json({output:{choices:[{message:{content:JSON.stringify({sellingPoints:'Lightweight at 1 kg\nOperates at 300 RPM\nPortable design',style:'Clean product photography',prompt:'Show a 300 RPM display. Show the compact design.',warnings:'The claimed 300 RPM is not confirmed.'})}}]}});};
 try{const draft=await service.analyze({cookies:{}} as Request,{shopId:'shop',itemId:'123'});const input=JSON.parse(JSON.parse(sent).input.messages[1].content);assert.deepEqual(input.attributes,[{name:'Weight',values:[{value:'1',unit:'kg'}]}]);assert.match(String(draft.sellingPoints),/1 kg/);assert.doesNotMatch(String(draft.sellingPoints)+String(draft.prompt),/300/);assert.match(String(draft.prompt),/compact design/);}finally{global.fetch=originalFetch;}
});

test('target review reads the original product and does not disclose another owner job',async()=>{
 let reads=0;
 const team={me:async()=>({email:'owner@example.test'}),read:async(_session:string,shop:string,operation:string,query:{item_id_list:string})=>{reads++;assert.equal(shop,'shop');assert.equal(operation,'get_item_base_info');assert.equal(query.item_id_list,'123');return {item_list:[{item_id:123,item_name:'Current name',video_info:[{video_url:'https://example.test/video'}]}]};}} as unknown as TeamShopClient;
 const service=new VideoService(team);const internal=service as unknown as {jobs:unknown[]};
 internal.jobs=[{id:'mine',owner:'owner@example.test',shopId:'shop',itemId:'123',itemName:'Old name',status:'READY',objectKey:'video.mp4'},{id:'other',owner:'other@example.test',shopId:'shop',itemId:'123',status:'READY',objectKey:'video.mp4'}];
 const req={cookies:{yz_team:'session'}} as unknown as Request;
 const result=await service.target(req,'mine');assert.equal(result.itemName,'Current name');assert.equal(result.videoInfoReturned,true);assert.deepEqual(result.videoInfo,[{video_url:'https://example.test/video'}]);
 await assert.rejects(service.target(req,'other'));assert.equal(reads,1);
});

test('publication uploads in 4 MB parts, checks status and verifies the returned product URL',async()=>{
 const calls:string[]=[];let updated=false;
 const team={videoCapabilities:async()=>({version:1}),me:async()=>({email:'owner@example.test'}),read:async()=>({item_list:[{item_id:123,item_name:'Product',video_info:updated?[{video_url:'https://cdn.example/new'}]:[]}]}),video:async(_s:string,_shop:string,op:string,b:Record<string,unknown>)=>{calls.push(op);if(op==='init')return {video_upload_id:'ph_upload'};if(op==='part'){const size=Buffer.from(String(b.data),'base64').length;assert.equal(size,calls.filter(x=>x==='part').length===1?4*1024*1024:10);return {};}if(op==='result')return {status:'SUCCEEDED',video_info:{video_url_list:[{video_url:'https://cdn.example/new'}]}};if(op==='update'){assert.deepEqual(b.expected_video_info,[]);updated=true;return {};}return {};}} as unknown as TeamShopClient;
 const service=new VideoService(team);const internal=service as unknown as {jobs:unknown[];config:()=>unknown;save:()=>Promise<void>};
 internal.jobs=[{id:'job',owner:'owner@example.test',shopId:'shop',itemId:'123',itemName:'Product',status:'READY',objectKey:'video.mp4'}];internal.config=()=>({oss:{get:async()=>({content:Buffer.alloc(4*1024*1024+10)})}});internal.save=async()=>{};
 const req={cookies:{yz_team:'session'}} as unknown as Request;
 await service.upload(req,'job',{expected:[]});
 for(let i=0;i<50&&(await service.list(req))[0].publication?.status==='UPLOADING';i++)await new Promise(r=>setTimeout(r,5));
 assert.equal((await service.list(req))[0].publication?.status,'TRANSCODING');
 assert.equal((await service.publicationStatus(req,'job')).publication?.status,'TRANSCODED');
 assert.equal((await service.apply(req,'job')).publication?.status,'APPLIED');
 assert.deepEqual(calls,['init','part','part','complete','result','update']);
});

test('uncertain upload cannot be submitted again and changed target is rejected',async()=>{
 let inits=0;const team={videoCapabilities:async()=>({version:1}),me:async()=>({email:'owner@example.test'}),read:async()=>({item_list:[{item_id:123,video_info:[{video_url:'old'}]}]}),video:async()=>{inits++;throw Error('timeout');}} as unknown as TeamShopClient;
 const service=new VideoService(team);const internal=service as unknown as {jobs:unknown[];config:()=>unknown;save:()=>Promise<void>};internal.jobs=[{id:'job',owner:'owner@example.test',shopId:'shop',itemId:'123',itemName:'Product',status:'READY',objectKey:'video.mp4'}];internal.config=()=>({oss:{get:async()=>({content:Buffer.from('video')})}});internal.save=async()=>{};
 const req={cookies:{yz_team:'session'}} as unknown as Request;
 await assert.rejects(service.upload(req,'job',{expected:[]}),/变化/);assert.equal(inits,0);
 await service.upload(req,'job',{expected:[{video_url:'old'}]});for(let i=0;i<50&&(await service.list(req))[0].publication?.status==='UPLOADING';i++)await new Promise(r=>setTimeout(r,5));
 assert.equal((await service.list(req))[0].publication?.status,'UNKNOWN');await assert.rejects(service.upload(req,'job',{expected:[{video_url:'old'}]}),/已有上传记录/);assert.equal(inits,1);
});

test('rejected update requires fresh review before retry and reuses uploaded video',async()=>{
 const {BadRequestException}=require('@nestjs/common') as typeof import('@nestjs/common');let current:unknown[]=[{video_url:'old'}];let reject=true;
 const team={me:async()=>({email:'owner@example.test'}),read:async()=>({item_list:[{item_id:123,video_info:current}]}),video:async(_s:string,_shop:string,op:string)=>{assert.equal(op,'update');if(reject)throw new BadRequestException('changed');current=[{video_url:'new'}];return {};}} as unknown as TeamShopClient;
 const service=new VideoService(team);const internal=service as unknown as {jobs:unknown[];save:()=>Promise<void>};internal.jobs=[{id:'job',owner:'owner@example.test',shopId:'shop',itemId:'123',itemName:'Product',status:'READY',objectKey:'video.mp4',publication:{status:'TRANSCODED',uploadId:'ph_video',expected:[],urls:['new']}}];internal.save=async()=>{};
 const req={cookies:{yz_team:'session'}} as unknown as Request;
 assert.equal((await service.apply(req,'job')).publication?.status,'REVIEW_REQUIRED');await assert.rejects(service.reconfirm(req,'job',{expected:[]}),/变化/);
 assert.equal((await service.reconfirm(req,'job',{expected:current})).publication?.status,'TRANSCODED');reject=false;assert.equal((await service.apply(req,'job')).publication?.status,'APPLIED');
});

test('an uncertain upload with an ID can be checked without submitting another upload',async()=>{
 const team={me:async()=>({email:'owner@example.test'}),video:async(_s:string,_shop:string,op:string)=>{assert.equal(op,'result');return {status:'SUCCEEDED',video_info:{video_url_list:[{video_url:'new'}]}};}} as unknown as TeamShopClient;
 const service=new VideoService(team);const internal=service as unknown as {jobs:unknown[];save:()=>Promise<void>};internal.jobs=[{id:'job',owner:'owner@example.test',shopId:'shop',itemId:'123',itemName:'Product',status:'READY',objectKey:'video.mp4',publication:{status:'UNKNOWN',uploadId:'ph_video',expected:[]}}];internal.save=async()=>{};
 assert.equal((await service.publicationStatus({cookies:{yz_team:'session'}} as unknown as Request,'job')).publication?.status,'TRANSCODED');
});

test('only an explicitly failed transcode permits a reviewed retry',async()=>{
 let calls=0;const team={me:async()=>({email:'owner@example.test'}),read:async()=>({item_list:[{item_id:123,video_info:[]}]}),videoCapabilities:async()=>({version:1}),video:async(_session:string,_shop:string,op:string)=>{calls++;if(op==='result')return {status:'FAILED'};if(op==='init')return {video_upload_id:'new_id'};return {};}} as unknown as TeamShopClient;
 const service=new VideoService(team);const internal=service as unknown as {jobs:Array<{publication:{status:string;failureKind?:string}}>;config:()=>unknown;save:()=>Promise<void>};internal.jobs=[{id:'job',owner:'owner@example.test',shopId:'shop',itemId:'123',itemName:'Product',status:'READY',objectKey:'video.mp4',publication:{status:'TRANSCODING',uploadId:'old_id',expected:[]}} as never];internal.config=()=>({oss:{get:async()=>({content:Buffer.from('video')})}});internal.save=async()=>{};
 const req={cookies:{yz_team:'session'}} as unknown as Request;
 await assert.rejects(service.upload(req,'job',{expected:[]},true),/不支持/);await service.publicationStatus(req,'job');assert.equal(internal.jobs[0].publication.failureKind,'TRANSCODING');
 await service.upload(req,'job',{expected:[]},true);for(let i=0;i<50&&internal.jobs[0].publication.status==='UPLOADING';i++)await new Promise(r=>setTimeout(r,5));assert.equal(internal.jobs[0].publication.status,'TRANSCODING');assert.equal(calls,4);
});

test('interrupted association resumes in verification, not upload recovery',()=>{
 const {recoverInterruptedPublication}=require('../src/tools/short-video/video') as typeof import('../src/tools/short-video/video');
 const applying={status:'APPLYING',expected:[]};recoverInterruptedPublication(applying);assert.equal(applying.status,'VERIFY_PENDING');
 const uploading={status:'UPLOADING',expected:[]};recoverInterruptedPublication(uploading);assert.equal(uploading.status,'UNKNOWN');
});

test('a delayed status response cannot undo an association in progress',async()=>{
 let release!:(v:unknown)=>void;const result=new Promise(resolve=>{release=resolve;});
 const team={me:async()=>({email:'owner@example.test'}),video:async()=>result} as unknown as TeamShopClient;
 const service=new VideoService(team);const internal=service as unknown as {jobs:Array<{publication:{status:string}}>;save:()=>Promise<void>};internal.jobs=[{id:'job',owner:'owner@example.test',shopId:'shop',itemId:'123',itemName:'Product',status:'READY',objectKey:'video.mp4',publication:{status:'TRANSCODED',uploadId:'id',expected:[]}} as never];internal.save=async()=>{};
 const req={cookies:{yz_team:'session'}} as unknown as Request;const pending=service.publicationStatus(req,'job');await new Promise(r=>setImmediate(r));internal.jobs[0].publication.status='APPLYING';release({status:'SUCCEEDED',video_info:{video_url_list:[]}});await pending;assert.equal(internal.jobs[0].publication.status,'APPLYING');
});

test('missing video field requires explicit acknowledgement and a compatible gateway',async()=>{
 let init=0;const team={videoCapabilities:async()=>({version:2}),me:async()=>({email:'owner@example.test'}),read:async()=>({item_list:[{item_id:123}]}),video:async(_s:string,_shop:string,op:string)=>{if(op==='init'){init++;return {video_upload_id:'ph_test'};}return {};}} as unknown as TeamShopClient;
 const service=new VideoService(team);const internal=service as unknown as {jobs:unknown[];config:()=>unknown;save:()=>Promise<void>};internal.jobs=[{id:'job',owner:'owner@example.test',shopId:'shop',itemId:'123',itemName:'Product',status:'READY',objectKey:'video.mp4'}];internal.config=()=>({oss:{get:async()=>({content:Buffer.from('video')})}});internal.save=async()=>{};const req={cookies:{yz_team:'session'}} as unknown as Request;
 await assert.rejects(service.upload(req,'job',{expected:null}),/核对/);assert.equal(init,0);const created=await service.upload(req,'job',{expected:null,unknownAcknowledged:true});assert.equal(created.publication?.expected,null);
 for(let i=0;i<50&&(await service.list(req))[0].publication?.status==='UPLOADING';i++)await new Promise(r=>setTimeout(r,5));assert.equal(init,1);
});
