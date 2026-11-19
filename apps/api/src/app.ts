import {LocalizationCopySuggestionsController,LocalizationCopySuggestionsService} from './localization-copy-suggestions';
import {ListingSourceIntakeController,ListingSourceIntakeService} from './listing-source-intake';
import {LocalizationShopProductsController,LocalizationShopProductsService} from './localization-shop-products';
import {VideoController,VideoService} from './tools/short-video/video';
import {ProductionVideoClient} from './tools/short-video/production-client';
import {SelectionController} from './tools/selection/controller';
import {SelectionService} from './tools/selection/selection';
import {VideoSettingsController,VideoSettingsService} from './tools/short-video/settings';
import {LocalizationReceiptsController,LocalizationReceiptsDevelopmentController} from './localization-receipts';
import {LocalizationIntegrationController,LocalizationIntegrationService,LocalizationIntegrationGuard,integrationServerRequest} from './localization-integration';
import {json} from 'express';
import {LocalizationController,LocalizationService,LocalizationGuard} from './localization';
import {LocalizationPlatform,LocalizationDevelopmentController} from './localization-platform';
import {ListingController,ListingService,ListingGuard} from './listing';
import 'reflect-metadata';
import { Module, Controller, Get, Catch, ExceptionFilter, ArgumentsHost, HttpException } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type {NestExpressApplication} from '@nestjs/platform-express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { Config } from './config';
import { Database } from './database';
import { Auth, AdminGuard, AuthController } from './auth';
import { ShopeeClient, PlatformError, safePlatformDiagnostic } from './shopee-client';
import { Shops, ShopsController } from './shops';
import {DevelopmentController,DevelopmentGuard} from './development';
@Controller()
class HealthController { @Get('health') health(){return {ok:true,service:'yz-cube-api'};} }
@Catch()
class ErrorFilter implements ExceptionFilter {
  catch(error:unknown,host:ArgumentsHost){
    const res=host.switchToHttp().getResponse<Response>();
    const status=error instanceof HttpException?error.getStatus():error instanceof PlatformError?502:500;
    const message=error instanceof HttpException?error.message:error instanceof PlatformError?'平台请求未完成，请检查连接状态后重试':'服务暂时不可用';
    const diagnostic=safePlatformDiagnostic(error instanceof PlatformError?error.diagnostic:error instanceof HttpException?(error.getResponse() as {diagnostic?:unknown})?.diagnostic:undefined);
    res.status(status).json({diagnostic,code:error instanceof PlatformError?error.code:`HTTP_${status}`,message,requestId:res.getHeader('X-Request-Id')});
  }
}
@Module({imports:[ScheduleModule.forRoot()],controllers:[LocalizationCopySuggestionsController,ListingSourceIntakeController,LocalizationShopProductsController,VideoController,SelectionController,VideoSettingsController,LocalizationReceiptsController,LocalizationReceiptsDevelopmentController,HealthController,AuthController,ShopsController,DevelopmentController,ListingController,LocalizationController,LocalizationDevelopmentController,LocalizationIntegrationController],providers:[LocalizationCopySuggestionsService,ListingSourceIntakeService,LocalizationShopProductsService,VideoService,ProductionVideoClient,{provide:'VIDEO_SHOP_CLIENT',useExisting:ProductionVideoClient},SelectionService,VideoSettingsService,Config,Database,Auth,AdminGuard,ShopeeClient,Shops,DevelopmentGuard,ListingService,ListingGuard,LocalizationService,LocalizationGuard,LocalizationPlatform,LocalizationIntegrationService,LocalizationIntegrationGuard]})
export class AppModule {}
export async function createApp(){
  const app=await NestFactory.create<NestExpressApplication>(AppModule,{logger:['error','warn'],bodyParser:false});
  const config=app.get(Config);
  // Only the loopback reverse proxy is trusted to provide the client IP.
  if(process.env.NODE_ENV==='production')app.getHttpAdapter().getInstance().set('trust proxy','loopback');
  app.use('/api/v1/development/shops/:id/video/part',json({limit:'6mb'}));
  app.use('/api/v1/listing/jobs',json({limit:'30mb'}));app.use('/api/v1/localization',json({limit:'12mb'}));app.use('/api/v1/development/localization',json({limit:'12mb'}));app.use(json({limit:'100kb'}));app.use(helmet({contentSecurityPolicy:false}));app.use(cookieParser());
  app.use((req:Request,res:Response,next:NextFunction)=>{
    res.setHeader('X-Request-Id',randomUUID());res.setHeader('Cache-Control','no-store');
    // Cookie-authenticated mutations are accepted only from the first-party UI.
    const serverDevelopment=req.path.startsWith('/api/v1/development/')&&!req.headers.origin&&!req.headers.cookie&&(req.path==='/api/v1/development/login'||typeof req.headers.authorization==='string');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin!==config.webOrigin&&!serverDevelopment&&!integrationServerRequest(req)){res.status(403).json({message:'请求来源不允许'});return;}
    next();
  });
  app.setGlobalPrefix('api/v1');app.useGlobalFilters(new ErrorFilter());app.enableShutdownHooks();
  return app;
}
