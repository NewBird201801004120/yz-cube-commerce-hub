import {BadRequestException,Body,Controller,Get,Injectable,Put,ServiceUnavailableException,UseGuards} from '@nestjs/common';
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {decrypt,encrypt} from '../../crypto';
import {LocalizationGuard} from '../../localization';

export type VideoSettings={baseUrl:string;analysisModel:string;videoModel:string;apiKey:string;ossRegion:string;ossBucket:string;ossAccessKeyId:string;ossAccessKeySecret:string};
const fields=['baseUrl','analysisModel','videoModel','apiKey','ossRegion','ossBucket','ossAccessKeyId','ossAccessKeySecret'] as const;
const regions=['cn-beijing','ap-southeast-1','ap-northeast-1','eu-central-1','us-east-1','cn-hongkong'];
const defaults:VideoSettings={baseUrl:'',analysisModel:'qwen-plus',videoModel:'wan3.0-video-prime',apiKey:'',ossRegion:'',ossBucket:'',ossAccessKeyId:'',ossAccessKeySecret:''};
/** Exact workspace hosts prevent API credentials being sent to arbitrary destinations. */
export function videoBaseUrl(value:string){
 let url:URL;try{url=new URL(value);}catch{throw new BadRequestException('请填写百炼工作空间服务地址');}
 const match=url.hostname.match(/^([a-z0-9]+(?:-[a-z0-9]+)*)\.([a-z0-9-]+)\.maas\.aliyuncs\.com$/);
 if(url.protocol!=='https:'||!match||!regions.includes(match[2])||url.port||url.username||url.password||url.search||url.hash||!/^\/api\/v1\/?$/.test(url.pathname))throw new BadRequestException('服务地址须为百炼工作空间的 HTTPS /api/v1 地址');
 return `${url.origin}/api/v1`;
}
function safeText(value:unknown,name:string,max=2048){if(typeof value!=='string'||value.length>max||/[\r\n\x00]/.test(value))throw new BadRequestException(`${name}格式无效`);return value.trim();}

@Injectable()
export class VideoSettingsService {
 readonly dir=resolve(process.env.VIDEO_SETTINGS_DATA_DIR||'.local/short-video-settings');
 private readSaved():VideoSettings|null{const file=join(this.dir,'config.enc');if(!existsSync(file))return null;try{const key=readFileSync(join(this.dir,'encryption.key'));if(key.length!==32)throw Error('invalid key');return JSON.parse(decrypt(readFileSync(file,'utf8'),key)) as VideoSettings;}catch{throw new ServiceUnavailableException('短视频配置无法读取，请检查服务端加密配置文件');}}
 private environment():VideoSettings{
  const e=process.env,base=e.WAN_BASE_URL||e.DASHSCOPE_BASE_URL||(e.WAN_WORKSPACE_ID&&e.WAN_REGION?`https://${e.WAN_WORKSPACE_ID}.${e.WAN_REGION}.maas.aliyuncs.com/api/v1`:'');
  return {...defaults,baseUrl:base,apiKey:e.DASHSCOPE_API_KEY||'',analysisModel:e.WAN_ANALYSIS_MODEL||'qwen-plus',videoModel:e.WAN_VIDEO_MODEL||'wan3.0-video-prime',ossRegion:e.OSS_REGION||'',ossBucket:e.OSS_BUCKET||'',ossAccessKeyId:e.OSS_ACCESS_KEY_ID||'',ossAccessKeySecret:e.OSS_ACCESS_KEY_SECRET||''};
 }
 private current(){return this.readSaved()||this.environment();}
 settings(){const c=this.current(),analysisConfigured=!!c.baseUrl&&!!c.apiKey&&!!c.analysisModel,storageConfigured=!!c.ossRegion&&!!c.ossBucket&&!!c.ossAccessKeyId&&!!c.ossAccessKeySecret;return {baseUrl:c.baseUrl,analysisModel:c.analysisModel,videoModel:c.videoModel,ossRegion:c.ossRegion,ossBucket:c.ossBucket,hasKey:!!c.apiKey,hasOssAccessKeyId:!!c.ossAccessKeyId,hasOssAccessKeySecret:!!c.ossAccessKeySecret,analysisConfigured,storageConfigured,configured:analysisConfigured&&storageConfigured&&!!c.videoModel};}
 configure(raw:unknown){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!fields.includes(k as typeof fields[number])))throw new BadRequestException('短视频配置格式无效');
  const input=raw as Record<string,unknown>,old=this.current(),next={...old};
  for(const key of fields)if(input[key]!==undefined){const value=safeText(input[key],key,key.includes('Model')?150:key==='baseUrl'?400:2048);if(!['apiKey','ossAccessKeyId','ossAccessKeySecret'].includes(key)||value)next[key]=value;}
  if(next.baseUrl)next.baseUrl=videoBaseUrl(next.baseUrl);
  const oldBase=old.baseUrl?videoBaseUrl(old.baseUrl):'';
  if(next.baseUrl!==oldBase&&!safeText(input.apiKey??'','API密钥'))throw new BadRequestException('服务地址变更后请重新填写 API 密钥');
  if(!next.baseUrl||!next.apiKey||!next.analysisModel||!next.videoModel)throw new BadRequestException('请填写百炼服务地址、API 密钥和模型');
  if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$/.test(next.analysisModel)||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$/.test(next.videoModel))throw new BadRequestException('模型名称格式无效');
  // Partial storage may be saved for analysis-only use, but generation checks all OSS fields.
  if(next.ossRegion&&!/^oss-[a-z0-9]+(?:-[a-z0-9]+)+$/.test(next.ossRegion))throw new BadRequestException('OSS 地域格式无效');
  if(next.ossBucket&&!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(next.ossBucket))throw new BadRequestException('OSS Bucket 格式无效');
  mkdirSync(this.dir,{recursive:true,mode:0o700});const keyPath=join(this.dir,'encryption.key');if(!existsSync(keyPath))writeFileSync(keyPath,randomBytes(32),{mode:0o600,flag:'wx'});const key=readFileSync(keyPath);if(key.length!==32)throw new ServiceUnavailableException('短视频加密配置无效');
  const temp=join(this.dir,`config.${randomUUID()}.tmp`);writeFileSync(temp,encrypt(JSON.stringify(next),key),{mode:0o600});renameSync(temp,join(this.dir,'config.enc'));return this.settings();
 }
 runtime(kind:'analysis'|'video'|'storage'='video'){
  const c=this.current();
  if(kind!=='storage'){if(!c.baseUrl||!c.apiKey||!c.analysisModel||!c.videoModel)throw new ServiceUnavailableException('请先到 AI 设置配置短视频的百炼服务');videoBaseUrl(c.baseUrl);}
  if(kind!=='analysis'&&(!c.ossRegion||!c.ossBucket||!c.ossAccessKeyId||!c.ossAccessKeySecret))throw new ServiceUnavailableException('请先到 AI 设置配置短视频的 OSS 存储');
  return c;
 }
}

@Controller('settings/ai/video')
@UseGuards(LocalizationGuard)
export class VideoSettingsController {
 constructor(private settingsService:VideoSettingsService){}
 @Get() settings(){return this.settingsService.settings();}
 @Put() configure(@Body() body:unknown){return this.settingsService.configure(body);}
}
