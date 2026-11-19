import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LocalizationEngine} from '../src/localization-engine';
import {LocalizationService} from '../src/localization';
import {LocalizationPlatform} from '../src/localization-platform';
import {LocalizationIntegrationController,LocalizationIntegrationGuard,LocalizationIntegrationService,integrationServerRequest} from '../src/localization-integration';

test('machine imports: scoped authentication, persistent idempotency, independent markets and localization recovery without publishing',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localization-integration-')),previousConfig=process.env.LOCALIZATION_INTEGRATIONS_FILE;
 const token='fixture_integration_token_12345678901234567890',otherToken='fixture_other_token_1234567890123456789012345';
 const owner='operator@fixture.test',configFile=join(dir,'clients.json');
 const client={id:'simulation-a',tokenSha256:createHash('sha256').update(token).digest('hex'),ownerEmail:owner,sourceSystem:'simulation',allowedShopIds:['fixture-ph','fixture-th'],enabled:true};
 writeFileSync(configFile,JSON.stringify([client,{...client,id:'simulation-b',tokenSha256:createHash('sha256').update(otherToken).digest('hex')}]),{mode:0o600});process.env.LOCALIZATION_INTEGRATIONS_FILE=configFile;
 let localizations=0,failLocalization=false,lastLanguage='';
 const shops=[{id:'fixture-ph',shopId:'100',shopName:'PH fixture',region:'PH',currency:'PHP',language:'English',status:'CONNECTED'},{id:'fixture-th',shopId:'200',shopName:'TH fixture',region:'TH',currency:'THB',language:'ไทย',status:'CONNECTED'},{id:'private-shop',shopId:'300',shopName:'Private',region:'PH',currency:'PHP',language:'English',status:'CONNECTED'}];
 const boot=async()=>{
  const engine=new LocalizationEngine(join(dir,'data'));
  @Module({controllers:[LocalizationIntegrationController],providers:[LocalizationIntegrationGuard,LocalizationIntegrationService,{provide:LocalizationService,useValue:{engine,adapt:async()=>{},content:{localize:async(_source:unknown,draft:{language:string})=>{localizations++;lastLanguage=draft.language;if(failLocalization)throw Error('fixture unavailable');return {title:'Localized fixture title'};}}}},{provide:LocalizationPlatform,useValue:{shops:async()=>shops,requirements:async(_ctx:unknown,id:string,categoryId?:number)=>({connectionId:id,categoryId:categoryId??null,rules:{limits:{}},support:{path:'product'}})}}]})
  class FixtureModule{}
  const app=await NestFactory.create(FixtureModule,{logger:false});app.setGlobalPrefix('api/v1');await app.listen(0,'127.0.0.1');return {app,engine,base:(await app.getUrl())+'/api/v1/localization/integration'};
 };
 let runtime=await boot();
 const call=(path:string,method='GET',body?:unknown,auth:string|null=token,extra:Record<string,string>={})=>fetch(runtime.base+path,{method,headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+auth}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const payload={schemaVersion:1,requestId:'event-ph-001',product:{schemaVersion:1,sourceSystem:'simulation',sourceProductId:'box-001',title:'Storage box',description:'A 20 cm box.',images:['https://example.com/fixture.jpg'],parameters:{length:'20 cm'},specificationNames:['Color'],variants:[{sku:'BOX-W',options:['White'],stock:5}],weightKg:.2,dimensionsCm:{length:20,width:12,height:8}},target:{connectionId:'fixture-ph',country:'PH',language:'English',publishing:{variants:[{sku:'BOX-W',price:99,stock:5}]}}};
 const settled=async(id:string)=>{for(let i=0;i<30;i++){const value=await (await call('/imports/'+id)).json();if(value.status!=='localizing')return value;await new Promise(r=>setTimeout(r,3));}throw Error('localization did not settle');};
 try{
  assert.equal((await call('/imports','POST',payload,null)).status,401);
  assert.equal((await call('/imports','POST',payload,'wrong_fixture_token_1234567890123456789')).status,401);
  assert.equal((await call('/imports','POST',payload,token,{origin:'https://example.com'})).status,401);
  assert.equal((await call('/imports','POST',payload,token,{cookie:'yz_session=fixture'})).status,401);
  assert.equal((await call('/imports','POST',{...payload,target:{...payload.target,connectionId:'private-shop'}})).status,403);
  assert.equal((await call('/imports','POST',{...payload,product:{...payload.product,sourceSystem:'another'}})).status,403);
  assert.equal((await call('/imports','POST',{...payload,target:{...payload.target,country:'TH'}})).status,400);
  assert.equal((await call('/imports','POST',{...payload,schemaVersion:2})).status,400);
  assert.equal((await call('/imports','POST',{...payload,owner:'untrusted@fixture.test'})).status,400);
  assert.equal((await call('/imports','POST',{...payload,product:{...payload.product,category_id:123}})).status,400);
  const allowed=await (await call('/shops')).json();assert.deepEqual(allowed.map((s:any)=>s.id),['fixture-ph','fixture-th']);
  for(const s of allowed){assert.ok(Array.isArray(s.supportedLanguages));assert.equal(s.supportedLanguages[0],s.language);assert.equal(new Set(s.supportedLanguages).size,s.supportedLanguages.length);assert.deepEqual(s.supportedLanguages,s.region==='PH'?['English','Filipino']:['ไทย']);}
  const beforeInvalid=localizations;
  for(const language of ['Klingon','en',' English','','简体中文','ไทย'])assert.equal((await call('/imports','POST',{...payload,target:{...payload.target,language}})).status,400);
  assert.equal((await call('/imports','POST',{...payload,product:{...payload.product,variants:[payload.product.variants[0],{...payload.product.variants[0],sku:'DIFFERENT-SKU-SAME-OPTIONS'}]}})).status,400);
  assert.equal((await call('/imports','POST',{...payload,product:{...payload.product,specificationNames:[],variants:[{sku:'A',options:[]},{sku:'B',options:[]}]}})).status,400);
  assert.equal(localizations,beforeInvalid);assert.equal(runtime.engine.listDrafts(owner).length,0);
  const incomplete=structuredClone(payload) as any;delete incomplete.product.weightKg;delete incomplete.product.dimensionsCm;delete incomplete.target.publishing;
  const rejected=await call('/imports','POST',incomplete);assert.equal(rejected.status,400);const rejection=await rejected.json();assert.deepEqual(rejection.fieldErrors.map((e:any)=>e.field),['product.weightKg','product.dimensionsCm.length','product.dimensionsCm.width','product.dimensionsCm.height','target.publishing.variants']);
  for(const modify of [(b:any)=>{delete b.target.publishing.variants[0].price;},(b:any)=>{delete b.target.publishing.variants[0].stock;},(b:any)=>{b.product.dimensionsCm.width=0;},(b:any)=>{b.target.publishing.variants[0].stock=1.5;},(b:any)=>{b.product.description=' ';},(b:any)=>{b.product.images=[];}]){const b=structuredClone(payload);modify(b);assert.equal((await call('/imports','POST',b)).status,400);}
  assert.equal(runtime.engine.listSources(owner).length,0);assert.equal(runtime.engine.listDrafts(owner).length,0);assert.equal(localizations,0);
  const responses=await Promise.all(Array.from({length:5},()=>call('/imports','POST',payload)));
  for(const response of responses)assert.equal(response.status,201);
  const receipts=await Promise.all(responses.map(r=>r.json())),first=receipts[0];
  assert.equal(responses.filter(r=>r.headers.get('x-localization-import-outcome')==='created').length,1);assert.equal(responses.filter(r=>r.headers.get('x-localization-import-outcome')==='replayed').length,4);assert.ok(responses.every(r=>r.headers.get('x-localization-receipt-id')===first.id));
  assert.equal(receipts.filter(r=>r.outcome==='created'&&!r.duplicate).length,1);assert.equal(receipts.filter(r=>r.outcome==='replayed'&&r.duplicate).length,4);assert.ok(receipts.filter(r=>r.duplicate).every(r=>r.message.includes('未新增记录或消息')));
  assert.ok(first.sourceId&&first.draftId&&first.id);assert.equal(new Set(receipts.map(r=>r.id)).size,1);
  assert.equal((await settled(first.id)).status,'awaiting_review');assert.equal(localizations,1);
  assert.equal(runtime.engine.listSources(owner).length,1);assert.equal(runtime.engine.listDrafts(owner).length,1);assert.equal(runtime.engine.listTasks(owner).length,0);
  assert.deepEqual((await settled(first.id)).publishTasks,[]);
  assert.equal((await call('/imports','POST',{...payload,product:{...payload.product,title:'Changed'}})).status,409);
  assert.equal((await call('/imports/'+first.id,'GET',undefined,otherToken)).status,404);
  const draft=runtime.engine.getDraft(owner,first.draftId);runtime.engine.updateDraft(owner,draft.id,{title:'Operator edited title'},draft.revision);
  await call('/imports','POST',payload);assert.equal(runtime.engine.getDraft(owner,draft.id).title,'Operator edited title');assert.equal(localizations,1);
  const th=await (await call('/imports','POST',{...payload,requestId:'event-th-001',target:{...payload.target,connectionId:'fixture-th',country:'TH',language:'ไทย'}})).json();await settled(th.id);
  assert.equal(th.sourceId,first.sourceId);assert.notEqual(th.draftId,first.draftId);assert.equal(runtime.engine.getDraft(owner,th.draftId).shop.currency,'THB');assert.equal(runtime.engine.getDraft(owner,first.draftId).title,'Operator edited title');
  failLocalization=true;const failed=await (await call('/imports','POST',{...payload,requestId:'failed-ai'})).json();assert.equal((await settled(failed.id)).status,'localization_failed');assert.ok(runtime.engine.getDraft(owner,failed.draftId));
  const priorCalls=localizations;await call('/imports/'+failed.id);await call('/imports','POST',{...payload,requestId:'failed-ai'});assert.equal(localizations,priorCalls);
  failLocalization=false;await call('/imports/'+failed.id+'/localize','POST',{});assert.equal((await settled(failed.id)).status,'awaiting_review');assert.equal(localizations,priorCalls+1);
  await runtime.app.close();runtime=await boot();
  const restored=await (await call('/imports','POST',payload)).json();assert.equal(restored.id,first.id);assert.equal(restored.draftId,first.draftId);assert.equal(runtime.engine.getDraft(owner,first.draftId).title,'Operator edited title');assert.equal(runtime.engine.listSources(owner).length,1);assert.equal(runtime.engine.listDrafts(owner).length,3);assert.equal(runtime.engine.listTasks(owner).length,0);
  // Model a crash after journal creation but before all draft materialization.
  const file=join(dir,'data','imports',failed.id+'.json'),record=JSON.parse(readFileSync(file,'utf8'));record.localizationStatus='localizing';writeFileSync(file,JSON.stringify(record));unlinkSync(join(dir,'data','drafts',failed.draftId+'.json'));
  const interrupted=await (await call('/imports/'+failed.id)).json();assert.equal(interrupted.status,'localization_failed');assert.ok(interrupted.localizationError);assert.equal(runtime.engine.getDraft(owner,failed.draftId).id,failed.draftId);assert.equal(localizations,priorCalls+1);
  await call('/imports/'+failed.id+'/localize','POST',{});assert.equal((await settled(failed.id)).status,'awaiting_review');
  assert.equal(integrationServerRequest({path:'/api/v1/localization/integration/imports',method:'POST',headers:{authorization:'Bearer fixture'}}),true);
  assert.equal(integrationServerRequest({path:'/api/v1/localization/drafts/123/publish',method:'POST',headers:{authorization:'Bearer fixture'}}),false);
  assert.equal(integrationServerRequest({path:'/api/v1/localization/integration/imports',method:'POST',headers:{authorization:'Bearer fixture',cookie:'session=1'}}),false);
  // The production token can cover every connected shop, including future authorizations.
  const configure=(patch:Record<string,unknown>)=>writeFileSync(configFile,JSON.stringify([{...client,...patch},{...client,id:'simulation-b',tokenSha256:createHash('sha256').update(otherToken).digest('hex')}]),{mode:0o600});
  configure({shopScope:'all_connected',allowedShopIds:[]});
  shops.push({id:'future-sg',shopId:'400',shopName:'Future SG',region:'SG',currency:'SGD',language:'English',status:'CONNECTED'});
  shops.push({id:'disconnected',shopId:'500',shopName:'Disconnected',region:'PH',currency:'PHP',language:'English',status:'EXPIRED'});
  shops.push({id:'unsupported-market',shopId:'600',shopName:'Unknown market',region:'XX',currency:'',language:'',status:'CONNECTED'});
  assert.deepEqual((await (await call('/shops')).json()).map((s:any)=>s.id),['fixture-ph','fixture-th','private-shop','future-sg']);
  const allPayload={...payload,requestId:'all-shops-future-sg',target:{...payload.target,connectionId:'future-sg',country:'SG',language:'English'}};
  const allResponse=await call('/imports','POST',allPayload);assert.equal(allResponse.status,201);
  const allReceipt=await allResponse.json();assert.equal((await settled(allReceipt.id)).status,'awaiting_review');
  assert.equal((await call('/imports/'+allReceipt.id,'GET',undefined,otherToken)).status,404);
  assert.equal((await call('/imports','POST',{...allPayload,requestId:'invalid-country',target:{...allPayload.target,country:'PH'}})).status,400);
  assert.equal((await call('/imports','POST',{...allPayload,requestId:'disconnected',target:{connectionId:'disconnected',country:'PH',language:'English'}})).status,400);
  assert.equal((await call('/imports','POST',{...allPayload,requestId:'unsupported-market',target:{connectionId:'unsupported-market',country:'XX',language:'English'}})).status,400);
  assert.equal((await call('/imports','POST',{...allPayload,product:{...allPayload.product,sourceSystem:'untrusted'}})).status,403);
  assert.equal((await call('/imports','POST',{...allPayload,shopScope:'all_connected'})).status,400);
  await runtime.app.close();runtime=await boot();
  assert.equal((await call('/imports/'+allReceipt.id)).status,200);
  assert.equal((await (await call('/imports','POST',allPayload)).json()).id,allReceipt.id);
  configure({});assert.equal((await call('/imports/'+allReceipt.id)).status,403);
  configure({shopScope:'all_conected',allowedShopIds:[]});assert.equal((await call('/shops')).status,401);
  configure({shopScope:'all_connected',allowedShopIds:[],enabled:false});assert.equal((await call('/shops')).status,401);
  assert.equal(runtime.engine.listTasks(owner).length,0);
  // A nondefault language must reach the draft and AI unchanged, without changing market/currency.
  const alternate={...payload,requestId:'ph-chinese',target:{...payload.target,language:'Filipino'}};
  configure({shopScope:'all_connected',allowedShopIds:[]});
  const alternateResponse=await call('/imports','POST',alternate);assert.equal(alternateResponse.status,201);
  const alternateReceipt=await alternateResponse.json();await settled(alternateReceipt.id);
  const alternateDraft=runtime.engine.getDraft(owner,alternateReceipt.draftId);
  assert.equal(lastLanguage,'Filipino');
  assert.equal(alternateDraft.language,'Filipino');assert.equal(alternateDraft.shop.region,'PH');assert.equal(alternateDraft.shop.currency,'PHP');
  assert.equal((await (await call('/imports','POST',alternate)).json()).id,alternateReceipt.id);
  await runtime.app.close();runtime=await boot();
  const alternateRestored=await (await call('/imports/'+alternateReceipt.id)).json();assert.equal(alternateRestored.language,'Filipino');
  const restoredShops=await (await call('/shops')).json();
  assert.ok(restoredShops.every((s:any)=>s.supportedLanguages.includes(s.language)));
  const advertised=restoredShops.find((s:any)=>s.id==='fixture-ph').supportedLanguages as string[];
  const languageDrafts=new Set<string>();
  for(const [index,language] of advertised.entries()){
   const response=await call('/imports','POST',{...payload,requestId:'advertised-language-'+index,target:{...payload.target,language}});
   assert.equal(response.status,201);const receipt=await response.json();const result=await settled(receipt.id);
   assert.equal(result.language,language);assert.equal(lastLanguage,language);languageDrafts.add(receipt.draftId);
   assert.equal(runtime.engine.getDraft(owner,receipt.draftId).shop.currency,'PHP');
  }
  const {language:omitted,...targetWithoutLanguage}=payload.target;
  const defaultResponse=await call('/imports','POST',{...payload,requestId:'language-omitted',target:targetWithoutLanguage});assert.equal(defaultResponse.status,201);
  const defaultReceipt=await defaultResponse.json();await settled(defaultReceipt.id);assert.equal(runtime.engine.getDraft(owner,defaultReceipt.draftId).language,'English');
  // 2026-11-19: shop and language may both be omitted; the first authorized connected shop is used and its default language.
  const shopOmitted=await call('/imports','POST',{...payload,requestId:'shop-omitted',target:{publishing:payload.target.publishing}});assert.equal(shopOmitted.status,201);
  const shopOmittedReceipt=await shopOmitted.json();await settled(shopOmittedReceipt.id);const defaultDraft=runtime.engine.getDraft(owner,shopOmittedReceipt.draftId);
  assert.equal(defaultDraft.shop.id,'fixture-ph');assert.equal(defaultDraft.language,'English');assert.equal(shopOmittedReceipt.shopName,'PH fixture');
  assert.equal((await call('/imports','POST',{...payload,requestId:'shop-omitted-bad-language',target:{language:'ไทย',publishing:payload.target.publishing}})).status,400);
  assert.equal(languageDrafts.size,advertised.length);assert.equal(runtime.engine.listTasks(owner).length,0);
  assert.equal((await call('/shops/fixture-ph/requirements')).status,200);
  const requirements=await (await call('/shops/fixture-ph/requirements?categoryId=5')).json();assert.equal(requirements.categoryId,5);assert.equal(requirements.connectionId,'fixture-ph');
  assert.equal((await call('/shops/fixture-ph/requirements?categoryId=abc')).status,400);
  assert.equal((await call('/shops/fixture-ph/requirements','GET',undefined,null)).status,401);
  configure({});assert.equal((await call('/shops/private-shop/requirements')).status,403);
  const publishing={categoryId:5,brandId:0,logistics:[{id:9,enabled:true,shippingFee:0}],variants:[{sku:'BOX-W',price:129,stock:0}],condition:'NEW'};
  const completePayload={...payload,requestId:'complete-publishing',target:{...payload.target,publishing}};
  const completeResponse=await call('/imports','POST',completePayload);assert.equal(completeResponse.status,201);const completeReceipt=await completeResponse.json();await settled(completeReceipt.id);
  const completeDraft=runtime.engine.getDraft(owner,completeReceipt.draftId);assert.equal(completeDraft.variants[0].price,129);assert.equal(completeDraft.logistics[0].shippingFee,0);assert.equal(completeDraft.condition,'NEW');
  assert.equal((await call('/imports','POST',{...completePayload,target:{...completePayload.target,publishing:{...publishing,variants:[{sku:'BOX-W',price:130,stock:0}]}}})).status,409);
  assert.equal((await call('/imports','POST',{...completePayload,requestId:'missing-sku',target:{...payload.target,publishing:{...publishing,variants:[]}}})).status,400);
  await runtime.app.close();runtime=await boot();assert.equal((await (await call('/imports','POST',completePayload)).json()).draftId,completeReceipt.draftId);assert.equal(runtime.engine.getDraft(owner,completeDraft.id).variants[0].price,129);assert.equal(runtime.engine.listTasks(owner).length,0);

  const v2={schemaVersion:2,requestId:'v2-outcome-check',product:payload.product,publishing:{currency:'PHP',variants:payload.target.publishing.variants}};
  const fresh=await call('/imports','POST',v2);assert.equal(fresh.status,201);assert.equal(fresh.headers.get('x-localization-import-outcome'),'created');const v2Receipt=await fresh.json();assert.equal(fresh.headers.get('x-localization-receipt-id'),v2Receipt.id);
  const replay=await call('/imports','POST',v2);assert.equal(replay.status,201);assert.equal(replay.headers.get('x-localization-import-outcome'),'replayed');assert.equal(replay.headers.get('x-localization-receipt-id'),v2Receipt.id);const replayedReceipt=await replay.json();assert.equal(replayedReceipt.createdAt,v2Receipt.createdAt);assert.equal(v2Receipt.outcome,'created');assert.equal(v2Receipt.duplicate,false);assert.equal(replayedReceipt.outcome,'replayed');assert.equal(replayedReceipt.duplicate,true);assert.match(replayedReceipt.message,/返回原接收记录/);

 }finally{await runtime.app.close();if(previousConfig===undefined)delete process.env.LOCALIZATION_INTEGRATIONS_FILE;else process.env.LOCALIZATION_INTEGRATIONS_FILE=previousConfig;rmSync(dir,{recursive:true,force:true});}
});
