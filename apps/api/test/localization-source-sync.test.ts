import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LocalizationService} from '../src/localization';
import {LocalizationEngine} from '../src/localization-engine';

test('central source sync retains market research, original timestamps, owner and existing local edits',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localization-sync-')),e=new LocalizationEngine(dir);
 const source=new LocalizationEngine(join(dir,'remote')).importSource('remote',{schemaVersion:1,sourceSystem:'fastmoss-selection',sourceProductId:'p',title:'Research product',description:'',parameters:{},images:[],specificationNames:[],variants:[{sku:'s',options:[]}]});
 source.createdAt='2026-11-18T10:00:00.000Z';let reads=0;const service=Object.create(LocalizationService.prototype) as LocalizationService;
 Object.assign(service,{engine:e,sourceSync:new Map(),team:{reviewRead:async(session:string,path:string)=>{assert.equal(session,'session');assert.equal(path,'/sources');reads++;return [source];}}});
 try{
  const [a,b]=await Promise.all([service.sources({owner:'local',sessionId:'session'}),service.sources({owner:'local',sessionId:'session'})]);assert.equal(reads,1);assert.deepEqual(a,b);assert.equal(a.length,1);assert.equal(a[0].owner,'local');assert.equal(a[0].createdAt,source.createdAt);assert.equal(a[0].sourceSystem,'fastmoss-selection');
  const d=e.createDraft('local',source.id,{id:'ph',shopId:'1',shopName:'Shop',region:'PH',currency:'PHP',language:'English'});e.updateDraft('local',d.id,{title:'Operator edit'},d.revision);
  await service.sources({owner:'local',sessionId:'session'});assert.equal(e.listSources('local').length,1);assert.equal(e.getDraft('local',d.id).title,'Operator edit');assert.equal(e.listSources('stranger').length,0);
  Object.assign(service,{team:{reviewRead:async()=>{throw Error('connection failed');}}});await assert.rejects(service.sources({owner:'local',sessionId:'session'}),/connection failed/);assert.equal(e.listSources('local').length,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('translation uses saved edits and excludes shop provenance identifiers from product facts',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localization-edited-copy-')),engine=new LocalizationEngine(dir);
 const source=engine.importSource('owner',{schemaVersion:1,sourceSystem:'shopee-shop',sourceProductId:'shop:123',title:'Original',description:'Original description',parameters:{'来源店铺ID':'12345',尺寸:'20 cm'},images:[],specificationNames:['Color'],variants:[{sku:'s',options:['White']}]});
 let draft=engine.createDraft('owner',source.id,{id:'target',shopId:'2',shopName:'Target',region:'PH',currency:'PHP',language:'English'});draft=engine.updateDraft('owner',draft.id,{title:'Edited',description:'Edited description',specificationNames:['Finish'],variants:[{sku:'s',options:['Blue'],price:10,stock:2}]},draft.revision);
 const service=Object.create(LocalizationService.prototype) as LocalizationService;
 Object.assign(service,{engine,translating:new Map(),content:{localize:async(facts:any,current:any)=>{assert.equal(facts.title,'Edited');assert.equal(facts.description,'Edited description');assert.deepEqual(facts.specificationNames,['Finish']);assert.deepEqual(facts.variants[0].options,['Blue']);assert.deepEqual(facts.parameters,{尺寸:'20 cm'});return {title:'Translated',variants:current.variants};}},adapt:async()=>({draft:engine.getDraft('owner',draft.id),issues:[]})});
 try{const result=await service.localize({owner:'owner'},draft.id);assert.equal(result.title,'Translated');assert.equal(result.variants[0].price,10);assert.equal(engine.getSource('owner',source.id).title,'Original');}finally{rmSync(dir,{recursive:true,force:true});}
});
