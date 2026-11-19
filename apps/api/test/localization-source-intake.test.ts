import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {LocalizationEngine} from '../src/localization-engine';
import {LocalizationIntegrationService,parseImport} from '../src/localization-integration';
import {LocalizationService} from '../src/localization';
import {LocalizationPlatform} from '../src/localization-platform';

const owner='source-intake@fixture.test';
const client={id:'simulation',ownerEmail:owner,tokenSha256:'',sourceSystem:'simulation',allowedShopIds:[],enabled:true};
function payload(){return {schemaVersion:2,requestId:'source-request-1',product:{schemaVersion:1,sourceSystem:'simulation',sourceProductId:'source-1',title:'收纳盒',description:'20厘米收纳盒',images:['https://example.com/source.jpg'],parameters:{长度:'20cm'},specificationNames:['颜色'],variants:[{sku:'W',options:['白色']},{sku:'B',options:['蓝色']}],weightKg:0.3,dimensionsCm:{length:20,width:10,height:5}},publishing:{currency:'PHP',variants:[{sku:'W',price:99,stock:1},{sku:'B',price:109,stock:0}],marketPrices:[{currency:'THB',variants:[{sku:'W',price:69,stock:2},{sku:'B',price:79,stock:3}]}]}};}
const ph={id:'ph',shopId:'100',shopName:'PH',region:'PH',currency:'PHP',language:'English'};
const th={id:'th',shopId:'200',shopName:'TH',region:'TH',currency:'THB',language:'ไทย'};

test('source-only requests persist without AI or drafts, preserve replay and isolate target purposes/languages/prices',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localization-source-intake-'));let aiCalls=0,shopReads=0;
 const boot=()=>{const engine=new LocalizationEngine(dir);const service={engine,content:{localize:async()=>{aiCalls++;throw Error('must not run');}}} as unknown as LocalizationService;const platform={shops:async()=>{shopReads++;return [];}} as unknown as LocalizationPlatform;return {engine,integration:new LocalizationIntegrationService(service,platform)};};
 try{
  let {engine,integration}=boot();
  const request=payload(),receipts=await Promise.all(Array.from({length:5},()=>integration.accept(client,request)));
  assert.equal(new Set(receipts.map(r=>r.id)).size,1);const receipt=receipts[0];
  assert.equal(receipt.status,'received');assert.equal(receipt.draftId,'');assert.equal(engine.listDrafts(owner).length,0);assert.equal(engine.listTasks(owner).length,0);assert.equal(aiCalls,0);assert.equal(shopReads,0);
  assert.equal(engine.listSources(owner).length,1);assert.equal(integration.listForOwner('other@fixture.test').records.length,0);
  assert.throws(()=>integration.get({...client,id:'other'},receipt.id),/不存在/);
  await assert.rejects(integration.accept(client,{...request,product:{...request.product,title:'changed'}}),/requestId/);
  await assert.rejects(integration.accept({...client,sourceSystem:'other'},request),/授权范围/);
  assert.throws(()=>integration.retry(client,receipt.id),/选择目标店铺/);
  const source=integration.sourceForOwner(owner,receipt.id);assert.equal(source.publishing!.currency,'PHP');
  const original=engine.createDraft(owner,source.id,ph,'English','original');
  const english=engine.createDraft(owner,source.id,ph,'English','localized');
  const filipino=engine.createDraft(owner,source.id,ph,'Filipino','localized');
  const thai=engine.createDraft(owner,source.id,th,'ไทย','localized');
  assert.equal(new Set([original.id,english.id,filipino.id,thai.id]).size,4);
  assert.equal(engine.createDraft(owner,source.id,ph,'English','localized').id,english.id);
  assert.deepEqual(original.variants.map(v=>[v.price,v.stock]),[[99,1],[109,0]]);
  assert.deepEqual(thai.variants.map(v=>[v.price,v.stock]),[[69,2],[79,3]]);
  const taskIds=[randomUUID(),randomUUID()];
  for(const [index,id] of taskIds.entries())writeFileSync(join(dir,'tasks',id+'.json'),JSON.stringify({id,owner,draftId:[original.id,thai.id][index],status:'succeeded',stage:'发布完成',remoteId:'remote-'+index,createdAt:new Date().toISOString()}));
  const foreignTask=randomUUID();writeFileSync(join(dir,'tasks',foreignTask+'.json'),JSON.stringify({id:foreignTask,owner:'other@fixture.test',draftId:original.id,status:'succeeded',stage:'secret',createdAt:new Date().toISOString()}));
  const results=integration.get(client,receipt.id).publishTasks;assert.deepEqual(new Set(results.map(t=>t.id)),new Set(taskIds));assert.equal(JSON.stringify(results).includes('other@fixture.test'),false);assert.ok(results.every(t=>!('owner' in t)));
  assert.equal(original.title,'收纳盒');assert.deepEqual(original.images,request.product.images);
  engine.updateDraft(owner,english.id,{title:'Translated English'},english.revision);
  assert.equal(engine.getDraft(owner,original.id).title,'收纳盒');assert.equal(engine.getDraft(owner,thai.id).title,'收纳盒');
  const cross=engine.createDraft(owner,source.id,{...ph,id:'sg',currency:'SGD'});assert.ok(cross.variants.every(v=>v.price===null));assert.deepEqual(cross.variants.map(v=>v.stock),[1,0]);assert.equal(engine.createDraft(owner,source.id,{...ph,id:'sg',currency:'SGD'}).id,cross.id);
  assert.throws(()=>engine.createDraft(owner,source.id,ph,'ไทย'),/语言/);
  ({engine,integration}=boot());assert.equal(integration.get(client,receipt.id).status,'received');assert.equal(engine.listSources(owner).length,1);assert.equal(engine.createDraft(owner,source.id,ph,'English','localized').id,english.id);assert.equal(engine.getDraft(owner,english.id).title,'Translated English');assert.equal(aiCalls,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('source-only intake rejects missing facts and foreign-market IDs before any writes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localization-source-invalid-'));const engine=new LocalizationEngine(dir),integration=new LocalizationIntegrationService({engine} as LocalizationService,{} as LocalizationPlatform);
 try{
  const mutations:((v:any)=>void)[]=[v=>delete v.publishing,v=>delete v.publishing.currency,v=>delete v.publishing.variants[0].price,v=>delete v.publishing.variants[0].stock,v=>delete v.product.dimensionsCm.height,v=>v.publishing.variants.pop(),v=>v.publishing.marketPrices[0].variants.pop(),v=>v.publishing.marketPrices[0].currency='PHP',v=>v.publishing.categoryId=123,v=>v.publishing.variants[0].locationId='foreign-store',v=>v.target={connectionId:'ph'},v=>v.product.images=[],v=>v.product.description='',v=>v.publishing.marketPrices=[{currency:'THB'}]];
  for(const mutate of mutations){const request=payload();mutate(request);await assert.rejects(integration.accept(client,request));assert.equal(engine.listSources(owner).length,0);assert.equal(engine.listDrafts(owner).length,0);}
  try{const request=payload() as any;delete request.publishing.variants[0].stock;parseImport(request);assert.fail('must reject');}catch(error:any){assert.equal(error.getResponse().fieldErrors[0].field,'publishing.variants[0].stock');}
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('concurrent translations share one AI request and completion marker persists, while published/original versions are protected',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localization-singleflight-'));const engine=new LocalizationEngine(dir);
 try{
  const source=engine.importSource(owner,payload().product);const draft=engine.createDraft(owner,source.id,ph);
  let calls=0,release:()=>void=()=>{};
  const service=Object.create(LocalizationService.prototype) as LocalizationService;
  Object.assign(service,{engine,translating:new Map(),content:{localize:async()=>{calls++;await new Promise<void>(resolve=>{release=resolve;});return {title:draft.title};}},adapt:async(_ctx:unknown,id:string)=>({draft:engine.getDraft(owner,id),issues:[]})});
  const first=service.localize({owner},draft.id),second=service.localize({owner},draft.id);assert.equal(calls,1);release();
  const [one,two]=await Promise.all([first,second]);assert.equal(one.localizedAt,two.localizedAt);assert.ok(one.localizedAt);assert.equal(one.title,draft.title);assert.equal(new LocalizationEngine(dir).getDraft(owner,draft.id).localizedAt,one.localizedAt);
  const original=engine.createDraft(owner,source.id,ph,'English','original');await assert.rejects(service.localize({owner},original.id),/原文/);assert.equal(calls,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('local source review supports older central read routes without copying translated text or changing receipt identity',async()=>{
 const {LocalizationReceiptsController}=await import('../src/localization-receipts');const {NotFoundException}=await import('@nestjs/common');
 const dir=mkdtempSync(join(tmpdir(),'localization-legacy-source-'));const engine=new LocalizationEngine(dir),id=randomUUID();
 try{
  const centralSource={...payload().product,id:randomUUID()},centralDraft={sourceId:centralSource.id,title:'Already translated title',shop:ph,variants:[{sku:'W',price:99,stock:1,options:['White']},{sku:'B',price:109,stock:0,options:['Blue']}]};
  const team={receipts:async()=>({records:[{id,sourceId:centralSource.id,draftId:randomUUID()}]}),reviewRead:async(_session:string,path:string)=>{if(path.includes('/receipts/'))throw new NotFoundException();return path==='/sources'?[centralSource]:centralDraft;}};
  const controller=new LocalizationReceiptsController(undefined,team as any,{engine} as LocalizationService),request={localization:{owner,sessionId:'server-session'}} as any;
  const source=await controller.source(request,id);assert.equal(source.title,centralSource.title);assert.equal(source.variants[0].options[0],'白色');assert.equal(source.publishing!.variants![0].price,99);assert.equal(source.publishing!.currency,'PHP');
  assert.equal((await controller.source(request,id)).id,source.id);assert.equal(engine.listSources(owner).length,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('central authenticated images are copied once, media references stay aligned and local asset ownership is enforced',async()=>{
 const {LocalizationReceiptsController}=await import('../src/localization-receipts');const {LocalizationContent}=await import('../src/localization-content');const {mkdirSync}=await import('node:fs');
 const dir=mkdtempSync(join(tmpdir(),'localization-source-assets-')),engine=new LocalizationEngine(dir),id=randomUUID(),remoteAsset='/api/v1/localization/assets/'+randomUUID();
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCjUAAAAASUVORK5CYII=','base64');
 try{
  mkdirSync(join(dir,'assets'));const content=Object.create(LocalizationContent.prototype) as InstanceType<typeof LocalizationContent>;Object.assign(content,{dir});let imageReads=0;
  const source={...payload().product,id:randomUUID(),images:[remoteAsset,'https://example.com/public.jpg'],media:{assets:[{id:'main',url:remoteAsset,role:'gallery',textInImage:'unknown'}],variantImages:[],detailBlocks:[]},publishing:payload().publishing};
  const team={reviewRead:async(session:string,path:string,binary=false)=>{assert.equal(session,'owner-session');if(binary){assert.equal(path,remoteAsset.replace('/api/v1/localization',''));imageReads++;return bytes;}return structuredClone(source);}};
  const controller=new LocalizationReceiptsController(undefined,team as any,{engine,content} as LocalizationService),req={localization:{owner,sessionId:'owner-session'}} as any;
  const [one,two]=await Promise.all([controller.source(req,id),controller.source(req,id)]);assert.equal(imageReads,1);assert.equal(one.id,two.id);assert.notEqual(one.images[0],remoteAsset);assert.equal(one.media!.assets[0].url,one.images[0]);assert.equal(one.images[1],'https://example.com/public.jpg');
  assert.deepEqual(content.asset(owner,one.images[0].split('/').at(-1)!).bytes,bytes);assert.throws(()=>content.asset('other@fixture.test',one.images[0].split('/').at(-1)!),/不存在/);
  assert.equal((await controller.source(req,id)).images[0],one.images[0]);assert.equal(imageReads,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('legacy null price facts remain viewable and explicitly block publication instead of fabricating prices',async()=>{
 const {LocalizationReceiptsController}=await import('../src/localization-receipts');const {NotFoundException}=await import('@nestjs/common');
 const dir=mkdtempSync(join(tmpdir(),'localization-source-incomplete-')),engine=new LocalizationEngine(dir),id=randomUUID();
 try{
  const centralSource={...payload().product,id:randomUUID()},centralDraft={sourceId:centralSource.id,shop:ph,variants:[{sku:'W',price:null,stock:1},{sku:'B',price:null,stock:0}]};
  const team={receipts:async()=>({records:[{id,sourceId:centralSource.id,draftId:randomUUID()}]}),reviewRead:async(_session:string,path:string)=>{if(path.includes('/receipts/'))throw new NotFoundException();return path==='/sources'?[centralSource]:centralDraft;}};
  const controller=new LocalizationReceiptsController(undefined,team as any,{engine} as LocalizationService),req={localization:{owner,sessionId:'fixture'}} as any;
  const source=await controller.source(req,id);assert.equal(source.title,centralSource.title);assert.ok(source.publishingIssue);assert.equal(source.publishing,undefined);
  const draft=engine.createDraft(owner,source.id,ph);assert.ok(draft.variants.every(v=>v.price===null));assert.ok(engine.validate(owner,draft.id).some(issue=>issue.includes('售价')));assert.equal(engine.listTasks(owner).length,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('team request list includes only actual local submissions and routes local review/create without central source reads',async()=>{
 const {LocalizationReceiptsController}=await import('../src/localization-receipts');
 const dir=mkdtempSync(join(tmpdir(),'localization-local-receipts-')),engine=new LocalizationEngine(dir);let aiCalls=0,remoteReads=0;
 try{
  const service=Object.create(LocalizationService.prototype) as LocalizationService;Object.assign(service,{engine,platform:{shops:async()=>[{...ph,status:'CONNECTED'}]},content:{localize:async()=>{aiCalls++;throw Error('must not run');}}});
  const integration=new LocalizationIntegrationService(service,{} as LocalizationPlatform),centralRows:any[]=[{id:randomUUID(),sourceId:randomUUID(),draftId:'',createdAt:'2026-01-01T00:00:00Z',title:'Central source'}];
  const team={managementOrigin:'https://central.example.com',receipts:async()=>({records:centralRows}),reviewRead:async()=>{remoteReads++;throw Error('local receipt must not call central');}};
  const controller=new LocalizationReceiptsController(integration,team as any,service),req={localization:{owner,sessionId:'fixture'}} as any;
  assert.equal((await controller.list(req)).records.length,1);assert.equal(engine.listSources(owner).length,0);
  const receipt=await integration.accept(client,payload()),rows=(await controller.list(req)).records;assert.equal(rows.length,2);assert.equal(rows.find(r=>r.id===receipt.id)?.origin,'local');assert.equal(rows.find(r=>r.id===centralRows[0].id)?.origin,'central');
  const source=await controller.source(req,receipt.id);assert.equal(remoteReads,0);assert.equal(source.id,receipt.sourceId);
  const draft=await service.create({owner},source.id,ph.id,'English','original');assert.equal(draft.variants[0].price,99);assert.equal(draft.purpose,'original');assert.equal(aiCalls,0);assert.equal(remoteReads,0);
  assert.throws(()=>integration.sourceForOwner('other@fixture.test',receipt.id),/不存在/);
  centralRows.push({...receipt,title:'Central wins',createdAt:new Date().toISOString()});const merged=(await controller.list(req)).records;assert.equal(merged.filter(r=>r.id===receipt.id).length,1);assert.equal(merged.find(r=>r.id===receipt.id)?.origin,'central');assert.equal(merged.find(r=>r.id===receipt.id)?.title,'Central wins');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
