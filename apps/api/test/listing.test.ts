import 'reflect-metadata';
import {test,mock} from 'node:test';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import dns from 'node:dns/promises';
import {Module,UnauthorizedException} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import cookieParser from 'cookie-parser';
import {json} from 'express';
import {unzipSync,zipSync} from 'fflate';
import {Workbook} from 'exceljs';
import {ListingService,ListingController,ListingGuard,parameterFile} from '../src/listing';
import {TeamShopClient} from '../src/team-client';
import {parsePlan,publicUrl,prepareListingImage} from '../src/listing-engine';
const owner='fixture@local.test';
@Module({controllers:[ListingController],providers:[ListingService,ListingGuard,{provide:TeamShopClient,useValue:{async me(id:string){if(id!=='fixture-cookie')throw new UnauthorizedException('请登录');return {email:owner};}}}]})class FixtureModule{}
test('Listing HTTP workflow: encrypted configuration, factual gating, partial failure, resume and ZIP',async()=>{
 const root=process.env.LISTING_TEST_ROOT||resolve('../../.local/test-fixtures');
 const {mkdirSync}=await import('node:fs');mkdirSync(root,{recursive:true});process.env.LISTING_DATA_DIR=mkdtempSync(join(root,'listing-'));
 const nativeFetch=globalThis.fetch;let imageCalls=0,modelCalls=0,modelMode='ok',imageMode='normal',releaseImage:(()=>void)|undefined;const png=(await sharp({create:{width:20,height:20,channels:3,background:'#3080c0'}}).png().toBuffer()).toString('base64');
 const dnsMock=mock.method(dns,'lookup',async(host:string)=>[{address:host==='private.test'?'127.0.0.1':host.includes('proxy.test')||host==='198.18.0.1'?'198.18.0.1':'93.184.216.34',family:4}]);
 globalThis.fetch=async(url,options)=>{
  if(String(url).startsWith('https://cloudflare-dns.com/dns-query'))return Response.json({Answer:[{type:1,data:String(url).includes('internal-proxy.test')?'127.0.0.1':'93.184.216.34'}]});
  if(String(url).startsWith('https://api.openai.com/v1')||String(url).startsWith('https://sub2api.yiliang.app:8888/v1')){
   assert.equal((options?.headers as Record<string,string>).Authorization,'Bearer fixture-private-key');
   if(String(url).endsWith('/models')){modelCalls++;assert.equal(options?.method,undefined);if(modelMode==='denied')return new Response('fixture-private-key',{status:401});if(modelMode==='invalid')return Response.json({unexpected:true});return Response.json({data:[{id:'fixture-planner'},{id:'fixture-image'},{id:'fixture-image'},null,{bad:'shape'}]});}
   if(String(url).endsWith('/chat/completions')){const body=JSON.parse(String(options?.body));if(body.messages[0].content.startsWith('You check'))return Response.json({choices:[{message:{content:JSON.stringify({verdict:'needs_review',issues:['请核对标识是否清晰']})}}]});assert.ok(body.messages[0].content.includes('category-specific'));return Response.json({choices:[{message:{content:JSON.stringify({planVersion:2,seoTitle:'Fixture visible product',sellingPoints:[{text:'Visible blue finish',sourceId:'primary',reason:'Observed product identity'}],verificationNotes:['No competitor research performed'],categoryProfile:'generic visible product',visualIdentity:'blue visible reference identity',designSystem:'ivory background, consistent typography',facts:[{key:'dimensions',value:'invented 30cm',sourceId:'primary'}],slots:[{id:'main_hero',prompt:'same exact reference product',referenceIds:['primary']},{id:'detail',prompt:'visible texture',referenceIds:['primary']},{id:'dimensions',prompt:'30 cm',referenceIds:['primary']}]})}}]});}
   if(String(url).endsWith('/images/edits')){imageCalls++;if(imageMode==='block'){imageMode='normal';await new Promise<void>(r=>{releaseImage=r;});}if(imageMode==='rate-limit'){imageMode='normal';return new Response('{}',{status:429,headers:{'retry-after':'0'}});}assert.ok(options?.body instanceof FormData);assert.ok(options.body.get('image') instanceof Blob);if(imageCalls===2)return new Response('{}',{status:502});return Response.json({data:[{b64_json:png}]});}
  }
  return nativeFetch(url,options);
 };
 const app=await NestFactory.create(FixtureModule,{logger:false});app.use(cookieParser());app.use(json({limit:'30mb'}));app.setGlobalPrefix('api/v1');await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1';
 const call=(path:string,method='GET',body?:unknown,cookie='yz_team=fixture-cookie')=>fetch(base+path,{method,headers:{cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 try{
  assert.equal((await call('/listing/jobs','GET',undefined,'')).status,401);
  assert.equal((await call('/settings/ai/models/image','POST',{baseUrl:'https://api.openai.com/v1',apiKey:'fixture-private-key'},'')).status,401);
  const unsaved=await call('/settings/ai/models/image','POST',{baseUrl:'https://sub2api.yiliang.app:8888/v1',apiKey:'fixture-private-key'});assert.equal(unsaved.status,201);assert.deepEqual((await unsaved.json()).models,['fixture-image','fixture-planner']);assert.equal((await (await call('/settings/ai')).json()).image.hasKey,false);
  const configured=await call('/settings/ai','PUT',{planner:{baseUrl:'https://api.openai.com/v1',model:'fixture-planner',apiKey:'fixture-private-key'},image:{baseUrl:'https://api.openai.com/v1',model:'fixture-image',apiKey:'fixture-private-key'}});
  assert.equal(configured.status,200);assert.ok(!(await configured.text()).includes('fixture-private-key'));
  assert.ok(!readFileSync(join(process.env.LISTING_DATA_DIR,'config.enc'),'utf8').includes('fixture-private-key'));
  const settings=await (await call('/settings/ai')).json();assert.equal(settings.image.hasKey,true);assert.equal(settings.image.apiKey,undefined);
  const savedModels=await call('/settings/ai/models/planner','POST',{baseUrl:'https://api.openai.com/v1',apiKey:''});assert.equal(savedModels.status,201);assert.ok(!(await savedModels.text()).includes('fixture-private-key'));
  const before=modelCalls;assert.equal((await call('/settings/ai/models/image','POST',{baseUrl:'https://other.test/v1',apiKey:''})).status,400);assert.equal(modelCalls,before);
  modelMode='denied';const denied=await call('/settings/ai/models/image','POST',{baseUrl:'https://api.openai.com/v1'});assert.equal(denied.status,400);assert.ok(!(await denied.text()).includes('fixture-private-key'));
  modelMode='invalid';assert.equal((await call('/settings/ai/models/image','POST',{baseUrl:'https://api.openai.com/v1'})).status,400);modelMode='ok';
  const create=await call('/listing/jobs','POST',{requestId:'fixture-request-0001',name:'Fixture product',count:6,primary:{name:'product.png',data:png},documents:[{name:'params.txt',data:Buffer.from('color: blue').toString('base64')} ]});assert.equal(create.status,201);const created=await create.json();
  let job=created;for(let i=0;i<60;i++){job=await (await call(`/listing/jobs/${created.id}`)).json();if(['done','partial','error'].includes(job.status))break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(job.seoTitle,'Fixture visible product');assert.equal(job.slots[0].output.width,800);assert.equal(job.status,'partial');assert.equal(job.completed,1);assert.equal(job.total,2);assert.equal(job.slots.some((s:{id:string})=>s.id==='dimensions'),false);assert.ok(job.skipped.some((s:string)=>s.includes('尺寸')));assert.ok(!JSON.stringify(job).includes(png));
  const success=job.slots[0].imageUrl;assert.equal((await call(`/listing/jobs/${job.id}/retry`,'POST',{})).status,201);
  for(let i=0;i<60;i++){job=await (await call(`/listing/jobs/${job.id}`)).json();if(job.status==='done')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(job.status,'done');assert.equal(imageCalls,3);assert.equal(job.slots[0].imageUrl,success);
  // Replaying the same accepted request after completion must not bill again.
  const payload={requestId:'fixture-request-0001',name:'Fixture product',count:6,primary:{name:'product.png',data:png},documents:[{name:'params.txt',data:Buffer.from('color: blue').toString('base64')}]};
  const replay=await (await call('/listing/jobs','POST',payload)).json();assert.equal(replay.id,job.id);assert.equal(imageCalls,3);
  const checked=await (await call(`/listing/jobs/${job.id}/slots/detail/review`,'POST')).json();assert.equal(checked.slots[1].review.verdict,'needs_review');assert.deepEqual(checked.slots[1].review.issues,['请核对标识是否清晰']);assert.equal(imageCalls,3);
  assert.equal((await call('/listing/jobs','POST',{...payload,name:'different'})).status,409);
  // Strict single-slot retry leaves other unfinished slots alone and preserves successful files.
  const jobPath=join(process.env.LISTING_DATA_DIR!,'jobs',job.id+'.json');const changed=JSON.parse(readFileSync(jobPath,'utf8'));changed.slots[1].status='error';changed.slots.push({id:'appearance',title:'外观',prompt:'visible only',referenceIds:['primary'],status:'pending'});writeFileSync(jobPath,JSON.stringify(changed));
  await call(`/listing/jobs/${job.id}/retry`,'POST',{slotId:'detail',prompt:'single slot edit'});
  for(let i=0;i<60;i++){job=await (await call(`/listing/jobs/${job.id}`)).json();if(job.status==='partial')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(imageCalls,4);assert.equal(job.slots[2].status,'pending');assert.equal(job.slots[0].imageUrl,success);assert.equal(job.designSystem,'ivory background, consistent typography');
  const regenerated=job.slots[1].imageUrl;assert.equal(job.slots[1].hasPrevious,true);assert.equal(job.slots[1].review,undefined);
  const reverted=await (await call(`/listing/jobs/${job.id}/slots/detail/restore`,'POST')).json();assert.notEqual(reverted.slots[1].imageUrl,regenerated);assert.equal(reverted.completed,2);assert.equal(imageCalls,4);
  await call(`/listing/jobs/${job.id}/retry`,'POST',{});for(let i=0;i<60;i++){job=await (await call(`/listing/jobs/${job.id}`)).json();if(job.status==='done')break;await new Promise(r=>setTimeout(r,20));}assert.equal(imageCalls,5);
  // Stop allows the in-flight billed image to complete, then prevents later requests.
  imageMode='block';const pausedCreate=await (await call('/listing/jobs','POST',{...payload,requestId:'fixture-request-stop',name:'Stop fixture'})).json();
  for(let i=0;i<60&&!releaseImage;i++)await new Promise(r=>setTimeout(r,20));assert.ok(releaseImage);const duplicate=await (await call('/listing/jobs','POST',{...payload,requestId:'fixture-request-stop',name:'Stop fixture'})).json();assert.equal(duplicate.id,pausedCreate.id);assert.equal((await call(`/listing/jobs/${pausedCreate.id}`,'DELETE')).status,409);assert.equal((await call(`/listing/jobs/${pausedCreate.id}/slots/main_hero`,'DELETE')).status,409);assert.equal((await call(`/listing/jobs/${pausedCreate.id}/stop`,'POST')).status,201);releaseImage!();
  let paused=pausedCreate;for(let i=0;i<60;i++){paused=await (await call(`/listing/jobs/${paused.id}`)).json();if(paused.status==='paused')break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(paused.status,'paused');assert.equal(paused.completed,1);const beforeResume=imageCalls;const preserved=paused.slots[0].imageUrl;
  await call(`/listing/jobs/${paused.id}/retry`,'POST',{});for(let i=0;i<60;i++){paused=await (await call(`/listing/jobs/${paused.id}`)).json();if(paused.status==='done')break;await new Promise(r=>setTimeout(r,20));}assert.equal(imageCalls,beforeResume+1);assert.equal(paused.slots[0].imageUrl,preserved);
  // Deleted slots leave the carousel, ZIP and resource API, and must never return on resume.
  const beforeDelete=imageCalls;const removed=await (await call(`/listing/jobs/${paused.id}/slots/main_hero`,'DELETE')).json();assert.equal(removed.total,1);assert.equal(removed.completed,1);assert.equal(removed.slots[0].id,'detail');
  assert.equal((await fetch((await app.getUrl())+preserved,{headers:{cookie:'yz_team=fixture-cookie'}})).status,404);
  assert.equal((await call(`/listing/jobs/${paused.id}/retry`,'POST',{slotId:'main_hero'})).status,404);
  const deletedZip=await call(`/listing/jobs/${paused.id}/download`);assert.equal(Object.keys(unzipSync(new Uint8Array(await deletedZip.arrayBuffer()))).filter(n=>/\.(jpg|png|webp)$/.test(n)).length,1);
  await call(`/listing/jobs/${paused.id}/retry`,'POST',{});for(let i=0;i<60;i++){const current=await (await call(`/listing/jobs/${paused.id}`)).json();if(current.status==='done')break;await new Promise(r=>setTimeout(r,20));}assert.equal(imageCalls,beforeDelete);
  assert.throws(()=>app.get(ListingService).remove(paused.id,'other@local.test'));
  const empty=await (await call(`/listing/jobs/${paused.id}/slots/detail`,'DELETE')).json();assert.equal(empty.total,0);assert.equal(empty.status,'done');assert.equal((await call(`/listing/jobs/${paused.id}/retry`,'POST',{})).status,400);
  assert.equal((await call(`/listing/jobs/${paused.id}`,'DELETE')).status,200);assert.equal((await call(`/listing/jobs/${paused.id}`)).status,404);assert.equal((await call(`/listing/jobs/${paused.id}/download`)).status,404);assert.equal((await (await call('/listing/jobs')).json()).some((j:{id:string})=>j.id===paused.id),false);
  assert.equal((await call('/listing/jobs','POST',{...payload,requestId:'fixture-request-stop',name:'Stop fixture'})).status,409);assert.equal(imageCalls,beforeDelete);
  imageMode='rate-limit';const rate=await (await call('/listing/jobs','POST',{...payload,requestId:'fixture-request-rate',name:'429 fixture'})).json();let rateJob=rate;const beforeRate=imageCalls;
  for(let i=0;i<60;i++){rateJob=await (await call(`/listing/jobs/${rate.id}`)).json();if(rateJob.status==='done')break;await new Promise(r=>setTimeout(r,20));}assert.equal(rateJob.status,'done');assert.equal(imageCalls,beforeRate+2); // first rejected call has already started
  const image=await fetch((await app.getUrl())+success,{headers:{cookie:'yz_team=fixture-cookie'}});assert.equal(image.status,200);assert.ok(image.headers.get('content-type')?.includes('image/jpeg'));
  const download=await call(`/listing/jobs/${job.id}/download`);assert.equal(download.status,200);const archive=unzipSync(new Uint8Array(await download.arrayBuffer()));assert.equal(Object.keys(archive).filter(n=>/\.(jpg|png|webp)$/.test(n)).length,3);assert.equal(Buffer.from(archive['SEO-title.txt']).toString(),'Fixture visible product');assert.ok(Buffer.from(archive['核验说明.txt']).toString().includes('非人工验收'));const meta=await sharp(Buffer.from(archive['main_hero.jpg'])).metadata();assert.equal(meta.width,800);assert.equal(meta.height,800);assert.ok(archive['main_hero.jpg'].length<2000000);
  assert.equal((await call(`/listing/jobs/${job.id}/images/not-owned.png`)).status,404);
  const service=app.get(ListingService);assert.throws(()=>service.get(job.id,'other@local.test'));
  assert.equal((await call('/listing/jobs','POST',{primary:{name:'bad.png',data:Buffer.from('not an image').toString('base64')}})).status,400);
  job.status='running';job.slots[1].status='generating';const stored=JSON.parse(readFileSync(join(process.env.LISTING_DATA_DIR,'jobs',job.id+'.json'),'utf8'));stored.status='running';stored.slots[1].status='generating';writeFileSync(join(process.env.LISTING_DATA_DIR,'jobs',job.id+'.json'),JSON.stringify(stored));const restored=new ListingService();restored.onModuleInit();assert.equal(restored.get(job.id,owner).status,'partial');const beforeRestart=imageCalls;const restartPreserved=restored.get(job.id,owner).slots![0].imageUrl;
  await restored.retry(job.id,owner);let resumed=restored.get(job.id,owner);for(let i=0;i<60;i++){resumed=restored.get(job.id,owner);if(resumed.status==='done')break;await new Promise(r=>setTimeout(r,20));}assert.equal(resumed.status,'done');assert.equal(imageCalls,beforeRestart+1);assert.equal(resumed.slots![0].imageUrl,restartPreserved);
  await assert.rejects(publicUrl('https://private.test/v1'));await assert.rejects(publicUrl('http://api.openai.com/v1'));
  assert.equal(await publicUrl('https://proxy.test:8888/v1'),'https://proxy.test:8888/v1');
  await assert.rejects(publicUrl('https://internal-proxy.test:8888/v1'));await assert.rejects(publicUrl('https://198.18.0.1:8888/v1'));
 }finally{await app.close();globalThis.fetch=nativeFetch;dnsMock.mock.restore();}
});
test('facts require valid supplementary sources; unknown slot IDs and duplicate slots are removed',()=>{
 const plan=parsePlan(JSON.stringify({facts:[{key:'dimensions',value:'20x10 cm',sourceId:'file-1'},{key:'material',value:'leather',sourceId:'unknown'}],slots:[{id:'dimensions',prompt:'dimensions'},{id:'dimensions',prompt:'duplicate'},{id:'material',prompt:'unknown material'},{id:'unexpected',prompt:'invalid'}]}),new Set(['primary','file-1']),6);
 assert.deepEqual(plan.slots.map(s=>s.id),['dimensions']);assert.equal(plan.facts.length,1);
});
test('parameter files: UTF8, DOCX, XLSX, PDF extraction and unreadable documents',async()=>{
 const b64=(name:string,data:Buffer|Uint8Array)=>({name,data:Buffer.from(data).toString('base64')});
 const text=await parameterFile(b64('参数.csv',Buffer.from('材质,尼龙\n尺寸,20cm')),'f1');assert.ok(text.text.includes('尼龙'));
 const docx=zipSync({'[Content_Types].xml':Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),'word/document.xml':Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Material: Nylon</w:t></w:r></w:p></w:body></w:document>')});assert.ok((await parameterFile(b64('params.docx',docx),'f2')).text.includes('Nylon'));
 const w=new Workbook();w.addWorksheet('参数').addRow(['长度','20cm']);w.addWorksheet('另一个型号').addRow(['SC28','1080P']);const extracted=(await parameterFile(b64('params.xlsx',Buffer.from(await w.xlsx.writeBuffer())),'f3')).text;assert.ok(extracted.includes('20cm'));assert.ok(extracted.includes('[工作表：另一个型号]'));assert.ok(extracted.includes('SC28'));
 // Minimal real PDF with an ASCII text stream and valid xref offsets.
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];const stream='BT /F1 12 Tf 30 250 Td (Length: 20cm) Tj ET';objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);let pdf='%PDF-1.4\n';const offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
 assert.ok((await parameterFile(b64('params.pdf',Buffer.from(pdf)),'f4')).text.includes('20cm'));
 await assert.rejects(parameterFile(b64('blank.txt',Buffer.from('  ')),'f5'));
 await assert.rejects(parameterFile(b64('legacy.doc',Buffer.from('data')),'f6'));
});

test('marketing plan enforces hero, SEO limit and evidence for functions/contents',()=>{
 const raw={planVersion:2,seoTitle:'Brand 20L Storage Box',facts:[{key:'capacity',value:'20L',sourceId:'notes'},{key:'functionality',value:'IP67',sourceId:'primary'}],slots:[{id:'capacity',prompt:'show 20L'},{id:'functionality',prompt:'claim IP67'},{id:'accessories',prompt:'free tools'},{id:'main_hero',prompt:'benefit-driven hero',purpose:'communicate core capacity advantage'}],sellingPoints:[{text:'20L storage',sourceId:'notes'},{text:'Made up',sourceId:'missing'}]};
 const plan=parsePlan(JSON.stringify(raw),new Set(['primary','notes']),4);assert.deepEqual(plan.slots.map(s=>s.id),['main_hero','capacity']);assert.equal(plan.sellingPoints.length,1);assert.equal(plan.facts.length,1);
 assert.throws(()=>parsePlan(JSON.stringify({...raw,seoTitle:'a'.repeat(101)}),new Set(['primary','notes']),4),/100/);
 assert.throws(()=>parsePlan(JSON.stringify({...raw,slots:raw.slots.filter(s=>s.id!=='main_hero')}),new Set(['primary','notes']),4),/主图/);
});
test('export makes 800-square JPEG without cropping a non-square product reference',async()=>{
 const source=await sharp({create:{width:1600,height:800,channels:3,background:'#000000'}}).png().toBuffer();const result=await prepareListingImage(source);const image=sharp(result.bytes);const meta=await image.metadata();assert.equal(meta.format,'jpeg');assert.equal(meta.width,800);assert.equal(meta.height,800);assert.ok(result.bytes.length<2000000);
 const {data,info}=await image.raw().toBuffer({resolveWithObject:true});assert.ok(data[0]>240);const centre=(400*info.width+400)*info.channels;assert.ok(data[centre]<15);await assert.rejects(prepareListingImage(Buffer.from('not image')));
});
