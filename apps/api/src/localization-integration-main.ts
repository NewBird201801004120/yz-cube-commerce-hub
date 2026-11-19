import {VideoSettingsController,VideoSettingsService} from './tools/short-video/settings';
/** Production entry for machine imports and the matching authenticated review workspace. */
import {SelectionController} from './tools/selection/controller';
import {SelectionService} from './tools/selection/selection';
import 'reflect-metadata';
import {Module,Controller,Get,Put,Post,Body,Param,UseGuards,Catch,HttpException,type ExceptionFilter,type ArgumentsHost,type INestApplication} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {json,type Request,type Response,type NextFunction} from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import {randomUUID} from 'node:crypto';
import {isAbsolute} from 'node:path';
import {Config} from './config';
import {Database} from './database';
import {Auth} from './auth';
import {Shops} from './shops';
import {ShopeeClient,PlatformError,PlatformWriteError,safePlatformDiagnostic} from './shopee-client';
import {ListingService} from './listing';
import {LocalizationController,LocalizationGuard,LocalizationService} from './localization';
import {LocalizationPlatform} from './localization-platform';
import {LocalizationIntegrationController,LocalizationIntegrationGuard,LocalizationIntegrationService,integrationServerRequest} from './localization-integration';
import {LocalizationReceiptsController,LocalizationReceiptsDevelopmentController} from './localization-receipts';
import {DevelopmentGuard} from './development';

@Controller('localization')
export class LocalizationIntegrationHealth {
 @Get('health') health(){return {ok:true,service:'localization-integration',version:1};}
}

// Reuse AI settings without registering Listing generation/job controllers.
@Controller('settings/ai')
@UseGuards(LocalizationGuard)
export class LocalizationAISettings {
 constructor(private listing:ListingService){}
 @Get() settings(){return this.listing.settings();}
 @Put() configure(@Body() body:unknown){return this.listing.configure(body);}
 @Post('models/:kind') models(@Param('kind') kind:string,@Body() body:unknown){return this.listing.models(kind,body);}
 @Post('test/:kind') test(@Param('kind') kind:string){return this.listing.test(kind);}
}

@Catch()
export class LocalizationIntegrationErrors implements ExceptionFilter {
 catch(error:unknown,host:ArgumentsHost){
  const response=host.switchToHttp().getResponse<Response>();
  const platform=error instanceof PlatformError||error instanceof PlatformWriteError;
  const status=error instanceof HttpException?error.getStatus():platform?502:500;
  const message=error instanceof HttpException?error.message:platform?'平台请求未完成，请检查连接状态后重试':'服务暂时不可用';
  const diagnostic=safePlatformDiagnostic(platform?error.diagnostic:undefined);
  const details=error instanceof HttpException?error.getResponse():undefined;
  const fields=details&&typeof details==='object'?(details as {fieldErrors?:unknown}).fieldErrors:undefined;
  const fieldErrors=Array.isArray(fields)?fields.filter(v=>v&&typeof v.field==='string'&&typeof v.message==='string').slice(0,500).map(v=>({field:v.field.slice(0,200),message:v.message.slice(0,500)})):undefined;
  response.status(status).json({...(fieldErrors?{fieldErrors}:{}),code:error instanceof PlatformError?error.code:`HTTP_${status}`,message,requestId:response.getHeader('X-Request-Id'),...(diagnostic?{diagnostic}:{})});
 }
}

@Module({controllers:[VideoSettingsController,SelectionController,LocalizationIntegrationHealth,LocalizationIntegrationController,LocalizationController,LocalizationReceiptsController,LocalizationReceiptsDevelopmentController,LocalizationAISettings],providers:[VideoSettingsService,SelectionService,Config,Database,Auth,Shops,ShopeeClient,ListingService,LocalizationPlatform,LocalizationService,LocalizationGuard,LocalizationIntegrationGuard,LocalizationIntegrationService,DevelopmentGuard]})
export class LocalizationIntegrationModule {}

export function configureIntegrationHttp(app:INestApplication,webOrigin:string){
 app.use(json({limit:'12mb'}));app.use(cookieParser());app.use(helmet({contentSecurityPolicy:false}));
 app.use((request:Request,response:Response,next:NextFunction)=>{
  response.setHeader('X-Request-Id',randomUUID());response.setHeader('Cache-Control','no-store');
  if(!['GET','HEAD','OPTIONS'].includes(request.method)&&request.headers.origin!==webOrigin&&!integrationServerRequest(request)){
   response.status(403).json({code:'HTTP_403',message:'请求来源不允许',requestId:response.getHeader('X-Request-Id')});return;
  }
  next();
 });
 app.setGlobalPrefix('api/v1');app.useGlobalFilters(new LocalizationIntegrationErrors());
}

export async function createLocalizationIntegrationApp(){
 for(const key of ['LOCALIZATION_DATA_DIR','LISTING_DATA_DIR','LOCALIZATION_INTEGRATIONS_FILE'])if(!process.env[key]||!isAbsolute(process.env[key]!))throw new Error('Configure absolute persistent paths for localization integration');
 const app=await NestFactory.create(LocalizationIntegrationModule,{logger:['error','warn']});
 configureIntegrationHttp(app,app.get(Config).webOrigin);app.enableShutdownHooks();return app;
}

if(require.main===module)createLocalizationIntegrationApp().then(app=>app.listen(4111,'127.0.0.1')).catch(()=>{console.error('本地化接入服务启动失败，请检查服务端配置');process.exitCode=1;});
