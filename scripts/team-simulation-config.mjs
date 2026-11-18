import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync,chmodSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';

/** Server-side local integration setup; never read a developer's login/password file. */
export function configureLocalSimulation(root,env=process.env){
 const ownerEmail=env.LOCALIZATION_OWNER_EMAIL?.trim().toLowerCase();
 if(!ownerEmail||ownerEmail.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(ownerEmail))throw Error('请在 .env.team 或进程环境变量中配置有效的 LOCALIZATION_OWNER_EMAIL（用于登录中台的账号邮箱），参考 .env.team.example；无需配置登录密码。');
 const dir=resolve(root,'.local/localization-integration');
 const clientFile=resolve(dir,'local-simulation-client.json'),deliveryFile=resolve(dir,'local-simulation-delivery.txt');
 if(existsSync(clientFile)!==existsSync(deliveryFile))throw Error('本地仿真接入凭据文件不完整，请联系项目维护者修复');
 if(existsSync(clientFile)){
  const clients=JSON.parse(readFileSync(clientFile,'utf8'));
  if(!Array.isArray(clients)||clients.length!==1||clients[0]?.ownerEmail?.toLowerCase()!==ownerEmail)throw Error('LOCALIZATION_OWNER_EMAIL 与已有本地接入账号不一致；为保护已有草稿与令牌，请使用原归属邮箱，或由维护者迁移本地数据。');
 }else{
  mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
  const token=randomBytes(32).toString('base64url');
  const clients=[{id:'local-simulation',tokenSha256:createHash('sha256').update(token).digest('hex'),ownerEmail,sourceSystem:'simulation',shopScope:'all_connected',allowedShopIds:[],enabled:true}];
  const clientTmp=clientFile+'.tmp',deliveryTmp=deliveryFile+'.tmp';
  writeFileSync(clientTmp,JSON.stringify(clients,null,2)+'\n',{mode:0o600});
  writeFileSync(deliveryTmp,`本地仿真联调凭据（仅限本机开发环境）\nAPI_BASE=http://127.0.0.1:3100\nSOURCE_SYSTEM=simulation\nAuthorization: Bearer ${token}\n\n目标店铺通过 GET /api/v1/localization/integration/shops 查询。\n本地请求只写入 .local/localization；不会调用 Shopee 真实商品接口。\n`,{mode:0o600});
  renameSync(clientTmp,clientFile);renameSync(deliveryTmp,deliveryFile);
 }
 chmodSync(clientFile,0o600);chmodSync(deliveryFile,0o600);
 return clientFile;
}
