import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePublishingInput,publishingPatch} from '../src/localization-publishing-input';

test('destination publishing data preserves zero stock/free shipping and all SKU prices',()=>{
 const value={categoryId:12,brandId:0,brandName:'No Brand',attributes:[{id:1,values:[{id:0,value:'100',unit:'cm'}]}],logistics:[{id:2,enabled:true,sizeId:3,shippingFee:0,isFree:true}],variants:[{sku:'b',price:2.5,stock:0,locationId:'warehouse-1',gtinCode:'00'},{sku:'a',price:10,stock:3}],condition:'NEW',preOrder:{isPreOrder:true,daysToShip:5}};
 const parsed=parsePublishingInput(value,['a','b']);assert.deepEqual(parsed,value);
 const patch=publishingPatch(parsed);patch.variants![0].stock=9;assert.equal(parsed.variants![0].stock,0);
 assert.deepEqual(parsePublishingInput({},['a']),{});
});

test('destination publishing data requires every SKU exactly once when variants are supplied',()=>{
 const variant={sku:'a',price:1,stock:0};
 for(const variants of [[],[variant],[variant,variant],[variant,{...variant,sku:'foreign'}]])assert.throws(()=>parsePublishingInput({variants},['a','b']));
 for(const change of [{price:0},{price:Infinity},{price:'2'},{stock:-1},{stock:0.5},{locationId:''},{gtinCode:''},{gtinCode:'abc'},{gtinCode:123},{gtinCode:'1'.repeat(33)}])assert.throws(()=>parsePublishingInput({variants:[{...variant,...change}]},['a']));
});

test('destination publishing data rejects unknown fields, duplicate IDs and invalid scalar types',()=>{
 for(const input of [null,[],{unknown:true},{categoryId:0},{brandId:-1},{condition:'new'},{preOrder:{isPreOrder:'true'}},{preOrder:{isPreOrder:true,daysToShip:0}},{attributes:[{id:1,values:[{value:''}]}]},{attributes:[{id:1,values:[]},{id:1,values:[]}]},{attributes:[{id:1,values:[{id:2,value:'a'},{id:2,value:'b'}]}]},{logistics:[{id:1,enabled:true},{id:1,enabled:false}]},{logistics:[{id:1,enabled:true,shippingFee:-1}]},{logistics:[{id:1,enabled:true,unknown:1}]},{variants:[{sku:'a',price:1,stock:0,options:[]}]}])assert.throws(()=>parsePublishingInput(input,['a']));
});

test('brand names and attribute units preserve supplied facts and reject empty or oversized text',()=>{
 for(const brandName of ['', ' '.repeat(3), 'x'.repeat(201),12])assert.throws(()=>parsePublishingInput({brandName},['a']));
 for(const unit of ['', ' '.repeat(3), 'x'.repeat(51),12])assert.throws(()=>parsePublishingInput({attributes:[{id:1,values:[{value:'12',unit}]}]},['a']));
 const data=parsePublishingInput({variants:[{sku:'a',price:12,stock:0}]},['a']);
 assert.equal(Object.hasOwn(data.variants![0],'gtinCode'),false);
 assert.equal(Object.hasOwn(data,'brandName'),false);
});
