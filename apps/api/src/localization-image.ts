import sharp from 'sharp';
import {BadRequestException} from '@nestjs/common';
/** Shopee rejected source WebP in a live upload; keep source assets unchanged. */
export async function shopeeUploadImage(data:Buffer):Promise<{bytes:Buffer;mime:string;filename:string}>{
 try{const info=await sharp(data,{limitInputPixels:40000000}).metadata();
  if(info.format==='webp'){const bytes=await sharp(data,{limitInputPixels:40000000}).flatten({background:'#ffffff'}).jpeg({quality:92}).toBuffer();if(bytes.length>8*1024*1024)throw Error();return {bytes,mime:'image/jpeg',filename:'product.jpg'};}
  if(info.format==='jpeg'||info.format==='png')return {bytes:data,mime:info.format==='png'?'image/png':'image/jpeg',filename:info.format==='png'?'product.png':'product.jpg'};
 }catch{}
 throw new BadRequestException('商品图片无效或转换后超过8MB，请重新上传');
}
