'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {errorMessage} from '@/lib/api';
import {localizationApi as client,marketLanguageName,type LocalizationReceipt,type LocalizationReceipts} from '@/lib/localization';
import styles from './localization.module.css';
const statusText={localizing:'正在生成文案',awaiting_review:'待运营审核',localization_failed:'文案生成未完成'};
export default function ReceiptsPanel({busy,dirty,onOpen,onRecords}:{busy:boolean;dirty:boolean;onOpen:(id:string)=>Promise<void>;onRecords:(records:LocalizationReceipt[])=>void}){
 const [data,setData]=useState<LocalizationReceipts|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[pending,setPending]=useState('');
 const state=useRef(data),alive=useRef(false),reading=useRef(false),retrying=useRef(false),notify=useRef(onRecords);
 notify.current=onRecords;state.current=data;
 async function refresh(){if(reading.current)return;reading.current=true;try{const result=await client.receipts();if(alive.current){setData(result);state.current=result;setError('');notify.current(result.environment!=='team'?result.records:[]);}}catch(e){if(alive.current){setData(null);state.current=null;notify.current([]);setError((e as {status?:number}).status===404?'当前服务尚未开通仿真接收记录，请在服务更新后刷新。':`接收记录读取失败：${errorMessage(e)}`);}}finally{reading.current=false;if(alive.current)setLoading(false);}}
 useEffect(()=>{alive.current=true;void refresh();const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh();},10000);const onFocus=()=>void refresh();window.addEventListener('focus',onFocus);return()=>{alive.current=false;window.clearInterval(timer);window.removeEventListener('focus',onFocus);};},[]);
 async function retry(id:string){if(retrying.current||dirty||busy)return;retrying.current=true;setPending(id);setError('');try{const row=await client.retryReceipt(id);if(alive.current){const previous=state.current;if(previous){const next={...previous,records:previous.records.map(r=>r.id===row.id?row:r)};state.current=next;setData(next);notify.current(next.environment!=='team'?next.records:[]);}await refresh();}}catch(e){if(alive.current)setError(`重新生成未完成：${errorMessage(e)}`);}finally{retrying.current=false;if(alive.current)setPending('');}}
 return <section aria-label="仿真接收记录" className={`card ${styles.panel}`}><div className={styles.heading}><h2>仿真接收记录{data?` · ${data.records.length} 条`:""}</h2><div className={styles.actions}><Button variant="outline" disabled={loading||!!pending} onClick={()=>void refresh()}>刷新接收记录</Button></div></div>
 <p className={styles.subtle}>仿真平台提交后自动生成目标市场文案，完成后打开草稿核对商品资料。生成文案不会发布商品。</p>
 {data?.environment==='local'&&<p className={styles.notice}>本地联调模式：接收记录、来源商品和市场草稿保存在本机；目标店铺为模拟数据，不会连接或写入虾皮真实店铺。</p>}
 {data?.environment==='team'&&<p className={styles.notice}>与生产同步的接收记录，每10秒自动刷新。接收记录保留，不提供删除操作；点击“打开本地草稿”接入完整资料；本地编辑独立保存。</p>}
 {error&&<p role="alert" className="error">{error}</p>}
 {loading?<p className="muted">正在读取接收记录…</p>:data&&!data.records.length?<p className="muted">暂无接收记录。仿真平台完成接口配置并提交商品后，将在这里显示。</p>:null}
 <div className={styles.stack}>{data?.records.map(row=>{const remote=data.environment==='team',published=row.publishTasks.some(task=>task.remoteId||['preparing','creating','uncertain','created','completing','succeeded'].includes(task.status));return <article className={styles.job} key={row.id} style={{overflowWrap:'anywhere'}}><div className={styles.heading}><strong>{row.title||row.sourceProductId}</strong><span role="status">{statusText[row.status]}</span></div><p>{row.shopName||'目标店铺'} · {marketLanguageName(row.country,row.language)}</p><p className={styles.subtle}>{row.sourceSystem} / {row.sourceProductId}<br/>接收时间：{new Date(row.createdAt).toLocaleString('zh-CN',{hour12:false})}<br/>请求编号：{row.requestId}</p>
 {row.status==='localizing'&&<p className={styles.subtle}>正在处理，请稍候。此页面会自动更新进度。</p>}{row.status==='awaiting_review'&&<p className={styles.subtle}>文案已生成，打开草稿查看最新结果并补齐市场信息。</p>}{row.localizationError&&<p className="error">{row.localizationError}</p>}{published&&<p className={styles.subtle}>此草稿已有发布任务，请在草稿中查看发布结果与恢复操作。</p>}
 <div className={styles.actions}>{!remote&&row.status==='localization_failed'&&!published&&<Button variant="outline" disabled={busy||dirty||!!pending} onClick={()=>void retry(row.id)}>{pending===row.id?'正在重新提交…':'重新生成文案'}</Button>}<Button variant="outline" disabled={busy||dirty||!!pending||row.status==='localizing'} onClick={()=>void onOpen(row.id)}>{busy?'正在处理…':remote?'打开本地草稿':'打开对应草稿'}</Button></div></article>;})}</div>{dirty&&<p className={styles.subtle}>当前草稿有未保存修改，请先保存，再切换草稿或重新生成文案。</p>}</section>;
}
