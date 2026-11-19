import {BadRequestException} from '@nestjs/common';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

type ReceiptSummary={id:string;title:string;sourceId:string;createdAt:string};
/** Read receipts remain immutable. Only the account's read state is stored separately. */
export class LocalizationNotifications {
 constructor(private root:string){}
 private file(owner:string){const dir=join(this.root,'notification-state');mkdirSync(dir,{recursive:true,mode:0o700});return join(dir,createHash('sha256').update(owner).digest('hex')+'.json');}
 private read(owner:string):Set<string>{const file=this.file(owner);if(!existsSync(file))return new Set();const state=JSON.parse(readFileSync(file,'utf8'));if(!Array.isArray(state.readIds)||!state.readIds.every((id:unknown)=>typeof id==='string'))throw new Error('Invalid notification state');return new Set(state.readIds);}
 list(owner:string,records:ReceiptSummary[]){const read=this.read(owner);return {unreadCount:records.filter(r=>!read.has(r.id)).length,items:[...records].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).slice(0,50).map(r=>({id:r.id,title:r.title,createdAt:r.createdAt,read:read.has(r.id),href:'/tools/publishing?source='+encodeURIComponent(r.sourceId)}))};}
 markRead(owner:string,records:ReceiptSummary[],body:unknown){
  if(!body||typeof body!=='object'||Array.isArray(body))throw new BadRequestException('请选择需要标为已读的消息');
  const b=body as {ids?:unknown;all?:unknown};
  if(Object.keys(b).some(k=>k!=='ids'&&k!=='all')||!(b.all===true&&b.ids===undefined||b.all===undefined&&Array.isArray(b.ids)&&b.ids.length>0&&b.ids.length<=500&&b.ids.every(id=>typeof id==='string')))throw new BadRequestException('请选择需要标为已读的消息');
  const available=new Set(records.map(r=>r.id)),ids=b.all===true?[...available]:b.ids as string[];
  if(ids.some(id=>!available.has(id)))throw new BadRequestException('消息不存在，请刷新后重试');
  const read=this.read(owner);ids.forEach(id=>read.add(id));
  const file=this.file(owner),tmp=file+'.'+randomUUID()+'.tmp';
  writeFileSync(tmp,JSON.stringify({readIds:[...read].filter(id=>available.has(id))}),{mode:0o600});renameSync(tmp,file);
  return this.list(owner,records);
 }
}
