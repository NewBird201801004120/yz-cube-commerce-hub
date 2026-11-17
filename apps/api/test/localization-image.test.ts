import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {shopeeUploadImage} from '../src/localization-image';
test('Shopee upload converts source WebP to JPEG without changing dimensions or source bytes',async()=>{const source=await sharp({create:{width:20,height:30,channels:4,background:{r:10,g:20,b:30,alpha:.5}}}).webp().toBuffer(),copy=Buffer.from(source);const result=await shopeeUploadImage(source),info=await sharp(result.bytes).metadata();assert.equal(result.mime,'image/jpeg');assert.equal(info.format,'jpeg');assert.equal(info.width,20);assert.equal(info.height,30);assert.deepEqual(source,copy);});
test('PNG and JPEG remain original bytes; malformed image is rejected',async()=>{for(const format of ['png','jpeg'] as const){const source=await sharp({create:{width:2,height:2,channels:3,background:'white'}})[format]().toBuffer();assert.equal((await shopeeUploadImage(source)).bytes,source);}await assert.rejects(()=>shopeeUploadImage(Buffer.from('not an image')));});
