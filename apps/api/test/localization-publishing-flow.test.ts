import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseImport} from '../src/localization-integration';
import {LocalizationEngine,LocalizationShop,validateDraft} from '../src/localization-engine';

const owner='publishing-fixture@example.test';
const sourceId='22222222-2222-5222-a222-222222222222';
const phId='33333333-3333-5333-a333-333333333333';
const sgId='44444444-4444-5444-a444-444444444444';
const ph:LocalizationShop={id:'ph-shop',shopId:'123',shopName:'PH test',region:'PH',currency:'PHP',language:'English'};
const sg:LocalizationShop={id:'sg-shop',shopId:'456',shopName:'SG test',region:'SG',currency:'SGD',language:'English'};
function request(){return {
 schemaVersion:1,requestId:'publishing-flow-test',
 product:{schemaVersion:1,sourceSystem:'simulation',sourceProductId:'fixture-42',title:'Storage box',description:'Width 20 cm',images:['https://cdn.example.com/box.jpg'],parameters:{width:'20 cm'},specificationNames:['Color'],variants:[{sku:'WHITE',options:['White'],stock:100},{sku:'BLUE',options:['Blue'],stock:101}],weightKg:0.25,dimensionsCm:{length:20,width:10,height:5}},
 target:{connectionId:ph.id,country:ph.region,language:'English',publishing:{categoryId:123,brandId:45,brandName:'Fixture Brand',condition:'USED',preOrder:{isPreOrder:true,daysToShip:7},attributes:[{id:67,values:[{id:0,value:'20',unit:'cm'}]}],logistics:[{id:89,enabled:true,sizeId:2,shippingFee:0,isFree:true}],variants:[{sku:'BLUE',price:219.5,stock:0,locationId:'warehouse-ph',gtinCode:'1234567890123'},{sku:'WHITE',price:199,stock:4,locationId:'warehouse-ph',gtinCode:'00'}]}}
};}

test('import parser to persistent draft preserves complete target publishing input without contaminating source',()=>{
 const dir=mkdtempSync(join(tmpdir(),'localization-publishing-flow-'));
 try{
  const input=parseImport(request()),engine=new LocalizationEngine(dir);
  engine.ensureImportedSource(owner,input.product,sourceId);
  const draft=engine.ensureImportedDraft(owner,sourceId,ph,'English',phId,input.target.publishing);
  assert.equal(draft.categoryId,123);assert.equal(draft.brandId,45);assert.equal(draft.brandName,'Fixture Brand');
  assert.equal(draft.condition,'USED');assert.deepEqual(draft.preOrder,{isPreOrder:true,daysToShip:7});
  assert.deepEqual(draft.attributes,[{id:67,values:[{id:0,value:'20',unit:'cm'}]}]);
  assert.deepEqual(draft.logistics,[{id:89,enabled:true,sizeId:2,shippingFee:0,isFree:true}]);
  assert.deepEqual(draft.variants,[{sku:'WHITE',options:['White'],price:199,stock:4,locationId:'warehouse-ph',gtinCode:'00'},{sku:'BLUE',options:['Blue'],price:219.5,stock:0,locationId:'warehouse-ph',gtinCode:'1234567890123'}]);
  const source=engine.getSource(owner,sourceId);
  for(const field of ['categoryId','brandId','brandName','condition','preOrder','attributes','logistics','publishing'])assert.equal(Object.hasOwn(source,field),false,field);
  for(const variant of source.variants)for(const field of ['price','locationId','gtinCode'])assert.equal(Object.hasOwn(variant,field),false,field);
  assert.deepEqual(source.variants,input.product.variants);
  const restarted=new LocalizationEngine(dir);
  assert.deepEqual(restarted.getDraft(owner,phId),draft);
  assert.deepEqual(restarted.getSource(owner,sourceId),source);
  assert.throws(()=>restarted.getDraft('another-owner',phId));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('different markets keep independent final prices and replay never replaces operator edits',()=>{
 const dir=mkdtempSync(join(tmpdir(),'localization-publishing-isolation-'));
 try{
  const first=parseImport(request()),engine=new LocalizationEngine(dir);engine.ensureImportedSource(owner,first.product,sourceId);
  const phDraft=engine.ensureImportedDraft(owner,sourceId,ph,'English',phId,first.target.publishing);
  const second=request();second.target.connectionId=sg.id;second.target.country=sg.region;
  second.target.publishing.variants=second.target.publishing.variants.map(v=>({...v,price:v.price/10,locationId:'warehouse-sg'}));
  const sgInput=parseImport(second),sgDraft=engine.ensureImportedDraft(owner,sourceId,sg,'English',sgId,sgInput.target.publishing);
  assert.equal(phDraft.variants[0].price,199);assert.equal(sgDraft.variants[0].price,19.9);
  const edited=engine.updateDraft(owner,phId,{title:'Operator revised title',variants:phDraft.variants.map(v=>({...v,price:300}))},phDraft.revision);
  const replay=engine.ensureImportedDraft(owner,sourceId,ph,'English',phId,first.target.publishing);
  assert.deepEqual(replay,edited);assert.equal(engine.getDraft(owner,sgId).variants[0].price,19.9);
  assert.equal(engine.getSource(owner,sourceId).title,first.product.title);
  const restarted=new LocalizationEngine(dir);assert.equal(restarted.getDraft(owner,phId).variants[0].price,300);assert.deepEqual(restarted.getDraft(owner,sgId),sgDraft);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('review flags are not platform fields; complete import dimensions coexist with legacy internal draft handling',()=>{
 const dir=mkdtempSync(join(tmpdir(),'localization-publishing-required-'));
 try{
  const input=parseImport(request()),engine=new LocalizationEngine(dir);engine.ensureImportedSource(owner,input.product,sourceId);
  const draft=engine.ensureImportedDraft(owner,sourceId,ph,'English',phId,input.target.publishing);
  assert.equal(draft.marketConfirmed,false);assert.equal(draft.imagesReviewed,false);
  assert.deepEqual(draft.dimensionsCm,{length:20,width:10,height:5});
  assert.deepEqual(validateDraft({...draft,dimensionsCm:{length:null,width:null,height:null}}),[]);
  assert.deepEqual(validateDraft(draft),[]);
  const partial={...draft,dimensionsCm:{length:20,width:null,height:null}};
  assert.ok(validateDraft(partial).some(issue=>issue.includes('长宽高')));
  assert.deepEqual(validateDraft({...draft,dimensionsCm:{length:20,width:10,height:5}}),[]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
