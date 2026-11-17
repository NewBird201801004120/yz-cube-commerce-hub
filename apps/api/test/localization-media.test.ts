import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMedia,mediaIssues,mediaWarnings,mediaUrls,mediaReferences,imageDimensions,LocalizationMedia} from '../src/localization-media';

const gallery='https://cdn.example.com/main.jpg',detail='https://cdn.example.com/detail.jpg',variant='https://cdn.example.com/white.jpg';
const validUrl=(value:unknown)=>typeof value==='string'&&value.startsWith('https://cdn.example.com/');
const source=():LocalizationMedia=>({assets:[{id:'main',url:gallery,role:'gallery',sourceLanguage:'中文',textInImage:'present'},{id:'detail',url:detail,role:'detail',textInImage:'unknown'},{id:'white',url:variant,role:'variant',textInImage:'none'}],variantImages:[{sku:'BOX-W',assetId:'white'}],detailBlocks:[{type:'text',text:'A white storage box.'},{type:'image',assetId:'detail'},{type:'text',text:'Width 12 cm.'}]});
test('optional structured media preserves legacy gallery-only input',()=>{
 assert.equal(parseMedia(undefined,['BOX-W'],validUrl),undefined);
 assert.deepEqual(mediaReferences(undefined,[gallery]),{gallery:[gallery],variants:[],details:[]});
 assert.deepEqual(mediaUrls(undefined,[gallery,gallery]),[gallery]);
 assert.deepEqual(mediaIssues(undefined,[gallery]),[]);
});
test('structured media keeps detail order and SKU association with deterministic deduplicated upload URLs',()=>{
 const parsed=parseMedia(source(),['BOX-W'],validUrl)!;
 assert.deepEqual(mediaReferences(parsed,[gallery]),{gallery:[gallery],variants:[{sku:'BOX-W',url:variant}],details:[{type:'text',text:'A white storage box.'},{type:'image',url:detail},{type:'text',text:'Width 12 cm.'}]});
 assert.deepEqual(mediaUrls(parsed,[gallery,detail]),[gallery,detail,variant]);
 parsed.assets.push({id:'unused',url:'https://cdn.example.com/unused.jpg',role:'detail',textInImage:'none'});assert.deepEqual(mediaUrls(parsed,[gallery]),[gallery,detail,variant]);
 assert.deepEqual(mediaIssues(parsed,[gallery]),[]);
 assert.equal(mediaIssues(parsed,[]).length,1);
 assert.equal(mediaWarnings(parsed).length,2);
 assert.equal(parsed.assets[0].textInImage,'present');
});
test('unknown metadata fields, unsafe URLs and malformed optional language are rejected',()=>{
 assert.throws(()=>parseMedia({...source(),owner:'someone'},['BOX-W'],validUrl));
 for(const change of [{url:'http://127.0.0.1/private'},{role:'cover'},{role:['gallery']},{textInImage:'translated'},{textInImage:['none']},{sourceLanguage:''},{sourceLanguage:123},{remoteImageId:'foreign-id'}]){const raw=source();raw.assets[0]={...raw.assets[0],...change} as any;assert.throws(()=>parseMedia(raw,['BOX-W'],validUrl));}
 const raw=source();raw.detailBlocks[0]={type:'text',text:'Hello',owner:'someone'} as any;assert.throws(()=>parseMedia(raw,['BOX-W'],validUrl));
});
test('dangling image references, unknown SKU and repeated SKU mappings fail before persistence',()=>{
 const missing=source();missing.variantImages[0].assetId='absent';assert.throws(()=>parseMedia(missing,['BOX-W'],validUrl));
 const unknown=source();unknown.variantImages[0].sku='OTHER';assert.throws(()=>parseMedia(unknown,['BOX-W'],validUrl));
 const duplicate=source();duplicate.variantImages.push({...duplicate.variantImages[0]});assert.throws(()=>parseMedia(duplicate,['BOX-W'],validUrl));
 const detailMissing=source();detailMissing.detailBlocks.push({type:'image',assetId:'absent'});assert.throws(()=>parseMedia(detailMissing,['BOX-W'],validUrl));
 const assetDuplicate=source();assetDuplicate.assets.push({...assetDuplicate.assets[0]});assert.throws(()=>parseMedia(assetDuplicate,['BOX-W'],validUrl));
});
test('media counts and text sizes are bounded independently from gallery count',()=>{
 const many=source();many.assets=Array.from({length:31},(_,i)=>({id:'image_'+i,url:detail,role:'detail',textInImage:'none'}));assert.throws(()=>parseMedia(many,['BOX-W'],validUrl));
 const galleryOver=source();galleryOver.assets=Array.from({length:10},(_,i)=>({id:'image_'+i,url:gallery,role:'gallery',textInImage:'none'}));assert.throws(()=>parseMedia(galleryOver,['BOX-W'],validUrl));
 const blockOver=source();blockOver.detailBlocks=Array.from({length:41},()=>({type:'text',text:'Example'}));assert.throws(()=>parseMedia(blockOver,['BOX-W'],validUrl));
 const textOver=source();textOver.detailBlocks=[{type:'text',text:'a'.repeat(10001)},{type:'text',text:'b'.repeat(10000)}];assert.throws(()=>parseMedia(textOver,['BOX-W'],validUrl));
});
test('parsing for separate markets returns deep copies and never rewrites source image text facts',()=>{
 const raw=source(),ph=parseMedia(raw,['BOX-W'],validUrl)!,th=parseMedia(raw,['BOX-W'],validUrl)!;
 ph.assets[0].url='https://cdn.example.com/ph-main.jpg';ph.detailBlocks[0]={type:'text',text:'English detail'};ph.variantImages[0].assetId='main';
 assert.equal(th.assets[0].url,gallery);assert.equal(raw.assets[0].url,gallery);
 assert.deepEqual(th.detailBlocks[0],{type:'text',text:'A white storage box.'});
 assert.equal(raw.variantImages[0].assetId,'white');assert.equal(th.assets[0].textInImage,'present');
 const refs=mediaReferences(th,[gallery]);refs.gallery.push('https://cdn.example.com/other.jpg');refs.variants[0].sku='CHANGED';
 assert.equal(th.variantImages[0].sku,'BOX-W');assert.equal(th.assets.length,3);
});

function pngHeader(width:number,height:number){const b=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(13,8);b.write('IHDR',12);b.writeUInt32BE(width,16);b.writeUInt32BE(height,20);return b;}
function jpegHeader(width:number,height:number,marker=0xc0){const b=Buffer.from([0xff,0xd8,0xff,0xe0,0,4,0,0,0xff,marker,0,11,8,0,0,0,0,1,1,0x11,0]);b.writeUInt16BE(height,13);b.writeUInt16BE(width,15);return b;}
function webpChunk(type:string,data:Buffer){const b=Buffer.alloc(20+data.length+(data.length%2));b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WEBP',8);b.write(type,12);b.writeUInt32LE(data.length,16);data.copy(b,20);return b;}
function webpHeader(width:number,height:number,type:'VP8X'|'VP8L'|'VP8 '){
 if(type==='VP8X'){const data=Buffer.alloc(10);data.writeUIntLE(width-1,4,3);data.writeUIntLE(height-1,7,3);return webpChunk(type,data);}
 if(type==='VP8L'){const data=Buffer.alloc(5);data[0]=0x2f;data.writeUInt32LE(((height-1)<<14)|(width-1),1);return webpChunk(type,data);}
 const data=Buffer.from([0,0,0,0x9d,1,0x2a,0,0,0,0]);data.writeUInt16LE(width,6);data.writeUInt16LE(height,8);return webpChunk(type,data);
}
test('image dimensions read PNG, baseline/progressive JPEG and all three WebP dimension headers',()=>{
 const expected={width:800,height:1200};
 for(const b of [pngHeader(800,1200),jpegHeader(800,1200),jpegHeader(800,1200,0xc2),webpHeader(800,1200,'VP8X'),webpHeader(800,1200,'VP8L'),webpHeader(800,1200,'VP8 ')])assert.deepEqual(imageDimensions(b),expected);
 const withUnknownChunk=Buffer.concat([webpHeader(800,1200,'VP8X').subarray(0,12),Buffer.from([74,85,78,75,2,0,0,0,0,0]),webpHeader(800,1200,'VP8X').subarray(12)]);withUnknownChunk.writeUInt32LE(withUnknownChunk.length-8,4);assert.deepEqual(imageDimensions(withUnknownChunk),expected);
});
test('truncated dimension headers, unsupported signatures and zero image dimensions return undefined without throwing',()=>{
 for(const b of [pngHeader(800,1200),jpegHeader(800,1200),webpHeader(800,1200,'VP8X'),webpHeader(800,1200,'VP8L'),webpHeader(800,1200,'VP8 ')])for(let size=0;size<b.length;size++)assert.equal(imageDimensions(b.subarray(0,size)),undefined,`size ${size}/${b.length}`);
 for(const b of [Buffer.from('GIF89a'),Buffer.alloc(40),pngHeader(0,1200),pngHeader(800,0),jpegHeader(0,1200),jpegHeader(800,0),webpHeader(0,1200,'VP8 '),webpHeader(800,0,'VP8 ')])assert.equal(imageDimensions(b),undefined);
});
test('malformed PNG chunks, JPEG segment bounds and WebP frame headers are rejected',()=>{
 const badPng=pngHeader(800,1200);badPng.writeUInt32BE(12,8);assert.equal(imageDimensions(badPng),undefined);
 const hugePng=pngHeader(0xffffffff,1200);assert.equal(imageDimensions(hugePng),undefined);
 const badJpeg=jpegHeader(800,1200);badJpeg.writeUInt16BE(1,4);assert.equal(imageDimensions(badJpeg),undefined);
 const badComponents=jpegHeader(800,1200);badComponents[17]=2;assert.equal(imageDimensions(badComponents),undefined);
 const badFrame=webpHeader(800,1200,'VP8 ');badFrame[23]=0;assert.equal(imageDimensions(badFrame),undefined);
 const interFrame=webpHeader(800,1200,'VP8 ');interFrame[20]=1;assert.equal(imageDimensions(interFrame),undefined);
 const badVersion=webpHeader(800,1200,'VP8L');badVersion[24]|=0x20;assert.equal(imageDimensions(badVersion),undefined);
 const shortChunk=webpChunk('VP8X',Buffer.alloc(9));assert.equal(imageDimensions(shortChunk),undefined);
 const overrun=webpHeader(800,1200,'VP8X');overrun.writeUInt32LE(1000,16);assert.equal(imageDimensions(overrun),undefined);
});
