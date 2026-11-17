import {spawn,spawnSync} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {createServer} from 'node:net';
const root=resolve(import.meta.dirname,'..');process.chdir(root);
if(Number(process.versions.node.split('.')[0])<22)throw Error('请先安装 Node.js 22 或更新版本');
const windows=process.platform==='win32';
const command=spawnSync(windows?'pnpm.cmd':'pnpm',['--version'],{encoding:'utf8',shell:windows});
const bin=command.status===0?(windows?'pnpm.cmd':'pnpm'):'corepack';
const prefix=bin==='corepack'?['pnpm']:[];
function run(args){const r=spawnSync(bin,[...prefix,...args],{cwd:root,stdio:'inherit',shell:windows});if(r.error||r.status!==0)throw Error('启动失败；请安装 pnpm 9.12.0 后重试');}
for(const port of [3100,4100])await new Promise((ok,fail)=>{const s=createServer();s.once('error',()=>fail(Error(`端口 ${port} 已占用，请先停止其他本地服务`)));s.listen(port,'127.0.0.1',()=>s.close(ok));});
if(existsSync('.env.team'))process.loadEnvFile('.env.team');
process.env.TEAM_API_ORIGIN||='https://commerce.aicbec.cn';
// Local simulation imports use a separate token, local fixture shop and local draft store.
// Only team login itself continues to use the configured central identity provider.
const integrationDir=resolve(root,'.local/localization-integration');mkdirSync(integrationDir,{recursive:true,mode:0o700});chmodSync(integrationDir,0o700);
const clientFile=resolve(integrationDir,'local-simulation-client.json'),deliveryFile=resolve(integrationDir,'local-simulation-delivery.txt');
if(existsSync(clientFile)!==existsSync(deliveryFile))throw Error('本地仿真接入凭据文件不完整，请联系项目维护者修复');
if(!existsSync(clientFile)){
 const credentials=readFileSync(resolve(root,'.local/shared-login.txt'),'utf8'),ownerEmail=credentials.match(/^账号：\s*(.+)$/m)?.[1]?.trim();
 if(!ownerEmail)throw Error('本地联调需要项目私密目录中的共享中台账号配置');
 const token=randomBytes(32).toString('base64url'),clients=[{id:'local-simulation',tokenSha256:createHash('sha256').update(token).digest('hex'),ownerEmail,sourceSystem:'simulation',shopScope:'all_connected',allowedShopIds:[],enabled:true}];
 const clientTmp=clientFile+'.tmp',deliveryTmp=deliveryFile+'.tmp';
 writeFileSync(clientTmp,JSON.stringify(clients,null,2)+'\n',{mode:0o600});writeFileSync(deliveryTmp,`本地仿真联调凭据（仅限本机开发环境）\nAPI_BASE=http://127.0.0.1:3100\nSOURCE_SYSTEM=simulation\nAuthorization: Bearer ${token}\n\n目标店铺通过 GET /api/v1/localization/integration/shops 查询。\n本地请求只写入 .local/localization；不会调用 Shopee 真实商品接口。\n`,{mode:0o600});renameSync(clientTmp,clientFile);renameSync(deliveryTmp,deliveryFile);
}
chmodSync(clientFile,0o600);chmodSync(deliveryFile,0o600);
process.env.LOCALIZATION_LOCAL_MODE='true';process.env.LOCALIZATION_DATA_DIR=resolve(root,'.local/localization');process.env.LISTING_DATA_DIR=resolve(root,'.local/listing');process.env.LOCALIZATION_INTEGRATIONS_FILE=clientFile;
run(['install','--frozen-lockfile']);run(['--filter','@yz-cube/api','db:generate']);run(['--filter','@yz-cube/api','build']);
const children=[];let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const p of children)p.kill('SIGTERM');setTimeout(()=>process.exit(code),1000).unref();}
// Compile API source changes as well as watching emitted JavaScript; otherwise
// newly added routes remain unavailable until the next full pnpm dev restart.
for(const [file,args] of [[bin,[...prefix,'--filter','@yz-cube/api','exec','tsc','-p','tsconfig.json','--watch','--preserveWatchOutput','--noEmitOnError']],[process.execPath,['--watch','apps/api/dist/team-main.js']],[bin,[...prefix,'--filter','@yz-cube/console','dev']]]){
 const p=spawn(file,args,{cwd:root,env:process.env,stdio:'inherit',shell:windows&&file!==process.execPath});children.push(p);p.on('error',()=>stop(1));p.on('exit',code=>stop(code||0));
}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
console.log('团队开发：http://127.0.0.1:3100/login — 使用共用中台账号；无需本地数据库或店铺密钥。');
