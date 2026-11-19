import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {LocalizationContent} from '../src/localization-content';
import {LocalizationEngine} from '../src/localization-engine';
import {encrypt} from '../src/crypto';
import {ListingService} from '../src/listing';
test('content adapter uses saved text configuration, preserves factual numbers and SKU identity, rejects malformed output',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localization-content-'));process.env.LOCALIZATION_DATA_DIR=join(dir,'data');const listingDir=join(dir,'listing');mkdirSync(listingDir);const e=new LocalizationEngine(join(dir,'engine'));const s=e.importSource('owner',{schemaVersion:1,sourceSystem:'fixture',sourceProductId:'1',title:'收纳盒',description:'白色，20 cm',images:[],parameters:{颜色:'白色',长度:'20 cm'},specificationNames:['颜色'],variants:[{sku:'WHITE',options:['白色'],stock:3}]});const d=e.createDraft('owner',s.id,{id:'fixture',shopId:'1',shopName:'fixture',region:'PH',currency:'PHP',language:'English'});d.sellingPoints=['Verified existing benefit'];let calls=0,output:unknown={title:'Storage box',sellingPoints:['White'],description:'White storage box, 20 cm.',specificationNames:['Color'],variantOptions:[['White']]};
 const adapter=new LocalizationContent({dir:listingDir} as ListingService,async(config,path,body)=>{calls++;assert.equal(config.model,'text-fixture');assert.equal(path,'/chat/completions');assert.ok(String(body).includes('20 cm'));assert.ok(String(body).includes('Verified existing benefit'));return {choices:[{message:{content:JSON.stringify(output)}}]};});
 try{await assert.rejects(()=>adapter.localize(s,d));assert.equal(calls,0);const key=randomBytes(32);writeFileSync(join(listingDir,'encryption.key'),key,{mode:0o600});writeFileSync(join(listingDir,'config.enc'),encrypt(JSON.stringify({planner:{baseUrl:'https://example.com/v1',model:'text-fixture',apiKey:'fixture-private-key'},image:{model:'never-use-image'}}),key),{mode:0o600});const result=await adapter.localize(s,d);assert.equal(result.variants[0].sku,'WHITE');assert.deepEqual(result.variants[0].options,['White']);assert.equal(result.variants[0].stock,3);assert.equal(result.variants[0].price,null);assert.ok(!JSON.stringify(result).includes('fixture-private-key'));
 output={title:'Box',sellingPoints:[],description:'White storage box.',specificationNames:['Color'],variantOptions:[['White']]};await assert.rejects(()=>adapter.localize(s,d),/真实参数/);
 output={title:'Box',sellingPoints:[],description:'White box, 20 mm.',specificationNames:['Color'],variantOptions:[['White']]};await assert.rejects(()=>adapter.localize(s,d),/真实参数/);
 output={title:'Box',description:'20 cm',sellingPoints:[],specificationNames:['Color'],variantOptions:[]};await assert.rejects(()=>adapter.localize(s,d),/不完整/);
 }finally{rmSync(dir,{recursive:true,force:true});delete process.env.LOCALIZATION_DATA_DIR;}
});
test('authenticated image adapter copies only completed owned Listing slots and isolates asset ownership',()=>{
 const dir=mkdtempSync(join(tmpdir(),'localization-images-'));process.env.LOCALIZATION_DATA_DIR=dir;const image=join(dir,'input.png');writeFileSync(image,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5XkAAAAASUVORK5CYII=','base64'));
 const listing={dir,get:(_id:string,owner:string)=>{if(owner!=='owner')throw Error('not owned');return {slots:[{id:'done',file:'image.png',status:'success'},{id:'pending',status:'generating'}]};},image:()=>image};const adapter=new LocalizationContent(listing as unknown as ListingService);
 try{const refs=adapter.attach('owner','job',['done']);assert.equal(refs.length,1);const id=refs[0].split('/').pop()!;assert.equal(adapter.asset('owner',id).mime,'image/png');assert.throws(()=>adapter.asset('other',id));assert.throws(()=>adapter.attach('owner','job',['pending']));assert.throws(()=>adapter.attach('other','job',['done']));assert.throws(()=>adapter.asset('owner','../../input'));}finally{rmSync(dir,{recursive:true,force:true});delete process.env.LOCALIZATION_DATA_DIR;}
});

test('localization translates structured detail text and keeps image associations and pixels unchanged',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localization-detail-text-')),listingDir=join(dir,'listing');process.env.LOCALIZATION_DATA_DIR=dir;mkdirSync(listingDir);const key=randomBytes(32);writeFileSync(join(listingDir,'encryption.key'),key);writeFileSync(join(listingDir,'config.enc'),encrypt(JSON.stringify({planner:{baseUrl:'https://example.com/v1',model:'fixture',apiKey:'fixture-secret'}}),key));const engine=new LocalizationEngine(join(dir,'engine'));
 const source=engine.importSource('owner',{schemaVersion:1,sourceSystem:'fixture',sourceProductId:'media',title:'收纳盒',description:'20 cm',images:[],parameters:{长度:'20 cm'},specificationNames:[],variants:[{sku:'BOX',options:[]}],media:{assets:[{id:'a',url:'https://example.com/a.png',role:'detail',textInImage:'present',sourceLanguage:'中文'}],variantImages:[],detailBlocks:[{type:'text',text:'长度 20 cm'},{type:'image',assetId:'a'}]}}),d=engine.createDraft('owner',source.id,{id:'shop',shopId:'1',shopName:'Shop',region:'PH',currency:'PHP',language:'English'});let detail='Length 20 cm';
 const adapter=new LocalizationContent({dir:listingDir} as ListingService,async()=>({choices:[{message:{content:JSON.stringify({title:'Box',sellingPoints:[],description:'Length 20 cm',specificationNames:[],variantOptions:[[]],detailTexts:[detail]})}}]}));
 try{const result=await adapter.localize(source,d);assert.deepEqual(result.media?.detailBlocks,[{type:'text',text:'Length 20 cm'},{type:'image',assetId:'a'}]);assert.deepEqual(result.media?.assets,source.media?.assets);assert.equal(source.media?.detailBlocks[0].type==='text'&&source.media.detailBlocks[0].text,'长度 20 cm');detail='Length 20 mm';await assert.rejects(()=>adapter.localize(source,d),/真实参数/);}finally{rmSync(dir,{recursive:true,force:true});delete process.env.LOCALIZATION_DATA_DIR;}
});

test('category matching uses product facts without source category and rejects uncertain or invented targets',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localization-category-')),previous=process.env.LOCALIZATION_DATA_DIR;process.env.LOCALIZATION_DATA_DIR=join(dir,'assets');
 const key=randomBytes(32);writeFileSync(join(dir,'encryption.key'),key);writeFileSync(join(dir,'config.enc'),encrypt(JSON.stringify({planner:{baseUrl:'https://example.com/v1',model:'fixture',apiKey:'fixture'}}),key));
 const engine=new LocalizationEngine(join(dir,'engine')),source=engine.importSource('owner',{schemaVersion:1,sourceSystem:'fixture',sourceProductId:'category',title:'厨房铲具',description:'',images:[],parameters:{},specificationNames:[],variants:[{sku:'A',options:[]}]});
 let calls=0,choice:number|null=2,confidence=.95;const adapter=new LocalizationContent({dir} as ListingService,async()=>{calls++;return {choices:[{message:{content:JSON.stringify({categoryId:choice,confidence})}}]};});
 const categories=[{id:1,name:'Home',hasChildren:true},{id:2,parentId:1,name:'Utensils',hasChildren:false}];
 try{
  assert.equal((await adapter.matchCategory(source,categories))?.id,2);assert.equal(calls,1);
  assert.equal((await adapter.matchCategory({...source,parameters:{类目:'Home > Utensils'}},categories))?.id,2);assert.equal(calls,1);
  const translated={...source,parameters:{类目:'家居 > 厨房铲具'}};assert.equal((await adapter.matchCategory(translated,categories))?.id,2);assert.equal(calls,2);
  confidence=.5;assert.equal(await adapter.matchCategory(translated,categories),null);confidence=.95;
  choice=1;assert.equal(await adapter.matchCategory(translated,categories),null);
  choice=999;assert.equal(await adapter.matchCategory(translated,categories),null);
  choice=null;assert.equal(await adapter.matchCategory(translated,categories),null);
 }finally{rmSync(dir,{recursive:true,force:true});if(previous===undefined)delete process.env.LOCALIZATION_DATA_DIR;else process.env.LOCALIZATION_DATA_DIR=previous;}
});

test('translated title fitting preserves language context, enforces limits and skips valid titles',async()=>{const dir=mkdtempSync(join(tmpdir(),'localization-title-'));const listingDir=join(dir,'listing');mkdirSync(listingDir);const key=randomBytes(32);writeFileSync(join(listingDir,'encryption.key'),key);writeFileSync(join(listingDir,'config.enc'),encrypt(JSON.stringify({planner:{baseUrl:'https://example.com/v1',model:'text-fixture',apiKey:'fixture'}}),key));let calls=0,output='TWS Wireless Earphones';const adapter=new LocalizationContent({dir:listingDir} as ListingService,async(_config,_path,body)=>{calls++;assert.ok(String(body).includes('Filipino'));return {choices:[{message:{content:JSON.stringify({title:output})}}]};});const d={title:'T'.repeat(102),description:'Known original product facts',language:'Filipino'} as any;try{assert.equal(await adapter.fitTitle(d,{min_limit:20,max_limit:100}),output);assert.equal(calls,1);assert.equal(d.title.length,102);output='T'.repeat(101);await assert.rejects(()=>adapter.fitTitle(d,{max_limit:100}),/字数限制/);d.title='Valid title';assert.equal(await adapter.fitTitle(d,{max_limit:100}),'Valid title');assert.equal(calls,2);}finally{rmSync(dir,{recursive:true,force:true});}});
