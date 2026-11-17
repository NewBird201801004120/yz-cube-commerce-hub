import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Module,BadRequestException} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {LocalizationIntegrationController,LocalizationIntegrationGuard,LocalizationIntegrationService} from '../src/localization-integration';
import {LocalizationIntegrationHealth,configureIntegrationHttp} from '../src/localization-integration-main';

test('production entry keeps machine auth, JSON errors and browser Origin boundaries',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'localization-production-')),previous=process.env.LOCALIZATION_INTEGRATIONS_FILE;
 const token='fixture_production_token_1234567890123456789',file=join(dir,'clients.json');
 writeFileSync(file,JSON.stringify([{id:'fixture',tokenSha256:createHash('sha256').update(token).digest('hex'),ownerEmail:'fixture@example.com',sourceSystem:'simulation',shopScope:'all_connected',allowedShopIds:[],enabled:true}]),{mode:0o600});process.env.LOCALIZATION_INTEGRATIONS_FILE=file;
 let accepted=0,rejectIncomplete=false;
 @Module({controllers:[LocalizationIntegrationHealth,LocalizationIntegrationController],providers:[LocalizationIntegrationGuard,{provide:LocalizationIntegrationService,useValue:{shops:()=>[{id:'fixture',language:'English',supportedLanguages:['English','ไทย']}],accept:()=>{if(rejectIncomplete)throw new BadRequestException({message:'商品资料不完整',fieldErrors:[{field:'target.publishing.variants[0].price',message:'必须提供售价'}]});accepted++;return {id:'fixture-id',status:'localizing'};},get:()=>({id:'fixture-id',status:'awaiting_review'}),retry:()=>({id:'fixture-id',status:'awaiting_review'})}}]})
 class Fixture{}
 const app=await NestFactory.create(Fixture,{logger:false});configureIntegrationHttp(app,'https://commerce.aicbec.cn');await app.listen(0,'127.0.0.1');const base=(await app.getUrl())+'/api/v1';
 const call=(path:string,method='GET',headers:Record<string,string>={})=>fetch(base+path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},...(method==='POST'?{body:'{}'}:{})});
 try{
  assert.equal((await call('/localization/health')).status,200);
  const unauthorized=await call('/localization/integration/shops','GET',{authorization:''});assert.equal(unauthorized.status,401);assert.equal((await unauthorized.json()).code,'HTTP_401');assert.ok(unauthorized.headers.get('x-request-id'));
  const shops=await call('/localization/integration/shops');assert.equal(shops.status,200);assert.equal(shops.headers.get('cache-control'),'no-store');assert.deepEqual((await shops.json())[0].supportedLanguages,['English','ไทย']);
  assert.equal((await call('/localization/integration/imports','POST')).status,201);
  assert.equal((await call('/localization/integration/imports/fixture-id')).status,200);
  assert.equal((await call('/localization/integration/imports/12345678-1234-1234-1234-123456789abc/localize','POST')).status,201);
  assert.equal((await call('/localization/integration/imports','POST',{origin:'https://foreign.example'})).status,403);
  assert.equal((await call('/localization/integration/imports','POST',{cookie:'yz_session=fixture'})).status,403);
  assert.equal((await call('/localization/integration/shops','GET',{cookie:'yz_session=fixture'})).status,401);
  assert.equal((await call('/localization/integration/imports','POST',{origin:'https://commerce.aicbec.cn'})).status,401);
  assert.equal((await call('/localization/drafts/fixture/publish','POST')).status,403);
  assert.equal((await call('/listing/jobs','POST',{origin:'https://commerce.aicbec.cn'})).status,404);
  assert.equal(accepted,1);rejectIncomplete=true;const incomplete=await call('/localization/integration/imports','POST');assert.equal(incomplete.status,400);const detail=await incomplete.json();assert.equal(detail.code,'HTTP_400');assert.deepEqual(detail.fieldErrors,[{field:'target.publishing.variants[0].price',message:'必须提供售价'}]);assert.equal(accepted,1);
 }finally{await app.close();if(previous===undefined)delete process.env.LOCALIZATION_INTEGRATIONS_FILE;else process.env.LOCALIZATION_INTEGRATIONS_FILE=previous;rmSync(dir,{recursive:true,force:true});}
});
