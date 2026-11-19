import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {once} from 'node:events';
import {createTeamApp} from '../src/team-main';
test('local team gateway hides remote bearer and blocks other hosts/origins and admin routes',async()=>{
 process.env.NODE_ENV='test';let remoteCalls=0;
 const provider=createServer(async(req,res)=>{remoteCalls++;let raw='';for await(const c of req)raw+=c;res.setHeader('content-type','application/json');
  if(req.url==='/api/v1/development/login'){assert.equal(JSON.parse(raw).email,'dev@local.test');res.end(JSON.stringify({token:'private-fixture-bearer',expiresIn:3600}));return;}
  if(req.url==='/api/v1/auth/login'){assert.equal(req.headers.origin,process.env.TEAM_API_ORIGIN);assert.equal(req.headers.authorization,undefined);res.setHeader('set-cookie','yz_session=private-fixture-web; HttpOnly');res.end('{}');return;}
  if(req.url==='/api/v1/audit-logs'){assert.equal(req.headers.cookie,'yz_session=private-fixture-web');assert.equal(req.headers.authorization,undefined);res.end(JSON.stringify([{id:'audit-1',action:'SHOP_VERIFY',target:'assigned-shop',result:'SUCCESS',createdAt:'2026-11-17T00:00:00Z',internal:'must-not-expose'}]));return;}
  assert.equal(req.headers.authorization,'Bearer private-fixture-bearer');assert.equal(req.headers.cookie,undefined);
  res.end(JSON.stringify(req.url?.endsWith('/me')?{email:'dev@local.test',role:'ADMIN'}:[{id:'assigned-shop'}]));
 });provider.listen(0,'127.0.0.1');await once(provider,'listening');process.env.TEAM_API_ORIGIN=`http://127.0.0.1:${(provider.address() as {port:number}).port}`;
 const app=await createTeamApp();await app.listen(0,'127.0.0.1');const base=await app.getUrl();
 const headers={host:new URL(base).host,origin:'http://127.0.0.1:3100','Content-Type':'application/json'};
 try{
  const health=await (await fetch(base+'/api/v1/health',{headers})).json();assert.equal(health.mode,'team-local');assert.equal(health.managementOrigin,process.env.TEAM_API_ORIGIN);assert.ok(!JSON.stringify(health).includes('private-fixture'));
  const previousMode=process.env.LOCALIZATION_LOCAL_MODE;try{process.env.LOCALIZATION_LOCAL_MODE='true';assert.equal((await (await fetch(base+'/api/v1/health',{headers})).json()).localizationWriteEnabled,false);process.env.LOCALIZATION_LOCAL_MODE='false';assert.equal((await (await fetch(base+'/api/v1/health',{headers})).json()).localizationWriteEnabled,true);}finally{if(previousMode===undefined)delete process.env.LOCALIZATION_LOCAL_MODE;else process.env.LOCALIZATION_LOCAL_MODE=previousMode;}
  assert.equal((await fetch(base+'/api/v1/auth/me',{headers})).status,401);assert.equal(remoteCalls,0);
  assert.equal((await fetch(base+'/api/v1/audit-logs',{headers})).status,401);assert.equal(remoteCalls,0);
  assert.equal((await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{...headers,origin:'https://attacker.test'},body:'{}'})).status,403);
  const hostStatus=await new Promise<number|undefined>((resolve,reject)=>{const r=httpRequest(base+'/api/v1/health',{headers:{Host:'attacker.test'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);r.end();});assert.equal(hostStatus,403);
  const login=await fetch(base+'/api/v1/auth/login',{method:'POST',headers,body:JSON.stringify({email:'dev@local.test',password:'fixture-password'})});assert.equal(login.status,201);assert.ok(!(await login.text()).includes('bearer'));
  const cookie=login.headers.get('set-cookie')!;assert.ok(cookie.includes('HttpOnly'));assert.ok(!cookie.includes('private-fixture'));
  const read=await fetch(base+'/api/v1/development/shops',{headers:{...headers,cookie:cookie.split(';')[0]}});assert.equal(read.status,200);assert.ok((await read.text()).includes('assigned-shop'));
  const productUrl=base+'/api/v1/development/shops/assigned-shop/read/get_item_list?offset=0&page_size=20';
  const readHeaders={...headers,cookie:cookie.split(';')[0]};const beforeProducts=remoteCalls;
  await Promise.all([fetch(productUrl,{headers:readHeaders}),fetch(productUrl,{headers:readHeaders})]);assert.equal(remoteCalls,beforeProducts+1);
  await fetch(productUrl,{headers:readHeaders});assert.equal(remoteCalls,beforeProducts+1);
  await fetch(productUrl,{headers:{...readHeaders,'Cache-Control':'no-cache'}});assert.equal(remoteCalls,beforeProducts+2);
  const audit=await fetch(base+'/api/v1/audit-logs',{headers:{...headers,cookie:cookie.split(';')[0]}});assert.equal(audit.status,200);const logs=await audit.json();assert.equal(logs[0].id,'audit-1');assert.equal(logs[0].internal,undefined);assert.ok(!JSON.stringify(logs).includes('private-fixture'));
  assert.equal((await fetch(base+'/api/v1/shopee/apps',{headers})).status,404);
 }finally{await app.close();provider.close();await once(provider,'close');}
});
