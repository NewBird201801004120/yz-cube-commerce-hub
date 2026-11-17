import {BadRequestException} from '@nestjs/common';

export type MediaAsset={id:string;url:string;role:'gallery'|'detail'|'variant';sourceLanguage?:string;textInImage:'unknown'|'none'|'present'};
export type MediaDetailBlock={type:'text';text:string}|{type:'image';assetId:string};
export type LocalizationMedia={assets:MediaAsset[];variantImages:{sku:string;assetId:string}[];detailBlocks:MediaDetailBlock[]};
export type MediaReferences={gallery:string[];variants:{sku:string;url:string}[];details:({type:'text';text:string}|{type:'image';url:string})[]};
const fail=(message:string):never=>{throw new BadRequestException(message);};
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
function object(v:unknown,allowed:string[]):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))return fail('图片资料包含未知字段或格式无效');return v as Record<string,unknown>;}

/** Source metadata records image facts and associations; it never claims that pixels were translated. */
export function parseMedia(raw:undefined,skus:string[],validUrl:(value:unknown)=>boolean):undefined;
export function parseMedia(raw:unknown,skus:string[],validUrl:(value:unknown)=>boolean):LocalizationMedia|undefined;
export function parseMedia(raw:unknown,skus:string[],validUrl:(value:unknown)=>boolean):LocalizationMedia|undefined{
 if(raw===undefined)return undefined;
 const v=object(raw,['assets','variantImages','detailBlocks']);
 if(!Array.isArray(v.assets)||v.assets.length>30||!Array.isArray(v.variantImages)||v.variantImages.length>100||!Array.isArray(v.detailBlocks)||v.detailBlocks.length>40)fail('图片资料最多30个素材、100个SKU配图和40个详情块');
 const assets=(v.assets as unknown[]).map(value=>{const a=object(value,['id','url','role','sourceLanguage','textInImage']);
  if(!text(a.id,100)||! /^[A-Za-z0-9_-]+$/.test(a.id)||typeof a.url!=='string'||!validUrl(a.url)||typeof a.role!=='string'||!['gallery','detail','variant'].includes(a.role)||typeof a.textInImage!=='string'||!['unknown','none','present'].includes(a.textInImage)||(a.sourceLanguage!==undefined&&!text(a.sourceLanguage,80)))fail('素材编号、地址、用途或图片文字信息无效');
  return {id:a.id as string,url:a.url as string,role:a.role as MediaAsset['role'],textInImage:a.textInImage as MediaAsset['textInImage'],...(a.sourceLanguage===undefined?{}:{sourceLanguage:a.sourceLanguage as string})};
 });
 if(new Set(assets.map(a=>a.id)).size!==assets.length)fail('图片素材编号不能重复');
 if(assets.filter(a=>a.role==='gallery').length>9)fail('商品展示图最多9张');
 const assetIds=new Set(assets.map(a=>a.id)),skuIds=new Set(skus);
 const variantImages=(v.variantImages as unknown[]).map(value=>{const a=object(value,['sku','assetId']);if(!text(a.sku,100)||!skuIds.has(a.sku)||typeof a.assetId!=='string'||!assetIds.has(a.assetId))fail('SKU配图必须引用现有SKU和图片素材');return {sku:a.sku as string,assetId:a.assetId as string};});
 if(new Set(variantImages.map(a=>a.sku)).size!==variantImages.length)fail('每个SKU只能指定一张配图');
 let textLength=0;
 const detailBlocks=(v.detailBlocks as unknown[]).map(value=>{const type=(value as {type?:unknown}|null)?.type;
  if(type==='text'){const b=object(value,['type','text']);if(!text(b.text,20000))fail('详情文字不能为空且最多20000字符');textLength+=(b.text as string).length;return {type:'text' as const,text:b.text as string};}
  if(type==='image'){const b=object(value,['type','assetId']);if(typeof b.assetId!=='string'||!assetIds.has(b.assetId))fail('详情图片必须引用现有图片素材');return {type:'image' as const,assetId:b.assetId as string};}
  return fail('详情块仅支持文字或图片');
 });
 if(textLength>20000)fail('详情文字总长度最多20000字符');
 return structuredClone({assets,variantImages,detailBlocks});
}

/** Legacy gallery URLs remain authoritative; metadata may add detail and variant assets. */
export function mediaIssues(media:LocalizationMedia|undefined,galleryImages:string[]):string[]{
 if(!media)return [];
 return media.assets.some(a=>a.role==='gallery'&&!galleryImages.includes(a.url))?['结构化展示图未包含在商品图片中，请同步图片资料后重新核对']:[];
}
export function mediaWarnings(media:LocalizationMedia|undefined):string[]{
 if(!media)return [];
 const warnings:string[]=[];
 if(media.assets.some(a=>a.textInImage==='present'))warnings.push('部分图片含文字；请核对目标语言，必要时替换图片。文案本地化不会修改图中文字。');
 if(media.assets.some(a=>a.textInImage==='unknown'))warnings.push('部分图片尚未确认是否含文字，请逐张核对。');
 return warnings;
}
/** Unique upload order is stable for persistence and upload checkpoint recovery. */
export function mediaUrls(media:LocalizationMedia|undefined,galleryImages:string[]):string[]{const refs=mediaReferences(media,galleryImages);return [...new Set([...refs.gallery,...refs.details.flatMap(b=>b.type==='image'?[b.url]:[]),...refs.variants.map(v=>v.url)])];}
/** Platform-neutral associations: the publishing adapter decides the final API field shape. */
export function mediaReferences(media:LocalizationMedia|undefined,galleryImages:string[]):MediaReferences{
 if(!media)return {gallery:[...galleryImages],variants:[],details:[]};
 const urls=new Map(media.assets.map(a=>[a.id,a.url]));
 const url=(id:string)=>urls.get(id)??fail('图片引用已失效，请重新核对');
 return {gallery:[...galleryImages],variants:media.variantImages.map(v=>({sku:v.sku,url:url(v.assetId)})),details:media.detailBlocks.map(b=>b.type==='text'?{type:'text',text:b.text}:{type:'image',url:url(b.assetId)})};
}

/** Reads bounded image headers only; this is not a complete decoder or a content-validity check. */
export function imageDimensions(bytes:Buffer):{width:number;height:number}|undefined{
 const dimensions=(width:number,height:number)=>width>0&&height>0?{width,height}:undefined;
 if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
  if(bytes.length<33||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')return undefined;
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  return width<=0x7fffffff&&height<=0x7fffffff?dimensions(width,height):undefined;
 }
 if(bytes.length>=2&&bytes[0]===0xff&&bytes[1]===0xd8){
  let offset=2;
  while(offset<bytes.length){
   if(bytes[offset++]!==0xff)return undefined;
   while(offset<bytes.length&&bytes[offset]===0xff)offset++;
   if(offset>=bytes.length)return undefined;
   const marker=bytes[offset++];
   if(marker===0||marker===0xd8||marker===0xd9||marker===0xda)return undefined;
   if(marker===1||(marker>=0xd0&&marker<=0xd7))continue;
   if(offset+2>bytes.length)return undefined;
   const length=bytes.readUInt16BE(offset);
   if(length<2||offset+length>bytes.length)return undefined;
   if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
    if(length<8)return undefined;
    const components=bytes[offset+7];
    if(!components||length<8+components*3)return undefined;
    return dimensions(bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3));
   }
   offset+=length;
  }
  return undefined;
 }
 if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){
  const end=bytes.readUInt32LE(4)+8;
  if(end>bytes.length||end<20)return undefined;
  for(let offset=12;offset+8<=end;){
   const type=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),start=offset+8,next=start+length+(length%2);
   if(next>end)return undefined;
   if(type==='VP8X')return length>=10?dimensions(bytes.readUIntLE(start+4,3)+1,bytes.readUIntLE(start+7,3)+1):undefined;
   if(type==='VP8L'){
    if(length<5||bytes[start]!==0x2f)return undefined;
    const bits=bytes.readUInt32LE(start+1);
    return bits>>>29===0?dimensions((bits&0x3fff)+1,((bits>>>14)&0x3fff)+1):undefined;
   }
   if(type==='VP8 '){
    if(length<10||(bytes[start]&1)!==0||bytes[start+3]!==0x9d||bytes[start+4]!==1||bytes[start+5]!==0x2a)return undefined;
    return dimensions(bytes.readUInt16LE(start+6)&0x3fff,bytes.readUInt16LE(start+8)&0x3fff);
   }
   offset=next;
  }
 }
 return undefined;
}
