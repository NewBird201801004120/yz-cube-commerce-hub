import {spawn,spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {configureLocalSimulation} from './team-simulation-config.mjs';
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
// Validate environment and retain existing local integration tokens.
const clientFile=configureLocalSimulation(root);
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
