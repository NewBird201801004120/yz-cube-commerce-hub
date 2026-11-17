/** Isolated central-service entry for the explicitly authorized UNLIST smoke test.
 * It deliberately does not register the normal publish, complete or Listing controllers.
 */
import 'reflect-metadata';
import {Module,Controller,Get,Post,Param,Body,Req,UseGuards,ForbiddenException,BadRequestException,Catch,ExceptionFilter,ArgumentsHost,HttpException,type INestApplication} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {json,type Request,type Response,type NextFunction} from 'express';
import helmet from 'helmet';
import {isAbsolute} from 'node:path';
import {Config} from './config';
import {Database} from './database';
import {Auth,type AuthRequest} from './auth';
import {DevelopmentGuard} from './development';
import {Shops} from './shops';
import {ShopeeClient,PlatformError,PlatformWriteError,safePlatformDiagnostic} from './shopee-client';
import {LocalizationPlatform} from './localization-platform';

export const SAVE_ONLY_TEST_TITLE='API Integration Test - Not For Sale';
const allowedOperations=new Set(['capabilities','metadata','upload','create','save_variations','reconcile']);

@Controller('development/localization')
@UseGuards(DevelopmentGuard)
export class LocalizationSaveOnlyController {
 constructor(private platform:LocalizationPlatform,private db:Database){}
 @Post('shops/:id/:operation') async operation(@Req() req:AuthRequest,@Param('id') id:string,@Param('operation') operation:string,@Body() raw:unknown){
  if(!allowedOperations.has(operation))throw new ForbiddenException('此测试通道仅允许保存未上架商品，不开放上架或补全发布操作');
  if(!process.env.LOCALIZATION_SAVE_SHOP_ID||id!==process.env.LOCALIZATION_SAVE_SHOP_ID)throw new ForbiddenException('目标店铺不在本次保存测试范围');
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new BadRequestException('请求体必须为JSON对象');
  const body=raw as Record<string,any>;
  if(operation==='create'||operation==='save_variations'){
   const d=body.draft;
   if(!d||d.title!==SAVE_ONLY_TEST_TITLE||!Array.isArray(d.specificationNames)||d.specificationNames.length>2||!d.specificationNames.every((name:unknown)=>typeof name==='string'&&name.trim().length>0)||!Array.isArray(d.variants)||d.variants.length<1||d.variants.length>4||!d.variants.every((v:any)=>v&&typeof v.sku==='string'&&v.sku.startsWith('MOCK-NOT-FOR-SALE')&&v.sku.length<=100&&v.stock===0&&Array.isArray(v.options)&&v.options.length===d.specificationNames.length&&v.options.every((value:unknown)=>typeof value==='string'&&value.trim().length>0)&&Number.isFinite(v.price)&&v.price>0)||new Set(d.variants.map((v:any)=>v.sku)).size!==d.variants.length)throw new BadRequestException('仅允许本次指定的零库存测试商品，最多两个规格维度和四个唯一SKU');
   if(operation==='save_variations'&&(typeof body.remoteId!=='string'||!body.remoteId.trim()))throw new BadRequestException('补齐未上架规格需要已创建的远端商品编号');
  }
  const user=await this.db.user.findUniqueOrThrow({where:{id:req.userId},select:{email:true}});
  const ctx={owner:user.email,userId:req.userId};
  if(operation==='metadata'){
   if(Object.keys(body).some(key=>key!=='categoryId')||body.categoryId!==undefined&&(!Number.isSafeInteger(body.categoryId)||body.categoryId<=0))throw new BadRequestException('类目编号必须为正整数');
   return this.platform.metadata(ctx,id,body.categoryId);
  }
  return this.platform.operation(ctx,id,operation,body);
 }
}

@Controller('development/localization')
export class LocalizationSaveOnlyHealthController {
 @Get('health') health(){return {ok:true,mode:'save-unlisted-only',publishing:false};}
}

@Catch()
export class LocalizationSaveOnlyErrors implements ExceptionFilter {
 catch(error:unknown,host:ArgumentsHost){
  const platformError=error instanceof PlatformError||error instanceof PlatformWriteError;
  const status=error instanceof HttpException?error.getStatus():platformError?502:500;
  const message=error instanceof HttpException?error.message:platformError?'平台保存或读取未完成，请检查商品资料、店铺授权与接口权限':'保存测试未完成，请检查服务端配置';
  host.switchToHttp().getResponse<Response>().status(status).json({message,diagnostic:safePlatformDiagnostic(platformError?(error as {diagnostic?:unknown}).diagnostic:undefined)});
 }
}

@Module({controllers:[LocalizationSaveOnlyController,LocalizationSaveOnlyHealthController],providers:[Config,Database,Auth,DevelopmentGuard,Shops,ShopeeClient,LocalizationPlatform]})
export class LocalizationSaveOnlyModule {}

export function configureSaveOnlyHttp(app:INestApplication){
 app.use(json({limit:'12mb'}));app.use(helmet({contentSecurityPolicy:false}));
 app.use((req:Request,res:Response,next:NextFunction)=>{
  res.setHeader('Cache-Control','no-store');
  // This is a service-to-service test channel, not an additional browser auth surface.
  if(req.path!=='/api/v1/development/localization/health'&&(req.headers.origin||req.headers.cookie||!/^Bearer [A-Za-z0-9_-]{20,200}$/.test(req.headers.authorization||''))){res.status(401).json({message:'仅允许使用中台开发会话的服务端请求'});return;}
  next();
 });
 app.setGlobalPrefix('api/v1');app.useGlobalFilters(new LocalizationSaveOnlyErrors());
}

export async function createLocalizationSaveApp(){
 if(!/^[A-Za-z0-9_-]{1,150}$/.test(process.env.LOCALIZATION_SAVE_SHOP_ID||''))throw new Error('Configure the single authorized save-test shop');
 if(!process.env.LOCALIZATION_DATA_DIR||!isAbsolute(process.env.LOCALIZATION_DATA_DIR))throw new Error('Configure an absolute persistent data directory');
 const app=await NestFactory.create(LocalizationSaveOnlyModule,{logger:['error','warn']});
 configureSaveOnlyHttp(app);app.enableShutdownHooks();return app;
}

if(require.main===module)createLocalizationSaveApp().then(app=>app.listen(4110,'127.0.0.1')).catch(()=>{console.error('未上架保存测试服务启动失败，请检查专用配置');process.exitCode=1;});
