import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import cookieParser from 'cookie-parser';
import {Auth} from '../src/auth';
import {Database} from '../src/database';
import {DevelopmentGuard} from '../src/development';
import {LocalizationService,LocalizationGuard} from '../src/localization';
import {LocalizationEngine} from '../src/localization-engine';
import {LocalizationPlatform} from '../src/localization-platform';
import {LocalizationIntegrationService} from '../src/localization-integration';
import {LocalizationReceiptsController,LocalizationReceiptsDevelopmentController} from '../src/localization-receipts';
import {createTeamApp} from '../src/team-main';

const owner='operator@fixture.test';
const client={id:'simulation',tokenSha256:'private-hash',ownerEmail:owner,sourceSystem:'simulation',allowedShopIds:['shop-ph'],enabled:true};
const shop={id:'shop-ph',shopId:'100',shopName:'PH fixture',region:'PH',currency:'PHP',language:'English',status:'CONNECTED'};
const input={schemaVersion:1,requestId:'receipt-1',product:{schemaVersion:1,sourceSystem:'simulation',sourceProductId:'box-1',title:'Fixture storage box',description:'One 20 cm box.',images:['https://example.com/box.jpg'],parameters:{length:'20 cm'},specificationNames:[],variants:[{sku:'BOX',options:[],stock:5}],weightKg:.2,dimensionsCm:{length:20,width:12,height:8}},target:{connectionId:shop.id,country:'PH',language:'English',publishing:{variants:[{sku:'BOX',price:99,stock:5}]}}};
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));

 test('owner receipts: safe summary, read-only recovery, explicit concurrent retry and publication protection',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'receipts-service-'));
 const engine=new LocalizationEngine(dir);let calls=0,fail=true,release:()=>void=()=>{};
 const service={engine,adapt:async()=>{},content:{localize:async()=>{calls++;if(fail)throw Error('private provider detail');await new Promise<void>(resolve=>{release=resolve;});return {title:'Localized box'};}}} as unknown as LocalizationService;
 const platform={shops:async()=>[shop]} as unknown as LocalizationPlatform;
 let integration=new LocalizationIntegrationService(service,platform);
 try{
  const first=await integration.accept(client,input);await turn();
  const result=integration.listForOwner(owner);assert.equal(result.environment,'central');assert.equal(result.records.length,1);assert.equal(result.records[0].status,'localization_failed');
  assert.equal(result.records[0].title,input.product.title);assert.equal(result.records[0].shopName,shop.shopName);assert.equal(result.records[0].reviewPath,'/tools/localization?draft='+first.draftId);
  for(const key of ['owner','clientId','fingerprint','tokenSha256','product'])assert.equal(key in result.records[0],false);
  assert.equal(JSON.stringify(result).includes('private provider detail'),false);
  assert.deepEqual(integration.listForOwner('another@fixture.test').records,[]);
  assert.throws(()=>integration.retryForOwner('another@fixture.test',first.id),/接收记录不存在/);
  const prior=calls;integration.listForOwner(owner);integration.listForOwner(owner);assert.equal(calls,prior);
  fail=false;
  const retried=Array.from({length:5},()=>integration.retryForOwner(owner,first.id));
  assert.ok(retried.every(r=>r.status==='localizing'));assert.equal(calls,prior+1);
  release();await turn();assert.equal(integration.listForOwner(owner).records[0].status,'awaiting_review');
  integration.retryForOwner(owner,first.id);assert.equal(calls,prior+1);
  // Persist a crash marker: listing after restart reports failure but never starts a paid request.
  const path=join(dir,'imports',first.id+'.json'),journal=JSON.parse(readFileSync(path,'utf8'));journal.localizationStatus='localizing';writeFileSync(path,JSON.stringify(journal));
  integration=new LocalizationIntegrationService(service,platform);
  assert.equal(integration.listForOwner(owner).records[0].status,'localization_failed');assert.equal(calls,prior+1);
  const taskId=randomUUID(),task={id:taskId,owner,draftId:first.draftId,status:'uncertain',stage:'核对远端结果',createdAt:new Date().toISOString()};
  const taskFile=join(dir,'tasks',taskId+'.json');writeFileSync(taskFile,JSON.stringify(task));
  assert.throws(()=>integration.retryForOwner(owner,first.id),/发布任务/);assert.equal(calls,prior+1);
  writeFileSync(taskFile,JSON.stringify({...task,status:'failed',remoteId:'remote-created-100'}));
  assert.throws(()=>integration.retryForOwner(owner,first.id),/发布任务/);assert.equal(calls,prior+1);
  writeFileSync(taskFile,JSON.stringify({...task,status:'failed'}));
  assert.equal(integration.retryForOwner(owner,first.id).status,'localizing');
  const draft=engine.getDraft(owner,first.draftId);engine.updateDraft(owner,draft.id,{title:'Operator saved while generation ran'},draft.revision);release();await turn();
  assert.equal(calls,prior+2);assert.equal(integration.listForOwner(owner).records[0].status,'localization_failed');assert.equal(engine.getDraft(owner,draft.id).title,'Operator saved while generation ran');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('receipt HTTP routes require admin identity and scope cookie and development reads/retries to that owner',async()=>{
 const seen:string[]=[];
 const integration={listForOwner:(email:string)=>{seen.push(email);return {environment:'central',records:[]};},retryForOwner:(email:string,id:string)=>{seen.push(email+':'+id);return {id,status:'localizing'};}};
 const session=(cookie?:string)=>cookie==='admin'?{userId:'user-1',id:'s-1',kind:'DEV',expiresAt:new Date(Date.now()+60000),user:{email:owner,role:'ADMIN'}}:cookie==='viewer'?{userId:'user-2',expiresAt:new Date(Date.now()+60000),user:{email:'viewer@fixture.test',role:'VIEWER'}}:null;
 @Module({controllers:[LocalizationReceiptsController,LocalizationReceiptsDevelopmentController],providers:[LocalizationGuard,DevelopmentGuard,{provide:LocalizationIntegrationService,useValue:integration},{provide:Auth,useValue:{session:async(req:any)=>session(req.cookies?.fixture)}},{provide:Database,useValue:{session:{findUnique:async()=>session('admin')},user:{findUniqueOrThrow:async()=>({email:owner})}}}]})
 class Fixture{}
 const app=await NestFactory.create(Fixture,{logger:false});app.use(cookieParser());app.setGlobalPrefix('api/v1');await app.listen(0,'127.0.0.1');const base=await app.getUrl();
 const call=(path:string,cookie='',method='GET',authorization='')=>fetch(base+'/api/v1'+path,{method,headers:{cookie:cookie?'fixture='+cookie:'',...(authorization?{authorization}:{})}});
 try{
  assert.equal((await call('/localization/receipts')).status,401);assert.equal((await call('/localization/receipts','viewer')).status,401);assert.equal(seen.length,0);
  assert.equal((await call('/localization/receipts','admin')).status,200);
  assert.equal((await call('/localization/receipts/fixture-id/localize','admin','POST')).status,201);
  assert.equal((await call('/development/localization/imports')).status,401);
  assert.equal((await call('/development/localization/imports','','GET','Bearer fixture_dev_token_1234567890')).status,200);
  assert.equal((await call('/development/localization/imports/fixture-id/localize','','POST','Bearer fixture_dev_token_1234567890')).status,201);
  assert.deepEqual(seen,[owner,owner+':fixture-id',owner,owner+':fixture-id']);
 }finally{await app.close();}
});

test('team receipts proxy keeps remote credentials server-side, distinguishes central drafts and preserves unavailable errors',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'receipts-team-'));
 const names=['NODE_ENV','LOCALIZATION_DATA_DIR','LISTING_DATA_DIR','TEAM_API_ORIGIN','LOCALIZATION_LOCAL_MODE'] as const,previous=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 process.env.NODE_ENV='test';process.env.LOCALIZATION_DATA_DIR=join(dir,'localization');process.env.LISTING_DATA_DIR=join(dir,'listing');
 // Local mock product mode must still read central receipts, never substitute local fixtures.
 process.env.LOCALIZATION_LOCAL_MODE='true';
 let unavailable=false,retries=0;const authHeaders:string[]=[];
 const centralEngine=new LocalizationEngine(join(dir,'central'));const source=centralEngine.importSource(owner,input.product),draft=centralEngine.createDraft(owner,source.id,shop);
 const remote=createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/api/v1/auth/login'){res.setHeader('set-cookie','yz_session=private-web-cookie; HttpOnly');res.end('{}');return;}if(req.url?.startsWith('/api/v1/localization/')){assert.equal(req.headers.cookie,'yz_session=private-web-cookie');assert.equal(req.method,'GET');res.end(JSON.stringify(req.url.endsWith('/sources')?[source]:draft));return;}if(req.url==='/api/v1/development/login'){res.end(JSON.stringify({token:'private-receipts-token',expiresIn:3600}));return;}authHeaders.push(req.headers.authorization||'');if(req.url==='/api/v1/development/me'){res.end(JSON.stringify({email:owner,role:'ADMIN'}));return;}if(unavailable){res.statusCode=404;res.end(JSON.stringify({message:'接收记录服务尚未部署'}));return;}if(req.method==='POST')retries++;res.end(JSON.stringify(req.method==='POST'?{id:'receipt',status:'localizing'}:{environment:'central',records:[{id:'receipt',sourceId:source.id,draftId:draft.id,status:'localization_failed'}]}));});
 remote.listen(0,'127.0.0.1');await once(remote,'listening');const remoteOrigin=`http://127.0.0.1:${(remote.address() as {port:number}).port}`;process.env.TEAM_API_ORIGIN=remoteOrigin;
 const app=await createTeamApp();await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1';
 const call=(path:string,method='GET',cookie='',origin='http://127.0.0.1:3100',body?:unknown)=>fetch(base+path,{method,headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await call('/localization/receipts')).status,401);
  const login=await call('/auth/login','POST','','http://127.0.0.1:3100',{email:owner,password:'fixture'});const cookie=login.headers.get('set-cookie')!.split(';')[0];
  const response=await call('/localization/receipts','GET',cookie),result=await response.json();assert.equal(response.status,200);assert.equal(result.environment,'team');assert.equal(result.reviewOrigin,remoteOrigin);assert.equal(result.records[0].draftId,draft.id);assert.equal(JSON.stringify(result).includes('private-receipts-token'),false);
  assert.equal(app.get(LocalizationService).engine.listDrafts(owner).length,0);
  assert.equal((await call('/localization/receipts/receipt','DELETE',cookie)).status,404);
  assert.equal((await call('/localization/receipts/unknown/open','POST',cookie)).status,404);
  const opened=await call('/localization/receipts/receipt/open','POST',cookie),copy=await opened.json();assert.equal(opened.status,201);assert.equal(copy.id,draft.id);assert.equal(copy.variants[0].sku,'BOX');assert.equal(JSON.stringify(copy).includes('private-web-cookie'),false);
  const service=app.get(LocalizationService);service.content.localize=async(_source,current)=>({title:'Local translated title',sellingPoints:[],description:current.description,specificationNames:current.specificationNames,variants:current.variants,marketConfirmed:false});
  const translated=await(await call('/localization/drafts/'+copy.id+'/localize','POST',cookie)).json();assert.equal(translated.title,'Local translated title');assert.equal(translated.id,copy.id);
  const saved=await(await call('/localization/drafts/'+copy.id,'PUT',cookie,'http://127.0.0.1:3100',{...translated,title:'Local operator edit'})).json();assert.equal(saved.title,'Local operator edit');
  const reopened=await(await call('/localization/receipts/receipt/open','POST',cookie)).json();assert.equal(reopened.title,saved.title);assert.equal(reopened.revision,saved.revision);assert.equal(service.engine.listDrafts(owner).length,1);
  const recovered=new LocalizationEngine(join(dir,'localization'));assert.equal(recovered.getDraft(owner,copy.id).title,saved.title);assert.throws(()=>recovered.getDraft('other',copy.id));assert.equal(centralEngine.getDraft(owner,draft.id).title,input.product.title);
  const preview=await(await call('/localization/drafts/'+copy.id+'/preview','POST',cookie)).json();assert.equal(preview.draft.title,saved.title);assert.equal(preview.canPublish,false);

  assert.equal((await call('/localization/receipts/receipt/localize','POST',cookie,'https://untrusted.example')).status,403);assert.equal(retries,0);
  assert.equal((await call('/localization/receipts/receipt/localize','POST',cookie)).status,201);assert.equal(retries,1);
  assert.ok(authHeaders.length>0&&authHeaders.every(h=>h==='Bearer private-receipts-token'));
  unavailable=true;assert.equal((await call('/localization/receipts','GET',cookie)).status,404);
 }finally{await app.close();remote.close();await once(remote,'close');for(const k of names)if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];rmSync(dir,{recursive:true,force:true});}
});
