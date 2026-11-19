import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {VideoSettingsService,VideoSettingsController,videoBaseUrl} from '../src/tools/short-video/settings';
import {VideoService} from '../src/tools/short-video/video';
import {LocalizationGuard} from '../src/localization';
import {Auth} from '../src/auth';

const baseUrl='https://llm-fixture.cn-beijing.maas.aliyuncs.com/api/v1';
const config={baseUrl,analysisModel:'qwen-plus-custom',videoModel:'wan3.0-video-custom',apiKey:'fixture-api-key',ossRegion:'oss-cn-shenzhen',ossBucket:'fixture-bucket',ossAccessKeyId:'fixture-access-id',ossAccessKeySecret:'fixture-access-secret'};

function sandbox(){const dir=mkdtempSync(join(tmpdir(),'video-settings-')),old=process.env.VIDEO_SETTINGS_DATA_DIR;process.env.VIDEO_SETTINGS_DATA_DIR=dir;return {dir,done:()=>{if(old===undefined)delete process.env.VIDEO_SETTINGS_DATA_DIR;else process.env.VIDEO_SETTINGS_DATA_DIR=old;rmSync(dir,{recursive:true,force:true});}};}

test('video settings encrypt secrets, redact reads, preserve blank credentials and survive restart',()=>{
 const {dir,done}=sandbox();try{
  const service=new VideoSettingsService(),publicConfig=service.configure(config);
  assert.equal(publicConfig.configured,true);assert.equal(publicConfig.hasKey,true);assert.equal(publicConfig.hasOssAccessKeyId,true);assert.equal(publicConfig.hasOssAccessKeySecret,true);
  const json=JSON.stringify(publicConfig),encrypted=readFileSync(join(dir,'config.enc'),'utf8');
  for(const secret of [config.apiKey,config.ossAccessKeyId,config.ossAccessKeySecret]){assert.ok(!json.includes(secret));assert.ok(!encrypted.includes(secret));}
  assert.equal(statSync(join(dir,'config.enc')).mode&0o777,0o600);assert.equal(statSync(join(dir,'encryption.key')).mode&0o777,0o600);
  service.configure({...config,apiKey:'',ossAccessKeyId:'',ossAccessKeySecret:'',videoModel:'updated-video'});
  const reloaded=new VideoSettingsService();assert.equal(reloaded.runtime().apiKey,config.apiKey);assert.equal(reloaded.runtime().ossAccessKeyId,config.ossAccessKeyId);assert.equal(reloaded.runtime().videoModel,'updated-video');
  assert.throws(()=>service.configure({...config,baseUrl:'https://other.cn-beijing.maas.aliyuncs.com/api/v1',apiKey:''}),/重新填写/);
  assert.equal(service.runtime().baseUrl,baseUrl);
 }finally{done();}
});

test('video URL validation rejects arbitrary hosts, IPs, alternate ports, credentials and endpoint suffixes',()=>{
 assert.equal(videoBaseUrl(baseUrl+'/'),baseUrl);
 for(const input of ['http://127.0.0.1/api/v1','https://127.0.0.1/api/v1','https://example.com/api/v1','https://llm-fixture.cn-beijing.maas.aliyuncs.com.evil.example/api/v1','https://llm-fixture.cn-beijing.maas.aliyuncs.com:8443/api/v1','https://user:pass@llm-fixture.cn-beijing.maas.aliyuncs.com/api/v1',baseUrl+'?token=test',baseUrl+'/services/aigc/text-generation/generation'])assert.throws(()=>videoBaseUrl(input));
});

test('analysis uses saved base URL and model without requiring OSS; video use still rejects missing storage',async()=>{
 const {done}=sandbox(),previous=global.fetch;
 try{
  const service=new VideoSettingsService();service.configure({...config,ossRegion:'',ossBucket:'',ossAccessKeyId:'',ossAccessKeySecret:''});
  assert.equal(service.settings().analysisConfigured,true);assert.equal(service.settings().storageConfigured,false);assert.throws(()=>service.runtime('video'),/OSS/);
  const team={me:async()=>({email:'fixture@example.test'}),read:async()=>({item_list:[{item_id:123,item_name:'Fixture product',description:'One fixture product.'}]})};
  let requestUrl='',requestModel='';global.fetch=async(input,init)=>{requestUrl=String(input);requestModel=JSON.parse(String(init?.body)).model;return new Response(JSON.stringify({output:{choices:[{message:{content:JSON.stringify({sellingPoints:'One item.',style:'Clean studio.',prompt:'Show the product.',warnings:''})}}]}}),{status:200,headers:{'Content-Type':'application/json'}});};
  const video=new VideoService(team as any,service);await video.analyze({cookies:{yz_team:'fixture'}} as any,{shopId:'shop',itemId:'123'});
  assert.equal(requestUrl,baseUrl+'/services/aigc/text-generation/generation');assert.equal(requestModel,config.analysisModel);
 }finally{global.fetch=previous;done();}
});

test('video AI settings HTTP requires an administrator and never returns credentials',async()=>{
 const {done}=sandbox();
 const auth={session:async(req:any)=>req.headers.authorization==='admin'?{user:{email:'admin@fixture.test',role:'ADMIN'},userId:'admin'}:req.headers.authorization==='user'?{user:{email:'user@fixture.test',role:'USER'},userId:'user'}:null};
 @Module({controllers:[VideoSettingsController],providers:[VideoSettingsService,LocalizationGuard,{provide:Auth,useValue:auth}]})class FixtureModule{}
 const app=await NestFactory.create(FixtureModule,{logger:false});app.setGlobalPrefix('api/v1');await app.listen(0,'127.0.0.1');const url=await app.getUrl()+'/api/v1/settings/ai/video';
 try{
  for(const authorization of ['', 'user']){const res=await fetch(url,{headers:{authorization}});assert.equal(res.status,401);}
  const saved=await fetch(url,{method:'PUT',headers:{authorization:'admin','content-type':'application/json'},body:JSON.stringify(config)});assert.equal(saved.status,200);assert.equal((await saved.json()).configured,true);
  const res=await fetch(url,{headers:{authorization:'admin'}}),body=await res.text();assert.equal(res.status,200);for(const secret of [config.apiKey,config.ossAccessKeyId,config.ossAccessKeySecret])assert.ok(!body.includes(secret));
 }finally{await app.close();done();}
});
