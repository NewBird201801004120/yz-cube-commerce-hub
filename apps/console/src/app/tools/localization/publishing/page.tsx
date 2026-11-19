'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Shell} from '@/components/shell';
import {Button} from '@/components/ui/button';
import {ProductImage} from '@/components/product-image';
import recordStyles from './publishing.module.css';
import {api,errorMessage} from '@/lib/api';
import {localizationApi as client,publishStatus,type PublishJob,type MarketDraft} from '@/lib/localization';
import styles from '../localization.module.css';
export default function PublishingPage(){
 const [email,setEmail]=useState(''),[jobs,setJobs]=useState<PublishJob[]>([]),[drafts,setDrafts]=useState<MarketDraft[]>([]),[error,setError]=useState(''),[syncError,setSyncError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[syncing,setSyncing]=useState(false),[lastSynced,setLastSynced]=useState(''),[query,setQuery]=useState(''),[status,setStatus]=useState('');
 const active=useRef(false),alive=useRef(true),sequence=useRef(0),ready=useRef(false);
 async function refresh(){
  const request=++sequence.current;
  const [next,versions]=await Promise.all([client.jobs(),client.drafts()]);
  if(!alive.current||request!==sequence.current)return;
  // Show the persisted task immediately; a slow remote status check must not hide the record.
  setJobs(next);setDrafts(versions);
  const results=await Promise.allSettled(next.map(job=>job.status==='created'&&job.remoteId?client.recover(job.id,'status'):Promise.resolve(job)));
  if(!alive.current||request!==sequence.current)return;
  setJobs(results.map((result,i)=>result.status==='fulfilled'?result.value:next[i]));
  const failed=results.find(result=>result.status==='rejected');
  setSyncError(failed?.status==='rejected'?`部分商品状态暂未更新，已保留上次结果。${errorMessage(failed.reason)}`:'');
  setLastSynced(new Date().toLocaleTimeString('zh-CN',{hour12:false}));
 }
 async function act(id:string,fn:()=>Promise<void>){
  if(active.current)return;active.current=true;setBusy(id);setError('');
  try{await fn();}catch(e){if(alive.current)setError(errorMessage(e));}
  finally{active.current=false;if(alive.current)setBusy('');}
 }
 async function sync(){
  if(!ready.current||active.current||document.visibilityState!=='visible')return;
  active.current=true;setSyncing(true);
  try{await refresh();}catch(e){if(alive.current)setSyncError(`自动更新暂未完成，已保留上次结果。${errorMessage(e)}`);}
  finally{active.current=false;if(alive.current)setSyncing(false);}
 }
 useEffect(()=>{
  alive.current=true;active.current=true;ready.current=false;
  void(async()=>{try{const me=await api<{email:string}>('/auth/me');if(!alive.current)return;setEmail(me.email);await refresh();}catch(e){if((e as {status?:number}).status===401)window.location.replace('/login');else if(alive.current)setError(errorMessage(e));}finally{active.current=false;ready.current=true;if(alive.current)setLoading(false);}})();
  const update=()=>void sync();window.addEventListener('focus',update);window.addEventListener('online',update);
  return()=>{alive.current=false;ready.current=false;sequence.current++;window.removeEventListener('focus',update);window.removeEventListener('online',update);};
 },[]);
 useEffect(()=>{const running=jobs.some(j=>['preparing','creating','completing'].includes(j.status));if(!running&&!jobs.some(j=>j.status==='created'&&j.remoteId))return;const timer=setInterval(()=>void sync(),running?3000:10000);return()=>clearInterval(timer);},[jobs]);
 const rows=jobs.filter(j=>{const d=j.draft||drafts.find(d=>d.id===j.draftId);return (!status||j.status===status)&&(!query||[d?.title,d?.shop.shopName,j.remoteId,j.id].some(v=>v?.toLowerCase().includes(query.trim().toLowerCase())));}).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 return <Shell email={email} active="publishing"><section className={`card ${styles.panel}`} aria-busy={loading||busy==='refresh'}>
  <div className={styles.heading}><h1>发布记录</h1><div className={styles.actions}>
   {lastSynced&&<span className={styles.subtle} title={`最近更新 ${lastSynced}`} role="status">{syncing?'正在更新状态…':syncError?'更新未完成':'自动更新'}</span>}
   <Link className="btn btn-outline" href="/tools/publishing">一键上架</Link><Link className="btn btn-outline" href="/tools/localization">商品本地化</Link>
   <Button variant="outline" disabled={!!busy||loading||syncing} onClick={()=>void act('refresh',refresh)}>{busy==='refresh'?'正在刷新…':'刷新状态'}</Button>
  </div></div>
  {error&&<p role="alert" className="message error">{error}</p>}{syncError&&<p role="status" className="message error">{syncError}</p>}
  <div className={styles.fields}><label><span>搜索</span><input type="search" placeholder="商品、店铺或商品 ID" value={query} onChange={e=>setQuery(e.target.value)}/></label><label><span>状态</span><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部</option>{Object.entries(publishStatus).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
  {loading?<p role="status">正在读取发布记录…</p>:rows.length===0?<p className="muted">{jobs.length?'没有符合条件的发布记录。':error?'暂时无法读取发布记录，请重试。':'暂无发布记录。'}</p>:<div className="table-scroll"><table><thead><tr><th>商品 / 店铺</th><th>状态 / 进度</th><th>虾皮商品 ID</th><th>更新时间</th><th style={{textAlign:'right'}}>操作</th></tr></thead><tbody>{rows.map(job=>{
   const d=job.draft||drafts.find(d=>d.id===job.draftId),pending=busy===job.id;
   return <tr key={job.id}><td><div className={recordStyles.productCell}><ProductImage className={recordStyles.thumbnail} src={d?.images[0]} alt={d?.title||'商品图片'}/><div><strong>{d?.title||'商品资料暂不可用'}</strong><p className={styles.subtle}>{d?.shop.shopName||'—'} · {d?.shop.region||'—'}</p></div></div></td>
    <td>{job.stage==='等待虾皮审核'?'等待虾皮审核':publishStatus[job.status]||job.status}<p className={styles.subtle}>{job.stage}</p>{job.error&&<p className={job.stage==='等待虾皮审核'?styles.subtle:'error'}>{job.error}</p>}</td><td>{job.remoteId||'尚未创建'}</td><td>{new Date(job.updatedAt).toLocaleString('zh-CN',{hour12:false})}</td>
    <td><div className={styles.actions}><Link className="btn btn-outline" href={`${d?.purpose==='original'?'/tools/publishing':'/tools/localization'}?draft=${encodeURIComponent(job.draftId)}&readonly=1&record=${encodeURIComponent(job.id)}`}>商品详情</Link>
     {job.status==='uncertain'&&<Button variant="outline" disabled={!!busy||syncing} onClick={()=>void act(job.id,async()=>{await client.recover(job.id,'reconcile');await refresh();})}>{pending?'正在核对…':'核对创建结果'}</Button>}
     {job.stage==='等待虾皮审核'&&<Button variant="outline" disabled={!!busy||syncing} onClick={()=>void act(job.id,async()=>{await client.recover(job.id,'status');await refresh();})}>{pending?'正在查询…':'查询审核结果'}</Button>}
     {(job.status==='failed'||job.status==='created'&&!!job.error&&job.stage!=='等待虾皮审核')&&<Button variant="outline" disabled={!!busy||syncing} onClick={()=>void act(job.id,async()=>{await client.recover(job.id,'resume');await refresh();})}>{pending?'正在处理…':job.remoteId?'继续完成上架':'重试发布'}</Button>}
    </div></td></tr>;
  })}</tbody></table></div>}
 </section></Shell>;
}
