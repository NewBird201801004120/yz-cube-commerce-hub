import {BadRequestException} from '@nestjs/common';

/** Destination-shop values; these must never be interpreted as source-market IDs. */
export type PublishingInput={
 categoryId?:number;
 brandId?:number;
 brandName?:string;
 attributes?:{id:number;values:{id?:number;value:string;unit?:string}[]}[];
 logistics?:{id:number;enabled:boolean;sizeId?:number;shippingFee?:number;isFree?:boolean}[];
 variants?:{sku:string;price:number;stock:number;locationId?:string;gtinCode?:string}[];
 condition?:'NEW'|'USED';
 preOrder?:{isPreOrder:boolean;daysToShip?:number};
};

const fail=(field:string):never=>{throw new BadRequestException(`目标市场发布资料格式无效：${field}`);};
function object(raw:unknown,allowed:string[],field:string):Record<string,unknown>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return fail(field);
 if(Object.keys(raw).some(k=>!allowed.includes(k)))return fail(`${field} 包含不支持的字段`);
 return raw as Record<string,unknown>;
}
function integer(raw:unknown,min:number,field:string):number{if(typeof raw!=='number'||!Number.isSafeInteger(raw)||raw<min)return fail(field);return raw;}
function amount(raw:unknown,min:number,inclusive:boolean,field:string):number{if(typeof raw!=='number'||!Number.isFinite(raw)||(inclusive?raw<min:raw<=min))return fail(field);return raw;}
function text(raw:unknown,max:number,field:string):string{if(typeof raw!=='string'||!raw.trim()||raw.length>max)return fail(field);return raw;}
function boolean(raw:unknown,field:string):boolean{if(typeof raw!=='boolean')return fail(field);return raw;}
function array(raw:unknown,max:number,field:string):unknown[]{if(!Array.isArray(raw)||raw.length>max)return fail(field);return raw;}
function unique(values:(string|number)[],field:string){if(new Set(values).size!==values.length)fail(`${field} 不得重复`);}

/** Structural validation only. Destination category/channel rules are checked separately. */
export function parsePublishingInput(raw:unknown,skus:readonly string[]):PublishingInput{
 const p=object(raw,['categoryId','brandId','brandName','attributes','logistics','variants','condition','preOrder'],'publishing');
 const result:PublishingInput={};
 if(p.categoryId!==undefined)result.categoryId=integer(p.categoryId,1,'categoryId');
 if(p.brandId!==undefined)result.brandId=integer(p.brandId,0,'brandId');
 if(p.brandName!==undefined)result.brandName=text(p.brandName,200,'brandName');
 if(p.attributes!==undefined){
  result.attributes=array(p.attributes,100,'attributes').map(raw=>{
   const a=object(raw,['id','values'],'attributes[]');
   const values=array(a.values,100,'attributes[].values').map(raw=>{
    const v=object(raw,['id','value','unit'],'attributes[].values[]');
    return {...(v.id===undefined?{}:{id:integer(v.id,0,'attributes[].values[].id')}),value:text(v.value,1000,'attributes[].values[].value'),...(v.unit===undefined?{}:{unit:text(v.unit,50,'attributes[].values[].unit')})};
   });
   unique(values.filter(v=>v.id!==undefined).map(v=>v.id!),'attributes[].values[].id');
   unique(values.map(v=>v.value),'attributes[].values[].value');
   return {id:integer(a.id,1,'attributes[].id'),values};
  });
  unique(result.attributes.map(a=>a.id),'attributes[].id');
 }
 if(p.logistics!==undefined){
  result.logistics=array(p.logistics,100,'logistics').map(raw=>{
   const l=object(raw,['id','enabled','sizeId','shippingFee','isFree'],'logistics[]');
   return {id:integer(l.id,1,'logistics[].id'),enabled:boolean(l.enabled,'logistics[].enabled'),
    ...(l.sizeId===undefined?{}:{sizeId:integer(l.sizeId,1,'logistics[].sizeId')}),
    ...(l.shippingFee===undefined?{}:{shippingFee:amount(l.shippingFee,0,true,'logistics[].shippingFee')}),
    ...(l.isFree===undefined?{}:{isFree:boolean(l.isFree,'logistics[].isFree')})};
  });
  unique(result.logistics.map(l=>l.id),'logistics[].id');
 }
 if(p.variants!==undefined){
  result.variants=array(p.variants,100,'variants').map(raw=>{
   const v=object(raw,['sku','price','stock','locationId','gtinCode'],'variants[]');
   if(v.gtinCode!==undefined&&(typeof v.gtinCode!=='string'||!/^\d{1,32}$/.test(v.gtinCode)))fail('variants[].gtinCode');
   return {sku:text(v.sku,100,'variants[].sku'),price:amount(v.price,0,false,'variants[].price'),stock:integer(v.stock,0,'variants[].stock'),
    ...(v.locationId===undefined?{}:{locationId:text(v.locationId,100,'variants[].locationId')}),...(v.gtinCode===undefined?{}:{gtinCode:text(v.gtinCode,32,'variants[].gtinCode')})};
  });
  unique(result.variants.map(v=>v.sku),'variants[].sku');
  if(result.variants.length!==skus.length||result.variants.some(v=>!skus.includes(v.sku)))fail('variants 必须完整对应来源商品的全部 SKU');
 }
 if(p.condition!==undefined){if(p.condition!=='NEW'&&p.condition!=='USED')return fail('condition');result.condition=p.condition;}
 if(p.preOrder!==undefined){
  const value=object(p.preOrder,['isPreOrder','daysToShip'],'preOrder');
  result.preOrder={isPreOrder:boolean(value.isPreOrder,'preOrder.isPreOrder'),...(value.daysToShip===undefined?{}:{daysToShip:integer(value.daysToShip,1,'preOrder.daysToShip')})};
 }
 return result;
}

/** Fresh values for a new destination draft; caller merges variants with source options. */
export function publishingPatch(p:PublishingInput):PublishingInput{return structuredClone(p);}
