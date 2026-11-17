import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {LocalizationPlatform,productPayload,variationPayload,safePublicAddress} from '../src/localization-platform';
import {LocalizationDraft} from '../src/localization-engine';
import {PlatformWriteError} from '../src/shopee-client';
const draft=(id='shop'):LocalizationDraft=>({id:randomUUID(),owner:'operator@example.test',sourceId:randomUUID(),revision:1,shop:{id,shopId:'123',shopName:'Shop',region:'PH',currency:'PHP',language:'English'},language:'English',title:'Desk organizer',sellingPoints:['Two compartments'],description:'Two compartments',specificationNames:[],variants:[{sku:'ORG-1',options:[],price:299,stock:4}],weightKg:0.5,dimensionsCm:{length:20,width:10,height:8},categoryId:5,brandId:0,attributes:[],logistics:[{id:9,enabled:true}],images:['https://images.example.com/a.png'],marketConfirmed:true,imagesReviewed:true,createdAt:'',updatedAt:''});
function fixture(){const dir=mkdtempSync(join(tmpdir(),'localization-platform-'));process.env.LOCALIZATION_DATA_DIR=dir;let creates=0,listed=0,initializations=0;let failCreate=false,failUnlist=false,failInit=false,itemStatus='UNLIST';const models:any[]=[];
 const service={read:async(_id:string,_actor:string,path:string)=>{switch(path.split('/').pop()){case 'get_shop_info':return {is_cb:false};case 'get_category':return {category_list:[{category_id:5,display_category_name:'Storage',has_children:false}]};case 'get_channel_list':return {logistics_channel_list:[{logistics_channel_id:9,logistics_channel_name:'Delivery',enabled:true}]};case 'get_item_limit':return {item_name_length_limit:{max_limit:100}};case 'get_brand_list':return {brand_list:[{brand_id:0,original_brand_name:'NoBrand'}]};case 'get_attribute_tree':return {list:[{category_id:5,attribute_tree:[]}]};case 'get_item_list':return {item:[],has_next_page:false};case 'get_item_base_info':return {item_list:[{item_id:12345,item_status:itemStatus}]};case 'get_model_list':return {model:models,tier_variation:models.length?[{}]:[]};default:throw Error(path);}},write:async(_id:string,_actor:string,path:string,body:any)=>{if(path.endsWith('add_item')){creates++;if(failCreate)throw new PlatformWriteError(true,'timeout');return {item_id:12345};}if(path.endsWith('init_tier_variation')){initializations++;if(failInit)throw new PlatformWriteError(true,'Fixture timeout',{upstreamCode:'error_server',upstreamRequestId:'1234567890abcdef1234567890abcdef'});models.splice(0,models.length,...body.model.map((m:any)=>({...m,price_info:[{original_price:m.original_price}]})));return {};}if(path.endsWith('unlist_item')){listed++;return failUnlist?{failure_list:[{item_id:12345,error:'denied'}]}:{success_list:[{item_id:12345}]};}throw Error('unexpected write');},audit:async()=>{}};
 const db={shopConnection:{findUnique:async()=>({status:'CONNECTED'}),findMany:async()=>[{id:'shop',region:'PH',shopId:'123',shopName:'Shop',status:'CONNECTED'}]}};
 const p=new LocalizationPlatform(undefined,db as never,service as never),ctx={owner:'operator@example.test',userId:'admin'};
 return {p,ctx,recreate:()=>new LocalizationPlatform(undefined,db as never,service as never),get creates(){return creates;},get listed(){return listed;},get initializations(){return initializations;},models,setItemStatus:(value:string)=>{itemStatus=value;},setInitUncertain:()=>{failInit=true;},setFailCreate:()=>{failCreate=true;},setFailUnlist:()=>{failUnlist=true;},close:()=>{rmSync(dir,{recursive:true,force:true});delete process.env.LOCALIZATION_DATA_DIR;}};
}
test('product payload keeps facts/price and starts unlisted; variation mapping preserves combinations',()=>{const d=draft();const payload=productPayload(d,'LOC-'+randomUUID(),['image-id']);assert.equal(payload.item_status,'UNLIST');assert.equal(payload.original_price,299);assert.equal(payload.weight,0.5);d.specificationNames=['Color','Size'];d.variants=[{sku:'a',options:['Red','S'],price:100,stock:2},{sku:'b',options:['Blue','L'],price:200,stock:3}];const v=variationPayload(d,123);assert.deepEqual(v.model.map(x=>x.tier_index),[[0,0],[1,1]]);assert.deepEqual(v.model.map(x=>x.model_sku),['a','b']);});
test('public image network rejects private, reserved, documentation and loopback addresses',()=>{for(const ip of ['127.0.0.1','10.1.1.1','192.168.0.1','192.0.0.1','198.51.100.1','203.0.113.4','198.18.0.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1'])assert.equal(safePublicAddress(ip),false,ip);assert.equal(safePublicAddress('1.1.1.1'),true);});
test('central creation receipt prevents repeats, tracks ownership and restores across instances',async()=>{const f=fixture();try{const d=draft(),marker='LOC-'+randomUUID(),b={draft:d,marker,prepared:{imageIds:['img']}};assert.deepEqual(await f.p.operation(f.ctx,'shop','create',b),{remoteId:'12345'});assert.deepEqual(await f.p.operation(f.ctx,'shop','create',b),{remoteId:'12345'});assert.equal(f.creates,1);const restarted=f.recreate();assert.deepEqual(await restarted.operation(f.ctx,'shop','create',b),{remoteId:'12345'});assert.equal(f.creates,1);assert.deepEqual(await restarted.operation(f.ctx,'shop','reconcile',{marker}),{status:'found',remoteId:'12345'});await assert.rejects(()=>f.p.operation({...f.ctx,owner:'other'},'shop','complete',{draft:d,marker,remoteId:'12345'}));assert.equal(f.listed,0);await f.p.operation(f.ctx,'shop','complete',{draft:d,marker,remoteId:'12345'});assert.equal(f.listed,1);}finally{f.close();}});
test('central ambiguous create persists lock and reconciliation never authorizes blind recreation',async()=>{const f=fixture();try{f.setFailCreate();const marker='LOC-'+randomUUID(),b={draft:draft(),marker,prepared:{imageIds:['img']}};await assert.rejects(()=>f.p.operation(f.ctx,'shop','create',b));await assert.rejects(()=>f.p.operation(f.ctx,'shop','create',b));assert.equal(f.creates,1);assert.deepEqual(await f.p.operation(f.ctx,'shop','reconcile',{marker}),{status:'unknown'});assert.equal(f.listed,0);}finally{f.close();}});
function variationDraft(){const d=draft();d.specificationNames=['Color','Size'];d.variants=[{sku:'RED-S',options:['Red','S'],price:100,stock:0},{sku:'RED-L',options:['Red','L'],price:110,stock:0},{sku:'BLUE-S',options:['Blue','S'],price:120,stock:0},{sku:'BLUE-L',options:['Blue','L'],price:130,stock:0}];return d;}
test('save_variations preserves UNLIST, initializes four combinations once and isolates ownership',async()=>{
 const f=fixture();try{
  const d=variationDraft(),marker='LOC-'+randomUUID(),body={draft:d,marker,prepared:{imageIds:['img']},remoteId:'12345'};
  await f.p.operation(f.ctx,'shop','create',body);
  await assert.rejects(()=>f.p.operation({...f.ctx,owner:'another'},'shop','save_variations',{...body,draft:{...d,owner:'another'}}),/本工具已创建/);
  assert.deepEqual(await f.p.operation(f.ctx,'shop','save_variations',body),{ok:true,remoteId:'12345',itemStatus:'UNLIST'});
  assert.equal(f.models.length,4);assert.equal(f.initializations,1);assert.equal(f.listed,0);
  assert.deepEqual(await f.recreate().operation(f.ctx,'shop','save_variations',body),{ok:true,remoteId:'12345',itemStatus:'UNLIST'});assert.equal(f.initializations,1);assert.equal(f.listed,0);
 }finally{f.close();}
});
test('save_variations rejects NORMAL items before mutation and concurrent instances cannot initialize twice',async()=>{
 const f=fixture();try{
  const d=variationDraft(),body={draft:d,marker:'LOC-'+randomUUID(),prepared:{imageIds:['img']},remoteId:'12345'};
  await f.p.operation(f.ctx,'shop','create',body);f.setItemStatus('NORMAL');
  await assert.rejects(()=>f.p.operation(f.ctx,'shop','save_variations',body),/禁止修改在售/);assert.equal(f.initializations,0);
  f.setItemStatus('UNLIST');const other=f.recreate();const results=await Promise.allSettled([f.p.operation(f.ctx,'shop','save_variations',body),other.operation(f.ctx,'shop','save_variations',body)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.initializations,1);assert.equal(f.listed,0);
 }finally{f.close();}
});
test('ambiguous variation initialization survives restart and requires readback instead of blind retry',async()=>{
 const f=fixture();try{
  const d=variationDraft(),body={draft:d,marker:'LOC-'+randomUUID(),prepared:{imageIds:['img']},remoteId:'12345'};
  await f.p.operation(f.ctx,'shop','create',body);f.setInitUncertain();
  await assert.rejects(()=>f.p.operation(f.ctx,'shop','save_variations',body),(e:any)=>e instanceof PlatformWriteError&&e.uncertain&&e.diagnostic?.upstreamCode==='error_server');assert.equal(f.initializations,1);
  const restarted=f.recreate();await assert.rejects(()=>restarted.operation(f.ctx,'shop','save_variations',body),/禁止重复初始化/);assert.equal(f.initializations,1);
  const expected=variationPayload(d,12345);f.models.push(...expected.model.map(m=>({...m,price_info:[{original_price:m.original_price}]})));
  assert.deepEqual(await restarted.operation(f.ctx,'shop','save_variations',body),{ok:true,remoteId:'12345',itemStatus:'UNLIST'});assert.equal(f.initializations,1);assert.equal(f.listed,0);
 }finally{f.close();}
});
test('initialized variations must match returned prices and stock without repeating initialization',async()=>{
 const f=fixture();try{
  const d=variationDraft(),body={draft:d,marker:'LOC-'+randomUUID(),prepared:{imageIds:['img']},remoteId:'12345'};
  await f.p.operation(f.ctx,'shop','create',body);await f.p.operation(f.ctx,'shop','save_variations',body);
  f.models[0].price_info[0].original_price=999;
  await assert.rejects(()=>f.p.operation(f.ctx,'shop','save_variations',body),/售价或库存/);
  f.models[0].price_info[0].original_price=100;f.models[0].seller_stock[0].stock=1;
  await assert.rejects(()=>f.p.operation(f.ctx,'shop','save_variations',body),/售价或库存/);
  assert.equal(f.initializations,1);assert.equal(f.listed,0);
 }finally{f.close();}
});
test('explicit complete reuses saved variations and only then invokes listing',async()=>{
 const f=fixture();try{
  const d=variationDraft(),body={draft:d,marker:'LOC-'+randomUUID(),prepared:{imageIds:['img']},remoteId:'12345'};
  await f.p.operation(f.ctx,'shop','create',body);await f.p.operation(f.ctx,'shop','save_variations',body);assert.equal(f.listed,0);
  assert.deepEqual(await f.p.operation(f.ctx,'shop','complete',body),{ok:true});assert.equal(f.initializations,1);assert.equal(f.listed,1);
 }finally{f.close();}
});
test('per-item publish failure stays incomplete rather than reporting success',async()=>{const f=fixture();try{const marker='LOC-'+randomUUID(),d=draft();await f.p.operation(f.ctx,'shop','create',{draft:d,marker,prepared:{imageIds:['img']}});f.setFailUnlist();await assert.rejects(()=>f.p.operation(f.ctx,'shop','complete',{draft:d,marker,remoteId:'12345'}));assert.equal(f.creates,1);}finally{f.close();}});
test('metadata uses UI candidates and checks target-market membership before creating',async()=>{const f=fixture();try{const m=await f.p.metadata(f.ctx,'shop',5);assert.deepEqual(m.categories[0],{id:5,name:'Storage',parentId:undefined,hasChildren:false});assert.equal(m.logistics[0].id,9);const d=draft();d.categoryId=999;const result=await f.p.operation(f.ctx,'shop','create',{draft:d,marker:'LOC-'+randomUUID(),prepared:{imageIds:['img']}});assert.equal(result.rejected,true);assert.equal(f.creates,0);}finally{f.close();}});
test('current attribute-tree list shape maps names, mandatory flags and values for display and market validation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localization-current-attributes-')),previous=process.env.LOCALIZATION_DATA_DIR;process.env.LOCALIZATION_DATA_DIR=dir;
 const reads:{op:string;query:Record<string,string>}[]=[];
 const team={shops:async()=>[{id:'shop',shopId:'123',shopName:'Fixture',region:'PH',status:'CONNECTED'}],localization:async()=>({path:'product',issues:[]}),read:async(_session:string,_id:string,op:string,query:Record<string,string>={})=>{reads.push({op,query});switch(op){
  case 'get_category':return {category_list:[{category_id:5,has_children:false}]};
  case 'get_channel_list':return {logistics_channel_list:[{logistics_channel_id:9,enabled:true}]};
  case 'get_item_limit':return {};
  case 'get_attribute_tree':assert.deepEqual(query,{category_id:'5',language:'en'});return {list:[{category_id:999,attribute_tree:[{attribute_id:99,mandatory:true,name:'Other category'}]},{category_id:5,attribute_tree:[{attribute_id:7,mandatory:true,name:'Material',attribute_value_list:[{value_id:10,name:'Plastic'}],attribute_info:{}}]}]};
  case 'get_brand_list':assert.equal(query.status,'1');return {brand_list:[{brand_id:0,original_brand_name:'NoBrand'}]};
  default:throw Error('unexpected operation '+op);
 }}};
 const p=new LocalizationPlatform(team as never),ctx={owner:'operator@example.test',sessionId:'fixture'};
 try{
  const metadata=await p.metadata(ctx,'shop',5);assert.deepEqual(metadata.attributes,[{id:7,name:'Material',required:true,values:[{id:10,value:'Plastic'}]}]);assert.equal(metadata.brands[0].name,'NoBrand');
  const d=draft();let issues=await p.validateMarket(ctx,'shop',d);assert.ok(issues.includes('请补齐必填属性：Material'));assert.ok(!issues.some(x=>x.includes('Other category')));
  d.attributes=[{id:7,values:[{id:10,value:'Plastic'}]}];assert.deepEqual(await p.validateMarket(ctx,'shop',d),[]);
  d.attributes=[{id:7,values:[{id:11,value:'Unknown'}]}];issues=await p.validateMarket(ctx,'shop',d);assert.ok(issues.includes('属性值不属于目标市场候选'));
  assert.ok(!reads.some(r=>r.op==='get_attributes'));
 }finally{if(previous===undefined)delete process.env.LOCALIZATION_DATA_DIR;else process.env.LOCALIZATION_DATA_DIR=previous;rmSync(dir,{recursive:true,force:true});}
});
test('missing central capability endpoint leaves market candidates readable and publishing blocked',async()=>{const dir=mkdtempSync(join(tmpdir(),'localization-metadata-'));process.env.LOCALIZATION_DATA_DIR=dir;try{const team={shops:async()=>[{id:'shop',shopId:'1',shopName:'Fixture',region:'PH',status:'CONNECTED'}],read:async(_s:string,_id:string,op:string)=>op==='get_category'?{category_list:[{category_id:1,original_category_name:'Fixture'}]}:{},localization:async()=>{throw Error('endpoint unavailable');}};const p=new LocalizationPlatform(team as never);const result=await p.metadata({owner:'a',sessionId:'fixture'},'shop');assert.equal(result.categories[0].id,1);assert.ok(result.capabilities.issues.length);assert.equal(result.capabilities.writePermission,'unverified');}finally{rmSync(dir,{recursive:true,force:true});delete process.env.LOCALIZATION_DATA_DIR;}});
test('target-market price, stock and specification limits block before remote creation',async()=>{const f=fixture();try{const metadata=await f.p.rawMetadata(f.ctx,'shop',5);metadata.limits={price_limit:{min_limit:5,max_limit:100},stock_limit:{max_limit:2},tier_variation_name_length_limit:{max_limit:5},tier_variation_option_length_limit:{max_limit:5}};f.p.rawMetadata=async()=>metadata;const d=draft();d.specificationNames=['Long specification'];d.variants=[{sku:'fixture',options:['Long option'],price:299,stock:4}];const issues=await f.p.validateMarket(f.ctx,'shop',d);assert.ok(issues.some(x=>x.includes('售价')));assert.ok(issues.some(x=>x.includes('库存')));assert.ok(issues.some(x=>x.includes('规格名称')));assert.ok(issues.some(x=>x.includes('规格选项')));assert.equal(f.creates,0);}finally{f.close();}});

test('structured media uploads map gallery separately, preserve detail order and bind first-tier option pictures',()=>{
 const d=draft();d.specificationNames=['Color'];d.variants=[{sku:'RED',options:['Red'],price:100,stock:2},{sku:'BLUE',options:['Blue'],price:100,stock:2}];d.media={assets:[{id:'detail',url:'https://images.example.com/detail.png',role:'detail',textInImage:'present'},{id:'red',url:'https://images.example.com/red.png',role:'variant',textInImage:'none'},{id:'blue',url:'https://images.example.com/blue.png',role:'variant',textInImage:'none'}],variantImages:[{sku:'RED',assetId:'red'},{sku:'BLUE',assetId:'blue'}],detailBlocks:[{type:'text',text:'20 cm organizer'},{type:'image',assetId:'detail'}]};
 const payload=productPayload(d,'LOC-'+randomUUID(),['gallery-id','detail-id','red-id','blue-id']);assert.deepEqual(payload.image.image_id_list,['gallery-id']);assert.equal(payload.description_type,'extended');assert.deepEqual(payload.description_info?.extended_description.field_list.slice(1),[{field_type:'text',text:'20 cm organizer'},{field_type:'image',image_info:{image_id:'detail-id'}}]);
 const variation=variationPayload(d,123,['gallery-id','detail-id','red-id','blue-id']);assert.equal(variation.standardise_tier_variation[0].variation_option_list[0].image_id,'red-id');assert.equal(variation.standardise_tier_variation[0].variation_option_list[1].image_id,'blue-id');assert.throws(()=>productPayload(d,'LOC-'+randomUUID(),['gallery-id']));assert.throws(()=>variationPayload(d,123));
});

test('detail image dimensions block before upload/create and successful detail checkpoints avoid reuploading',async()=>{
 const f=fixture();try{const asset='/api/v1/localization/assets/'+randomUUID(),d=draft();d.images=[asset];d.media={assets:[{id:'detail',url:asset,role:'detail',textInImage:'none'}],variantImages:[],detailBlocks:[{type:'image',assetId:'detail'}]};
 const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(13,8);png.write('IHDR',12);png.writeUInt32BE(0,16);png.writeUInt32BE(0,20);
 const task={id:randomUUID(),owner:d.owner,draftId:d.id,marker:'LOC-'+randomUUID(),draft:d,status:'preparing',stage:'',createdAt:'',updatedAt:''} as any;
 await assert.rejects(()=>f.p.publisher(f.ctx,async()=>png).prepare(d,task),/详情图尺寸/);assert.equal(f.creates,0);
 let uploads=0,loads=0;const team={shops:async()=>[],read:async()=>({extended_description_limit:{description_image_width_min:700,description_image_height_min:32}}),localization:async()=>{uploads++;return {imageId:'uploaded-detail'};}};
 const p=new LocalizationPlatform(team as never);png.writeUInt32BE(800,16);png.writeUInt32BE(600,20);const adapter=p.publisher({owner:'owner',sessionId:'fixture'},async()=>{loads++;return png;});const prepared=await adapter.prepare(d,task);assert.equal(uploads,1);assert.equal(loads,1);await adapter.prepare(d,{...task,prepared});assert.equal(uploads,1);assert.equal(loads,1);
 }finally{f.close();}
});
