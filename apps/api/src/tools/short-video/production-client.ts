import {Injectable} from '@nestjs/common';
import {Database} from '../../database';
import {Auth,type AuthRequest} from '../../auth';
import {Shops} from '../../shops';
import {DevelopmentController} from '../../development';
/** Called only with the actor resolved by VideoService from the existing admin session. */
@Injectable()
export class ProductionVideoClient {
 private controller:DevelopmentController;
 constructor(db:Database,auth:Auth,shops:Shops){this.controller=new DevelopmentController(db,auth,shops);}
 read(actor:string,shopId:string,operation:string,query:Record<string,string>={}){return this.controller.read(shopId,operation,query,{userId:actor} as AuthRequest);}
 video(actor:string,shopId:string,operation:string,body:unknown){return this.controller.video(shopId,operation,body as Record<string,unknown>,{userId:actor} as AuthRequest);}
 async videoCapabilities(){return this.controller.videoCapabilities();}
}
