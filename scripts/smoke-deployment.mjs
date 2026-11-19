import assert from 'node:assert/strict';

// Read-only acceptance against the actual public gateway, including its split API routing.
const base=new URL(process.env.SMOKE_BASE||'http://127.0.0.1:3100').origin;
const email=process.env.SMOKE_EMAIL,password=process.env.SMOKE_PASSWORD;
if(!email||!password)throw Error('Set SMOKE_EMAIL and SMOKE_PASSWORD in the process environment; do not commit credentials.');
const request=(path,options={})=>fetch(base+path,{...options,redirect:'manual',signal:AbortSignal.timeout(30000)});
let cookie='';
async function get(path){const response=await request(path,{headers:{cookie}});assert.equal(response.status,200,`${path}: HTTP ${response.status}`);console.log(`PASS ${path}`);return response;}
try{
 const login=await request('/api/v1/auth/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({email,password})});
 assert.equal(login.status,201,'login failed');cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');assert.ok(cookie,'missing login cookie');
 for(const path of ['/api/v1/health','/api/v1/auth/me','/api/v1/shops','/api/v1/localization/receipts','/api/v1/localization/sources','/api/v1/localization/drafts','/api/v1/localization/jobs','/api/v1/listing/jobs','/api/v1/tools/short-video/jobs','/api/v1/settings/ai/video'])await get(path);
 const messages=await(await get('/api/v1/localization/receipts/notifications')).json();
 assert.ok(Number.isSafeInteger(messages.unreadCount)&&messages.unreadCount>=0&&Array.isArray(messages.items),'invalid message response');
 const anonymous=await request('/api/v1/localization/receipts/notifications');assert.equal(anonymous.status,401,'notification identity boundary failed');
 const assets=new Set();
 for(const path of ['/developer','/tools/publishing','/tools/localization','/tools/localization/publishing','/tools/listing','/tools/short-video','/tools/selection','/settings/ai','/channels/shops']){
  const html=await(await get(path)).text();for(const match of html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g))assets.add(match[1].replaceAll('&amp;','&'));
 }
 assert.ok(assets.size>0,'no built assets found');for(const path of assets)await get(path);
 const home=await request('/',{headers:{cookie}});assert.ok([200,307,308].includes(home.status),'home unavailable');
 console.log(`PASS deployment: ${base}; ${assets.size} built assets checked; no product or AI writes`);
}finally{
 if(cookie)await request('/api/v1/auth/logout',{method:'POST',headers:{origin:base,cookie,'content-type':'application/json'},body:'{}'}).catch(()=>{});
}
