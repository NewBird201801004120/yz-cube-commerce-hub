'use client';
import {useMemo,useState} from 'react';
import {Button} from '@/components/ui/button';
import {ProductImage} from '@/components/product-image';
import {jobStatus,type ListingJob} from '@/lib/listing';
import styles from './tasks.module.css';

type ListedJob=ListingJob&{thumbnailUrl?:string};
type Props={jobs:ListedJob[];loading:boolean;ready:boolean;onRefresh:()=>void;onCreate:()=>void;onOpen:(job:ListingJob)=>void};
export function ListingTaskList({jobs,loading,ready,onRefresh,onCreate,onOpen}:Props){
 const [query,setQuery]=useState(''),[status,setStatus]=useState('');
 const filtered=useMemo(()=>jobs.filter(job=>(!query.trim()||`${job.name} ${job.sku||''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))&&(!status||job.status===status)),[jobs,query,status]);
 return <>
  <section className="card connect-panel"><div><h2>商品组图</h2></div><div className="connect-actions"><Button variant="outline" disabled={loading} onClick={onRefresh}>{loading?'刷新中…':'刷新列表'}</Button><Button onClick={onCreate}>创建组图</Button></div></section>
  <section className={`card ${styles.list}`} aria-busy={loading}>
   <div className={styles.filters}><label>搜索<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="商品名称或 SKU"/></label><label>状态<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部状态</option>{Object.entries(jobStatus).map(([value,title])=><option key={value} value={value}>{title}</option>)}</select></label><span className="muted">共 {filtered.length} 个任务</span></div>
   {!ready&&!jobs.length?<div className="empty" role="status">{loading?'正在读取组图任务…':'任务列表暂未加载，请刷新重试。'}</div>:!filtered.length?<div className="empty"><h3>{jobs.length?'没有找到匹配的任务':'还没有组图任务'}</h3>{jobs.length?<p className="muted">调整搜索内容或状态后重试。</p>:<Button variant="outline" onClick={onCreate}>创建组图</Button>}</div>:<div className="table-scroll"><table className={styles.table}><thead><tr><th>商品</th><th>市场与语言</th><th>状态</th><th>已生成</th><th>创建时间</th><th className={styles.actions}>操作</th></tr></thead><tbody>{filtered.map(job=>{const active=['planning','running','stopping'].includes(job.status),cover=job.thumbnailUrl||job.slots?.find(slot=>slot.imageUrl)?.imageUrl;return <tr key={job.id}><td><div className={styles.product}><ProductImage src={cover} alt={job.name} className={styles.thumbnail}/><div><button className={styles.name} onClick={()=>onOpen(job)}>{job.name||'未命名商品'}</button>{job.sku&&<small className="muted">{job.sku}</small>}</div></div></td><td>{job.market}<small className={styles.secondary}>{job.language}</small></td><td><span className={`badge ${job.status==='done'?'good':active?'warn':''}`} role={active?'status':undefined}>{active&&<i className={styles.dot}/>} {jobStatus[job.status]||'状态待确认'}</span>{job.error&&<small className={styles.failure}>请进入详情查看原因</small>}</td><td>{job.completed}/{job.total||'—'} 张</td><td><time dateTime={job.createdAt}>{new Date(job.createdAt).toLocaleString('zh-CN',{hour12:false})}</time></td><td className={styles.actions}><Button variant="outline" onClick={()=>onOpen(job)}>查看详情</Button></td></tr>;})}</tbody></table></div>}
  </section>
 </>;
}
