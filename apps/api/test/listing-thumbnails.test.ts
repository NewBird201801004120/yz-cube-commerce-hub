import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {ListingService} from '../src/listing';

test('listing summaries expose protected thumbnails of original images, including unfinished tasks, without leaking original data',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'listing-thumbnails-')),previous=process.env.LISTING_DATA_DIR;process.env.LISTING_DATA_DIR=dir;
 try{
  const service=new ListingService(),id=randomUUID(),image=await sharp({create:{width:1200,height:400,channels:3,background:'#fff'}}).png().toBuffer();
  const job={id,owner:'one',name:'原图商品',createdAt:new Date().toISOString(),status:'planning',count:6,primary:{id:'primary',name:'product.png',data:image.toString('base64'),mime:'image/png'},slots:[]};
  const file=join(dir,'jobs',id+'.json');writeFileSync(file,JSON.stringify(job));
  const rows=service.list('one');assert.equal(rows[0].thumbnailUrl,`/api/v1/listing/jobs/${id}/thumbnail`);assert.equal('primary' in rows[0],false);assert.equal('slots' in rows[0],false);assert.deepEqual(service.list('two'),[]);
  const bytes=await service.thumbnail(id,'one'),metadata=await sharp(bytes).metadata();assert.equal(metadata.format,'jpeg');assert.ok(metadata.width!<=160&&metadata.height!<=160);assert.ok(bytes.length<10000);
  await assert.rejects(()=>service.thumbnail(id,'two'),/任务不存在/);await assert.rejects(()=>service.thumbnail('../'+id,'one'),/任务不存在/);
  writeFileSync(file,JSON.stringify({...job,deletedAt:new Date().toISOString()}));assert.deepEqual(service.list('one'),[]);await assert.rejects(()=>service.thumbnail(id,'one'),/任务不存在/);
 }finally{if(previous===undefined)delete process.env.LISTING_DATA_DIR;else process.env.LISTING_DATA_DIR=previous;rmSync(dir,{recursive:true,force:true});}
});
