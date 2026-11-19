'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {errorMessage} from '@/lib/api';
import {localizationApi as client,marketLanguageName,publishStatus,type MarketDraft,type PublishJob,type LocalizationReceipt,type LocalizationReceipts} from '@/lib/localization';
import styles from './localization.module.css';
const listPublishStatus:Record<string,string>={...publishStatus,created:'已创建，待补全',uncertain:'结果待核对'};
const statusText={received:'待审核',localizing:'正在翻译',awaiting_review:'待核对',localization_failed:'翻译未完成'};
type Props={onRefresh?:()=>Promise<void>;drafts?:MarketDraft[];jobs?:PublishJob[];onSelect?:(draft:MarketDraft)=>void;busy:boolean;dirty:boolean;onOpen:(id:string)=>Promise<void>;onRecords:(records:LocalizationReceipt[])=>void};
export default function ReceiptsPanel({busy,dirty,onOpen,onRecords,drafts=[],jobs=[],onSelect,onRefresh}:Props){
 const [data,setData]=useState<LocalizationReceipts|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[pending,setPending]=useState(''),[query,setQuery]=useState(''),[filter,setFilter]=useState('all');
 const state=useRef(data),alive=useRef(false),reading=useRef(false),retrying=useRef(false),notify=useRef(onRecords);
 notify.current=onRecords;state.current=data;
 async function refresh(){
  if(reading.current)return;reading.current=true;
  try{const result=await client.receipts();if(alive.current){setData(result);state.current=result;setError('');notify.current(result.environment!=='team'?result.records:[]);}}
  catch(e){if(alive.current)setError(`记录刷新失败，已显示最近读取的内容。${errorMessage(e)}`);}
  finally{reading.current=false;if(alive.current)setLoading(false);}
 }
 useEffect(()=>{alive.current=true;void refresh();const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},10000);const onFocus=()=>void refresh();window.addEventListener('focus',onFocus);return()=>{alive.current=false;window.clearInterval(timer);window.removeEventListener('focus',onFocus);};},[]);
 async function retry(id:string){if(retrying.current||dirty||busy)return;retrying.current=true;setPending(id);setError('');try{const row=await client.retryReceipt(id);if(alive.current){const previous=state.current;if(previous){const next={...previous,records:previous.records.map(r=>r.id===row.id?row:r)};state.current=next;setData(next);notify.current(next.environment!=='team'?next.records:[]);}await refresh();}}catch(e){if(alive.current)setError(`翻译未完成：${errorMessage(e)}`);}finally{retrying.current=false;if(alive.current)setPending('');}}
 const records=(data?.records||[]).map(receipt=>({receipt,draft:drafts.find(d=>d.id===receipt.draftId)}));
 const matched=new Set(records.map(r=>r.receipt.draftId));
 const rows:{receipt?:LocalizationReceipt;draft?:MarketDraft}[]=[...records,...drafts.filter(d=>!matched.has(d.id)).map(draft=>({draft}))];
 const visible=rows.map(row=>{
  const {receipt,draft}=row,id=draft?.id||receipt!.draftId;
  const job=[...jobs.filter(j=>j.draftId===id)].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]||receipt?.publishTasks[0];
  const failed=receipt?.status==='localization_failed'||job?.status==='failed'||job?.status==='uncertain'||job?.status==='created';
  return {...row,id,job,failed,title:draft?.title||receipt?.title||'待处理商品',shop:draft?.shop.shopName||receipt?.shopName||draft?.shop.shopId||'目标店铺',language:marketLanguageName(draft?.shop.region||receipt!.country,draft?.language||receipt!.language),updatedAt:draft?.updatedAt||receipt!.createdAt};
 }).filter(row=>(filter==='all'||(filter==='attention'?row.failed:filter==='published'?row.job?.status==='succeeded':!row.failed&&row.job?.status!=='succeeded'))&&`${row.title} ${row.shop} ${row.receipt?.sourceProductId||''}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
 return <section aria-label="商品记录" className={`card ${styles.panel}`}>
  <div className={styles.heading}><div><h2>商品记录 <span className={styles.subtle}>{rows.length}</span></h2></div><div className={styles.actions}><span className={`${styles.syncStatus} ${error?styles.syncError:''}`}>{error?'同步中断':loading?'正在读取':'自动更新'}</span><Button variant="outline" disabled={loading||!!pending||busy} onClick={()=>{setLoading(true);void Promise.all([refresh(),onRefresh?.()]);}}>{loading?'正在刷新…':'刷新'}</Button></div></div>
  {data?.environment==='local'&&<p className={styles.notice}>测试模式：使用模拟店铺，商品不会发布到 Shopee。</p>}
  <div className={styles.recordFilters}><label><span>搜索</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="商品名称、店铺或来源编号"/></label><label><span>状态</span><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">全部</option><option value="pending">待处理</option><option value="attention">需要处理</option><option value="published">已发布</option></select></label></div>
  {error&&<p role="alert" className="message error">{error}</p>}
  <div className="table-scroll"><table className={styles.recordsTable} aria-label="商品记录"><thead><tr><th>商品</th><th>目标店铺</th><th>目标语言</th><th>文案</th><th>发布状态</th><th>更新时间</th><th className={styles.operation}>操作</th></tr></thead><tbody>{visible.map(({receipt,draft,id,title,shop,language,job,updatedAt})=>{
   const remote=data?.environment==='team',published=!!job&&(!!job.remoteId||['preparing','creating','uncertain','created','completing','succeeded'].includes(job.status));
   return <tr key={receipt?.id||id}><td><strong>{title}</strong></td><td data-label="目标店铺">{shop}</td><td data-label="目标语言">{language}</td><td data-label="文案"><span className={`badge ${receipt?.status==='localization_failed'?'warn':''}`}>{receipt?statusText[receipt.status]:'已保存'}</span>{receipt?.localizationError&&<details className={styles.readonly}><summary>查看原因</summary><p className="error">{receipt.localizationError}</p></details>}</td><td data-label="发布状态"><span className={`badge ${job?.status==='succeeded'?'good':job&&['failed','uncertain','created'].includes(job.status)?'warn':''}`}>{job?listPublishStatus[job.status]||job.status:'未发布'}</span></td><td data-label="更新时间">{new Date(updatedAt).toLocaleString('zh-CN',{hour12:false})}</td><td className={styles.operation}><div className={styles.actions}>{receipt&&!remote&&receipt.status==='localization_failed'&&!published&&<Button variant="outline" disabled={busy||dirty||!!pending} onClick={()=>void retry(receipt.id)}>{pending===receipt.id?'正在提交…':'重新翻译'}</Button>}<Button variant="outline" disabled={busy||dirty||!!pending||receipt?.status==='localizing'} onClick={()=>draft&&onSelect?onSelect(draft):receipt?void onOpen(receipt.id):undefined}>{busy?'正在处理…':'查看详情'}</Button></div></td></tr>;
  })}</tbody></table></div>
  {!visible.length&&<div className="empty"><h3>{loading?'正在读取记录…':query||filter!=='all'?'没有符合条件的记录':error?'暂时无法读取记录':'等待接收商品'}</h3><p>{query||filter!=='all'?'调整搜索或状态筛选。':!error&&!loading?'仿真平台提交后，商品会自动显示在这里。':''}</p>{(query||filter!=='all')&&<Button variant="outline" onClick={()=>{setQuery('');setFilter('all');}}>清除筛选</Button>}</div>}
  {dirty&&<p className={styles.subtle}>有未保存修改，请先保存。</p>}
 </section>;
}
