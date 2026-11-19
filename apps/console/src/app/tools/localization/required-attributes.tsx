'use client';
import {useEffect,useState} from 'react';
import {localizationApi,type MarketDraft,type MarketMetadata} from '@/lib/localization';
import {errorMessage} from '@/lib/api';
import {Button} from '@/components/ui/button';
import styles from './workspace.module.css';
const valueLabels:Record<string,string>={Yes:'是',No:'否',Mobile:'手机',Motor:'摩托车',Camera:'相机','PC & Laptop':'台式电脑与笔记本电脑',Others:'其他',Wireless:'无线',Wired:'有线','In Ear':'入耳式'};
const labels:Record<string,string>={'Gaming Focused':'是否为游戏耳机','Connection Type':'连接方式','Earphone, Headphone, & Headset Type':'耳机类型','Audio Compatibility':'兼容设备'};
export function RequiredAttributes({draft,disabled,onConfirm}:{draft:MarketDraft;disabled:boolean;onConfirm:(attributes:MarketDraft['attributes'])=>Promise<void>}){
 const [metadata,setMetadata]=useState<MarketMetadata|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const [choices,setChoices]=useState<Record<number,string>>({});
 useEffect(()=>setChoices({}),[draft.id,draft.categoryId]);
 useEffect(()=>{let active=true;setMetadata(null);setError('');if(!draft.categoryId)return;void localizationApi.metadata(draft.shop.id,draft.categoryId).then(data=>{if(active)setMetadata(data);}).catch(e=>{if(active)setError(errorMessage(e));});return()=>{active=false;};},[draft.shop.id,draft.categoryId,retry]);
 const missing=metadata?.attributes?.filter(a=>a.required&&!draft.attributes.some(v=>v.id===a.id&&v.values.length))||[];
 if(!draft.categoryId)return null;
 const confirmed=metadata?.attributes?.filter(a=>a.required&&draft.attributes.some(v=>v.id===a.id&&v.values.length))||[];
 return <div className={styles.requiredAttributes}><h3>商品必填属性</h3><p>已保存的属性持续显示；缺失项一次选齐后统一确认。</p>{confirmed.map(a=><div className={styles.fact} key={a.id}><span>{labels[a.name]||a.name}</span><strong>{draft.attributes.find(v=>v.id===a.id)!.values.map(v=>valueLabels[v.value]||v.value).join("、")} · 已保存</strong></div>)}{error?<div role="alert">{error} <Button variant="outline" disabled={disabled} onClick={()=>setRetry(v=>v+1)}>重试</Button></div>:!metadata?<p role="status">正在读取可选属性…</p>:missing.map(a=><label key={a.id}><span>{labels[a.name]||a.name}</span>{a.values?.length?<select value={choices[a.id]||''} disabled={disabled} onChange={e=>setChoices(current=>({...current,[a.id]:e.target.value}))}><option value="">请选择实际情况</option>{a.values.map(v=><option key={v.id} value={v.id}>{valueLabels[v.value]||v.value}</option>)}</select>:<span>目标类目未提供可选值，暂无法确认。</span>}</label>)}{metadata&&missing.length>0&&<div className={styles.actions}><Button disabled={disabled||missing.some(a=>!a.values?.some(v=>String(v.id)===choices[a.id]))} onClick={()=>void onConfirm(missing.map(a=>({id:a.id,values:[a.values!.find(v=>String(v.id)===choices[a.id])!]})))}>确认全部属性</Button></div>}</div>;
}
