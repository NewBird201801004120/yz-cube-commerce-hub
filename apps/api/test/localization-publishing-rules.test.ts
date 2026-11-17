import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {LocalizationPlatform,productPayload,variationPayload} from '../src/localization-platform';
import {LocalizationDraft,validateDraft} from '../src/localization-engine';

const ctx={owner:'operator@example.test',sessionId:'fixture'};
function draft():LocalizationDraft{return {id:randomUUID(),owner:ctx.owner,sourceId:randomUUID(),revision:1,shop:{id:'shop',shopId:'123',shopName:'Fixture',region:'PH',currency:'PHP',language:'English'},language:'English',title:'Storage box',sellingPoints:[],description:'A storage box.',specificationNames:[],variants:[{sku:'BOX',options:[],price:100,stock:0}],weightKg:0.2,dimensionsCm:{length:null,width:null,height:null},categoryId:5,brandId:0,attributes:[],logistics:[{id:9,enabled:true}],images:['https://images.example.com/a.png'],marketConfirmed:false,imagesReviewed:false,createdAt:'',updatedAt:''};}
function fixture(){
 const raw={categories:{category_list:[{category_id:5,display_category_name:'Storage',has_children:false}]},attributes:{list:[{category_id:5,attribute_tree:[]}]},brands:{brand_list:[{brand_id:0,original_brand_name:'NoBrand'}]},logistics:{logistics_channel_list:[{logistics_channel_id:9,logistics_channel_name:'Delivery',enabled:true,fee_type:'FIXED_DEFAULT_PRICE',size_list:[{size_id:1}],weight_limit:{item_max_weight:5}}]},limits:{} as Record<string,unknown>};
 const calls:string[]=[];
 const team={shops:async()=>[{id:'shop',shopId:'123',shopName:'Fixture',region:'PH',status:'CONNECTED'}],localization:async()=>({path:'product',issues:[]}),read:async(_session:string,_id:string,op:string)=>{calls.push(op);switch(op){case 'get_category':return raw.categories;case 'get_attribute_tree':return raw.attributes;case 'get_brand_list':return raw.brands;case 'get_channel_list':return raw.logistics;case 'get_item_limit':return raw.limits;default:throw Error('unexpected read '+op);}}};
 return {p:new LocalizationPlatform(team as never),raw,calls};
}

test('requirements retains raw target rules instead of losing conditional logistics metadata',async()=>{
 const f=fixture();f.raw.limits.gtin_validation_rule='Flexible';f.raw.logistics.logistics_channel_list[0].fee_type='SIZE_SELECTION';
 const r=await f.p.requirements(ctx,'shop',5);
 assert.equal(r.connectionId,'shop');assert.equal(r.categoryId,5);
 assert.deepEqual(r.rules,{attributes:f.raw.attributes,brands:f.raw.brands,logistics:f.raw.logistics,limits:f.raw.limits});
 assert.ok(r.support.unsupportedFeatures.includes('global_product'));
 assert.ok(f.calls.includes('get_attribute_tree'));
});

test('target logistics fee type requires size or fee only when applicable',async()=>{
 const f=fixture(),d=draft(),channel=f.raw.logistics.logistics_channel_list[0];
 assert.deepEqual(await f.p.validateMarket(ctx,'shop',d),[]);
 channel.fee_type='SIZE_SELECTION';assert.ok((await f.p.validateMarket(ctx,'shop',d)).some(x=>x.includes('sizeId')));
 d.logistics[0].sizeId=1;assert.deepEqual(await f.p.validateMarket(ctx,'shop',d),[]);
 d.logistics[0].sizeId=99;assert.ok((await f.p.validateMarket(ctx,'shop',d)).some(x=>x.includes('不属于目标渠道')));
 delete d.logistics[0].sizeId;channel.fee_type='CUSTOM_PRICE';assert.ok((await f.p.validateMarket(ctx,'shop',d)).some(x=>x.includes('shippingFee')));
 d.logistics[0].shippingFee=0;assert.deepEqual(await f.p.validateMarket(ctx,'shop',d),[]);
});

test('GTIN Mandatory and Flexible rules preserve the distinction between valid identity and explicit no-GTIN',async()=>{
 const f=fixture(),d=draft();f.raw.limits.gtin_validation_rule='Mandatory';
 assert.ok((await f.p.validateMarket(ctx,'shop',d)).some(x=>x.includes('GTIN')));
 d.variants[0].gtinCode='00';assert.ok((await f.p.validateMarket(ctx,'shop',d)).some(x=>x.includes('GTIN')));
 d.variants[0].gtinCode='4006381333931';assert.deepEqual(await f.p.validateMarket(ctx,'shop',d),[]);
 f.raw.limits.gtin_validation_rule='MANDATORY';delete d.variants[0].gtinCode;assert.ok((await f.p.validateMarket(ctx,'shop',d)).some(x=>x.includes('GTIN')));d.variants[0].gtinCode='1';assert.ok((await f.p.validateMarket(ctx,'shop',d)).some(x=>x.includes('GTIN')));
 f.raw.limits.gtin_validation_rule='Flexible';delete d.variants[0].gtinCode;assert.ok((await f.p.validateMarket(ctx,'shop',d)).some(x=>x.includes('GTIN')));
 d.variants[0].gtinCode='00';assert.deepEqual(await f.p.validateMarket(ctx,'shop',d),[]);
 f.raw.limits.gtin_validation_rule='Optional';delete d.variants[0].gtinCode;assert.deepEqual(await f.p.validateMarket(ctx,'shop',d),[]);
});

test('preorder needs explicit shipping days; middleware review flags and omitted dimensions are not Shopee missing fields',async()=>{
 const f=fixture(),d=draft();assert.deepEqual(validateDraft(d),[]);
 assert.equal(Object.hasOwn(productPayload(d,'LOC-'+randomUUID(),['image-id']),'dimension'),false);
 d.dimensionsCm.length=20;assert.ok(validateDraft(d).some(x=>x.includes('完整')));
 d.dimensionsCm={length:20,width:10,height:5};assert.deepEqual(productPayload(d,'LOC-'+randomUUID(),['image-id']).dimension,{package_length:20,package_width:10,package_height:5});
 d.preOrder={isPreOrder:true};assert.ok((await f.p.validateMarket(ctx,'shop',d)).some(x=>x.includes('daysToShip')));
 d.preOrder.daysToShip=7;f.raw.limits.dts_limit={pre_order_days_to_ship_min:7,pre_order_days_to_ship_max:15};assert.deepEqual(await f.p.validateMarket(ctx,'shop',d),[]);
});

test('publish payload retains final price, stock warehouse, GTIN, attribute unit, condition and conditional logistics',()=>{
 const d=draft();d.brandName='NoBrand';d.condition='USED';d.preOrder={isPreOrder:true,daysToShip:7};
 d.variants[0]={...d.variants[0],gtinCode:'4006381333931',locationId:'PHZ'};
 d.attributes=[{id:7,values:[{id:0,value:'20',unit:'cm'}]}];d.logistics=[{id:9,enabled:true,sizeId:1,shippingFee:0,isFree:true},{id:10,enabled:false}];
 const p=productPayload(d,'LOC-'+randomUUID(),['image-id']);
 assert.equal(p.original_price,100);assert.deepEqual(p.seller_stock,[{stock:0,location_id:'PHZ'}]);assert.equal(p.gtin_code,'4006381333931');
 assert.deepEqual(p.attribute_list,[{attribute_id:7,attribute_value_list:[{value_id:0,original_value_name:'20',value_unit:'cm'}]}]);
 assert.deepEqual(p.logistic_info,[{logistic_id:9,enabled:true,size_id:1,shipping_fee:0,is_free:true}]);
 assert.equal(p.condition,'USED');assert.deepEqual(p.pre_order,{is_pre_order:true,days_to_ship:7});assert.equal(p.item_status,'UNLIST');
 d.specificationNames=['Color'];d.variants[0].options=['White'];const v=variationPayload(d,123);
 assert.deepEqual(v.model[0].seller_stock,[{stock:0,location_id:'PHZ'}]);assert.equal(v.model[0].gtin_code,'4006381333931');assert.equal(v.model[0].original_price,100);
});

test('live PH rule shape makes dimensions and weight mandatory only when explicitly returned',async()=>{const f=fixture(),d=draft();d.weightKg=null;f.raw.logistics.logistics_channel_list[0].weight_limit.item_max_weight=0;assert.deepEqual(validateDraft(d),[]);assert.deepEqual(await f.p.validateMarket(ctx,'shop',d),[]);f.raw.limits.weight_limit={weight_mandatory:true};f.raw.limits.dimension_limit={dimension_mandatory:true};const issues=await f.p.validateMarket(ctx,'shop',d);assert.ok(issues.some(x=>x.includes('weightKg')));assert.ok(issues.some(x=>x.includes('dimensionsCm')));d.weightKg=.2;d.dimensionsCm={length:20,width:10,height:5};assert.deepEqual(await f.p.validateMarket(ctx,'shop',d),[]);});
