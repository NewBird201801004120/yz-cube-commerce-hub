import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTeamApp} from '../src/team-main';
import {LocalizationPlatform} from '../src/localization-platform';
import {LocalizationService,LocalizationController} from '../src/localization';
import type {LocalizationPublisher} from '../src/localization-engine';

test('localization HTTP: authentication, simulation source API boundary, independent drafts, preview, explicit publish, persisted task and recovery',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localization-http-'));process.env.NODE_ENV='test';process.env.LOCALIZATION_DATA_DIR=join(dir,'localization');process.env.LISTING_DATA_DIR=join(dir,'listing');
 const remote=createServer(async(req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/api/v1/development/login'){res.end(JSON.stringify({token:'private-fixture-token',expiresIn:3600}));return;}res.end(JSON.stringify({email:req.headers.authorization?'operator@fixture.test':'',role:'ADMIN'}));});remote.listen(0,'127.0.0.1');await once(remote,'listening');process.env.TEAM_API_ORIGIN=`http://127.0.0.1:${(remote.address() as {port:number}).port}`;
 const app=await createTeamApp();await app.listen(0,'127.0.0.1');const base=await app.getUrl(),headers={origin:'http://127.0.0.1:3100','content-type':'application/json'};
 const platform=app.get(LocalizationPlatform),service=app.get(LocalizationService);let creates=0,completes=0;
 const shop={id:'fixture-ph',shopId:'fixture-001',shopName:'模拟测试店铺',region:'PH',currency:'PHP',language:'English',status:'CONNECTED'};
 platform.shops=async()=>[shop,{...shop,id:'fixture-th',region:'TH',currency:'THB',language:'ไทย'}];platform.capabilities=async()=>({path:'product' as const,issues:[],writePermission:'unverified',note:'fixture'});platform.validateMarket=async()=>[];platform.rawMetadata=async()=>({categories:{category_list:[{category_id:1,has_children:false}]},attributes:{list:[]},brands:{brand_list:[{brand_id:0,original_brand_name:'NoBrand'}]},logistics:{logistics_channel_list:[{logistics_channel_id:1,enabled:true,fee_type:'SIZE_INPUT'}]},limits:{},capabilities:{path:'product',issues:[]},categoryId:1,connectionId:'fixture-ph',fetchedAt:''});service.content.matchCategory=async()=>({id:1,name:'Fixture',path:'Fixture'});
 const publisher:LocalizationPublisher={capabilities:async()=>({path:'product',issues:[]}),prepare:async()=>({imageIds:['fixture']}),create:async()=>{creates++;return {remoteId:'999001'};},complete:async()=>{completes++;if(completes===1)throw Error('fixture partial failure');},reconcile:async()=>({status:'unknown'})};platform.publisher=()=>publisher;platform.taskStatus=async()=> 'UNLIST';
 const call=async(path:string,method='GET',body?:unknown,cookie='')=>fetch(base+'/api/v1'+path,{method,headers:{...headers,...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{
  assert.equal((await call('/localization/sources')).status,401);
  const login=await call('/auth/login','POST',{email:'operator@fixture.test',password:'fixture'});assert.equal(login.status,201);const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const input={schemaVersion:1,sourceSystem:'simulation-fixture',sourceProductId:'source-1',title:'Fixture storage box',description:'One white box, 20 cm.',images:['https://example.com/fixture.jpg'],parameters:{length:'20 cm'},specificationNames:[],variants:[{sku:'BOX-WHITE',options:[],stock:5}],weightKg:.2,dimensionsCm:{length:20,width:12,height:8}};
  assert.equal((await call('/localization/sources','POST',input,cookie)).status,404);
  const source=service.engine.importSource('operator@fixture.test',input);
  const d=await (await call('/localization/drafts','POST',{sourceId:source.id,shopId:shop.id},cookie)).json();
  const other=await (await call('/localization/drafts','POST',{sourceId:source.id,shopId:'fixture-th'},cookie)).json();assert.equal(other.shop.currency,'THB');
  service.content.matchCategory=async()=>null;
  const unmatched=await (await call(`/localization/drafts/${d.id}/adapt`,'POST',{},cookie)).json();assert.equal(unmatched.draft.marketAdaptation.status,'needs_input');assert.ok(unmatched.issues.some((x:string)=>x.includes('类目')));assert.equal(creates,0);
  service.content.matchCategory=async()=>({id:1,name:'Fixture',path:'Fixture'});
  const missing=await (await call(`/localization/drafts/${d.id}/preview`,'POST',{},cookie)).json();assert.ok(missing.issues.length);assert.equal(missing.canPublish,false);
  assert.equal(missing.draft.categoryId,1);assert.equal(missing.draft.brandId,0);assert.deepEqual(missing.draft.logistics,[{id:1,enabled:true}]);
  assert.deepEqual(service.engine.getSource('operator@fixture.test',source.id),source);
  const repeated=await (await call(`/localization/drafts/${d.id}/adapt`,'POST',{},cookie)).json();assert.equal(repeated.draft.revision,missing.draft.revision);
  assert.equal(service.engine.getDraft('operator@fixture.test',other.id).categoryId,null);assert.equal(creates,0);
  const metadata=platform.rawMetadata;platform.rawMetadata=async()=>{throw new Error('private-fixture-token');};
  const failed=await (await call(`/localization/drafts/${other.id}/adapt`,'POST',{},cookie)).json();assert.equal(failed.draft.marketAdaptation.status,'failed');assert.ok(!JSON.stringify(failed).includes('private-fixture-token'));assert.equal(failed.draft.title,other.title);
  platform.rawMetadata=metadata;const recovered=await (await call(`/localization/drafts/${other.id}/adapt`,'POST',{},cookie)).json();assert.equal(recovered.draft.marketAdaptation.status,'needs_input');assert.equal(recovered.draft.categoryId,1);assert.equal(creates,0);


  const saved=await (await call(`/localization/drafts/${d.id}`,'PUT',{...missing.draft,title:'English fixture',categoryId:1,brandId:0,marketConfirmed:true,imagesReviewed:true,logistics:[{id:1,enabled:true}],variants:[{sku:'BOX-WHITE',options:[],stock:5,price:99}]},cookie)).json();assert.equal(saved.revision,missing.draft.revision+1);
  const stale=await call(`/localization/drafts/${d.id}`,'PUT',d,cookie);assert.equal(stale.status,409);
  const drafts=await (await call('/localization/drafts','GET',undefined,cookie)).json();assert.equal(drafts.find((v:any)=>v.id===other.id).title,input.title);
  const confirmed=await (await call(`/localization/drafts/${d.id}`,'PUT',{...saved,marketConfirmed:true},cookie)).json();assert.equal(confirmed.revision,saved.revision+1);
  const preview=await (await call(`/localization/drafts/${d.id}/preview`,'POST',{},cookie)).json();assert.equal(preview.canPublish,true);assert.equal(preview.draft.categoryId,1);assert.equal(preview.draft.marketAdaptation.status,'ready');
  const repeat=await (await call(`/localization/drafts/${d.id}/preview`,'POST',{},cookie)).json();assert.equal(repeat.draft.revision,preview.draft.revision);
  assert.equal((await call(`/localization/drafts/${d.id}/publish`,'POST',{revision:preview.draft.revision,confirmed:false},cookie)).status,400);
  const published=await (await call(`/localization/drafts/${d.id}/publish`,'POST',{revision:preview.draft.revision,confirmed:true},cookie)).json();
  // Background publishing is observed through its persisted task, just as after browser disconnect.
  let task=service.engine.getTask('operator@fixture.test',published.id);for(let i=0;i<40&&['preparing','creating','completing'].includes(task.status);i++){await new Promise(r=>setTimeout(r,5));task=service.engine.getTask('operator@fixture.test',published.id);}
  assert.equal(task.status,'created');assert.equal(task.remoteId,'999001');assert.equal(creates,1);
  await call(`/localization/jobs/${task.id}/resume`,'POST',{},cookie);for(let i=0;i<40;i++){task=service.engine.getTask('operator@fixture.test',task.id);if(task.status==='succeeded')break;await new Promise(r=>setTimeout(r,5));}assert.equal(task.status,'succeeded');assert.equal(creates,1);
  assert.equal((await call(`/localization/jobs/${task.id}/resume`,'POST',{},cookie)).status,400);assert.equal(completes,2);
  assert.equal((await call(`/localization/jobs/${task.id}/status`,'POST',{},cookie)).status,201);assert.equal(completes,2);
  await call(`/localization/drafts/${d.id}/publish`,'POST',{revision:preview.draft.revision,confirmed:true},cookie);assert.equal(creates,1);
  const raw=JSON.stringify(await (await call('/localization/jobs','GET',undefined,cookie)).json());assert.ok(!raw.includes('private-fixture-token'));
  assert.throws(()=>service.engine.getDraft('another@fixture.test',d.id));
  assert.equal((await call('/localization/assets','POST',{data:Buffer.from('not an image').toString('base64')},cookie)).status,400);
 }finally{await app.close();remote.close();await once(remote,'close');rmSync(dir,{recursive:true,force:true});}
});

test('preview distinguishes shop permission failure from product rules and still checks product',async()=>{
 const draft={shop:{id:'shop'},sourceId:'source',media:{assets:[],variantImages:[],detailBlocks:[]}};
 let checked=false;
 const service:any={adapt:async()=>({draft,issues:[]}),engine:{validate:()=>[],getSource:()=>({})},platform:{capabilities:async()=>{throw {getStatus:()=>403,getResponse:()=>({message:'目标店铺不在本次保存测试范围'})};},validateMarket:async()=>{checked=true;return ['请补齐必填属性：Audio Compatibility'];}}};
 const result=await LocalizationService.prototype.preview.call(service as any,{owner:'fixture'} as any,'draft');
 assert.equal(checked,true);assert.equal(result.canPublish,false);
 assert.ok(result.issues.some(issue=>issue.startsWith('店铺发布通道受限：')));
 assert.ok(result.issues.includes('请补齐必填属性：Audio Compatibility'));
 assert.ok(!result.issues.some(issue=>issue.includes('检查连接状态')));
 service.platform.capabilities=async()=>({issues:[]}) as any;
 service.platform.validateMarket=async()=>{throw Error('secret-provider-diagnostic');};
 const unavailable=await LocalizationService.prototype.preview.call(service as any,{owner:'fixture'} as any,'draft');
 assert.ok(unavailable.issues.some(issue=>issue.startsWith('商品市场规则检查未完成：')));
 assert.ok(!JSON.stringify(unavailable).includes('secret-provider-diagnostic'));
});

test('retry reconciles remotely listed or reviewing items before any publication writes',async()=>{
 for(const status of ['succeeded','reviewing','unlisted','unavailable']){
  let resumed=0,reads=0;const original={status:'created',remoteId:'already-created',error:'stale status',stage:'完成规格与市场发布'};
  const reconciled=status==='succeeded'?{...original,status:'succeeded',error:undefined,stage:'发布完成'}:status==='reviewing'?{...original,stage:'等待虾皮审核'}:original;
  const controller:any={service:{engine:{getTask:()=>original,startResume:()=>{resumed++;return original;}},publisher:()=>({})},checkStatus:async()=>{reads++;if(status==='unavailable')throw Error('read unavailable');return reconciled;}};
  const run=()=>LocalizationController.prototype.resume.call(controller,{localization:{owner:'operator'}} as any,'task');
  if(status==='unavailable')await assert.rejects(run,/read unavailable/);else assert.deepEqual(await run(),reconciled);
  assert.equal(reads,1);assert.equal(resumed,status==='unlisted'?1:0);
 }
});
