import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import cookieParser from 'cookie-parser';
import {LocalizationNotifications} from '../src/localization-notifications';
import {LocalizationGuard,LocalizationService} from '../src/localization';
import {LocalizationIntegrationService,integrationServerRequest} from '../src/localization-integration';
import {LocalizationReceiptsController,LocalizationReceiptsDevelopmentController} from '../src/localization-receipts';
import {DevelopmentGuard} from '../src/development';
import {Auth} from '../src/auth';
import {Database} from '../src/database';

const first={id:'receipt-1',title:'商品一',sourceId:'source-1',createdAt:'2026-11-19T01:00:00.000Z'};
const second={id:'receipt-2',title:'商品二',sourceId:'source-2',createdAt:'2026-11-19T02:00:00.000Z'};
test('notification state persists, isolates accounts, ignores status changes and keeps later arrivals unread',()=>{
 const dir=mkdtempSync(join(tmpdir(),'notifications-'));
 try{
  let state=new LocalizationNotifications(dir);
  assert.equal(state.list('one',[first]).unreadCount,1);
  assert.equal(state.markRead('one',[first],{ids:[first.id]}).unreadCount,0);
  state=new LocalizationNotifications(dir);
  assert.equal(state.list('one',[first,second]).unreadCount,1);
  assert.equal(state.list('two',[first,second]).unreadCount,2);
  assert.equal(state.markRead('one',[first,second],{ids:[first.id]}).unreadCount,1);
  assert.throws(()=>state.markRead('two',[second],{ids:[first.id]}),/消息不存在/);
  assert.throws(()=>state.markRead('one',[first],{all:true,ids:[]}),/请选择/);
  assert.throws(()=>state.markRead('one',[first],{ids:['../../path']}),/消息不存在/);
  assert.equal(state.markRead('one',[first,second],{all:true}).unreadCount,0);
  const third={...second,id:'third'};assert.equal(state.list('one',[first,second,third]).unreadCount,1);
  assert.equal(state.list('one',[first]).items[0].href,'/tools/publishing?source=source-1');
  const files=readdirSync(join(dir,'notification-state'));assert.ok(files.every(file=>statSync(join(dir,'notification-state',file)).mode%512===384));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('browser and development notification routes share persistent owner state and require the existing administrator identity',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'notification-http-')),owner='admin@fixture.test';
 const session={userId:'fixture-user',id:'session',kind:'DEV',expiresAt:new Date(Date.now()+60000),user:{email:owner,role:'ADMIN'}};
 @Module({controllers:[LocalizationReceiptsController,LocalizationReceiptsDevelopmentController],providers:[LocalizationGuard,DevelopmentGuard,{provide:LocalizationService,useValue:{engine:{dir}}},{provide:LocalizationIntegrationService,useValue:{listForOwner:(email:string)=>({records:email===owner?[first,second]:[]})}},{provide:Auth,useValue:{session:async(req:any)=>req.cookies?.fixture==='admin'?session:req.cookies?.fixture==='viewer'?{...session,user:{...session.user,role:'VIEWER'}}:null}},{provide:Database,useValue:{session:{findUnique:async()=>session},user:{findUniqueOrThrow:async()=>({email:owner})}}}]})
 class Fixture{}
 const app=await NestFactory.create(Fixture,{logger:false});app.use(require('express').json());app.use(cookieParser());app.setGlobalPrefix('api/v1');await app.listen(0,'127.0.0.1');
 const base=(await app.getUrl())+'/api/v1';
 const call=(path:string,method='GET',body?:unknown,headers:Record<string,string>={cookie:'fixture=admin'})=>fetch(base+path,{method,headers:{...headers,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
 try{
  const browser='/localization/receipts/notifications',dev='/development/localization/imports/notifications';
  assert.equal((await call(browser,'GET',undefined,{})).status,401);
  assert.equal((await call(browser,'GET',undefined,{cookie:'fixture=viewer'})).status,401);
  assert.equal((await call(browser+'/read','POST',{all:true},{})).status,401);
  assert.equal((await(await call(browser)).json()).unreadCount,2);
  assert.equal((await call(browser+'/read','POST',{ids:[first.id]})).status,201);
  const token={authorization:'Bearer fixture_dev_token_1234567890'};
  assert.equal((await(await call(dev,'GET',undefined,token)).json()).unreadCount,1);
  assert.equal((await call(dev+'/read','POST',{all:true},token)).status,201);
  assert.equal((await(await call(browser)).json()).unreadCount,0);
  assert.equal((await call(browser+'/read','POST',{ids:['not-owned']})).status,400);
  assert.equal(integrationServerRequest({method:'POST',path:'/api/v1/development/localization/imports/notifications/read',headers:{authorization:token.authorization}} as any),true);
  assert.equal(integrationServerRequest({method:'POST',path:'/api/v1/development/localization/imports/notifications/read',headers:{authorization:token.authorization,cookie:'fixture=admin'}} as any),false);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
