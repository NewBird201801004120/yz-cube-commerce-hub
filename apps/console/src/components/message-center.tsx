'use client';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {api,errorMessage} from '@/lib/api';
import {Button} from './ui/button';
import styles from './message-center.module.css';

type Message={id:string;title:string;createdAt:string;read:boolean;href:string};
type Messages={unreadCount:number;items:Message[]};
const endpoint='/localization/receipts/notifications';
export function MessageCenter({email}:{email:string}){
 const id=useId(),panel=useRef<HTMLDivElement>(null),closeButton=useRef<HTMLButtonElement>(null),readController=useRef<AbortController|null>(null);
 const [data,setData]=useState<Messages|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(''),[open,setOpen]=useState(false);
 const alive=useRef(false),reading=useRef(false),writing=useRef(false),sequence=useRef(0),seen=useRef<Set<string>|null>(null);
 const refresh=useCallback(async(manual=false)=>{
  if(reading.current||writing.current||!email)return;
  reading.current=true;const request=++sequence.current,controller=new AbortController();readController.current=controller;if(manual)setLoading(true);
  try{const next=await api<Messages>(endpoint,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});if(!alive.current||request!==sequence.current)return;
   if(seen.current&&next.items.some(item=>!seen.current!.has(item.id)))window.dispatchEvent(new Event('localization-receipts-updated'));
   seen.current=new Set(next.items.map(item=>item.id));setData(next);setError('');
  }catch(e){if(alive.current&&request===sequence.current)setError('消息暂未同步。'+errorMessage(e));}
  finally{if(request===sequence.current){reading.current=false;readController.current=null;if(alive.current)setLoading(false);}}
 },[email]);
 useEffect(()=>{alive.current=true;void refresh();const sync=()=>{if(document.visibilityState==='visible')void refresh();};const timer=setInterval(sync,15000);window.addEventListener('focus',sync);window.addEventListener('online',sync);document.addEventListener('visibilitychange',sync);return()=>{alive.current=false;++sequence.current;readController.current?.abort();readController.current=null;reading.current=false;clearInterval(timer);window.removeEventListener('focus',sync);window.removeEventListener('online',sync);document.removeEventListener('visibilitychange',sync);};},[refresh]);
 async function markRead(message?:Message){
  if(writing.current)return;writing.current=true;++sequence.current;readController.current?.abort();readController.current=null;reading.current=false;setLoading(false);setBusy(message?.id||'all');setError('');
  try{const next=await api<Messages>(endpoint+'/read',{method:'POST',body:JSON.stringify(message?{ids:[message.id]}:{all:true}),signal:AbortSignal.timeout(15000)});if(!alive.current)return;setData(next);if(message){panel.current?.hidePopover();window.location.assign(message.href);}}
  catch(e){if(alive.current)setError('已读状态未保存，请重试。'+errorMessage(e));}
  finally{writing.current=false;if(alive.current)setBusy('');}
 }
 const unread=data?.unreadCount||0;
 return <div className={styles.root}>
  <button type="button" className={styles.trigger} popoverTarget={id} aria-label={`消息${unread?`，${unread} 条未读`:''}${error?'，同步失败':''}`} aria-expanded={open} onClick={()=>void refresh(true)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg><span>消息</span>{unread>0&&<span className={styles.badge}>{unread>99?'99+':unread}</span>}{error&&<span className={styles.syncWarning} title="消息同步失败">!</span>}</button>
  <div id={id} popover="auto" ref={panel} className={styles.panel} onToggle={e=>{const visible=e.newState==='open';setOpen(visible);if(visible)closeButton.current?.focus();}} role="dialog" aria-labelledby={`${id}-title`}>
   <div className={styles.heading}><h2 id={`${id}-title`}>消息{unread>0&&<small>{unread} 条未读</small>}</h2><button ref={closeButton} type="button" className={styles.close} popoverTarget={id} popoverTargetAction="hide" aria-label="关闭消息">×</button></div>
   <div className={styles.toolbar}><span>仿真平台商品请求</span><div><Button variant="outline" disabled={loading||!!busy} onClick={()=>void refresh(true)}>{loading?'正在刷新…':'刷新'}</Button><Button variant="outline" disabled={!unread||!!busy||loading} onClick={()=>void markRead()}>{busy==='all'?'正在标记…':'全部已读'}</Button></div></div>
   {error&&<p className={styles.error} role="alert">{error}</p>}
   {!data&&!error&&<p className={styles.empty} role="status">正在读取消息…</p>}
   {data?.items.length===0&&<p className={styles.empty}>暂无消息</p>}
   {!!data?.items.length&&<ul className={styles.list}>{data.items.map(message=><li key={message.id}><button className={message.read?styles.read:styles.unread} disabled={!!busy} onClick={()=>void markRead(message)}><span className={styles.dot} aria-label={message.read?'已读':'未读'}/><span className={styles.content}><strong>{message.title}</strong><span>{busy===message.id?'正在打开…':'已接收商品，点击查看'}</span><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('zh-CN',{hour12:false})}</time></span><span aria-hidden="true">›</span></button></li>)}</ul>}
   <div className={styles.footer}><a href="/tools/publishing" onClick={()=>panel.current?.hidePopover()}>查看全部商品请求 →</a></div>
  </div>
 </div>;
}
