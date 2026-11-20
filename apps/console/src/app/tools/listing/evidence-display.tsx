'use client';
import {isLinkedVariant,evidenceVariants,readableListingNotes,listingColorEvidence} from '@/lib/listing-evidence';
import type {ListingJob} from '@/lib/listing';
import styles from './source-intake.module.css';
type Fact={key:string;value:string;sourceId:string};
const names:Record<string,string>={notes:'产品说明',dimensions:'尺寸',material:'材质',interior:'内部结构',capacity:'容量',colors:'颜色资料',functionality:'功能',usage:'适用场景',accessories:'包装清单',visual:'图片外观参考'};
function FactValue({fact,specificationNames=[]}:{fact:Fact;specificationNames?:string[]}){
 const rows=evidenceVariants(fact.value);
 if(rows)return <div className="table-scroll"><table className={styles.evidenceTable}><thead><tr><th>货号 / SKU</th><th>规格</th><th>库存</th>{rows.some(row=>row.price!==undefined)&&<th>售价</th>}</tr></thead><tbody>{rows.map((row,index)=>{const placeholder=isLinkedVariant(row);return <tr key={row.sku+index}><td>{placeholder?`来源关联标识 ${row.sku}`:row.sku}</td><td>{placeholder?<><span>来源未提供实际可售规格</span><small className={styles.note}>此标识不能确认实际可售货号</small></>:row.options.length?row.options.map((option,index)=>`${specificationNames[index]?specificationNames[index]+'：':''}${option}`).join(' / '):'单规格'}</td><td>{row.stock??'未提供'}</td>{rows.some(row=>row.price!==undefined)&&<td>{row.price??'未提供'}</td>}</tr>;})}</tbody></table></div>;
 if(fact.key==='SKU与规格'&&/^\s*[\[{]/.test(fact.value))return <p>规格资料暂无法展示，请返回商品资料核对。</p>;
 return <p className={styles.evidenceText}>{readableListingNotes(fact.value)}</p>;
}
export function ListingFacts({facts,attachments=[],specificationNames=[]}:{facts:Fact[];attachments?:{id:string;name:string}[];specificationNames?:string[]}){
 return <div className={styles.evidenceFacts}>{facts.map((fact,index)=><section key={fact.sourceId+index}><div className={styles.evidenceHeading}><strong>{names[fact.key]||fact.key||'商品资料'}</strong><small>来源：{attachments.find(a=>a.id===fact.sourceId)?.name||(fact.sourceId==='notes'?'产品说明':fact.sourceId==='primary'?'产品原图':/^fact-\d+$/.test(fact.sourceId)?'已有商品资料':fact.sourceId)}</small></div><FactValue fact={fact} specificationNames={specificationNames}/></section>)}</div>;
}
export function ListingEvidence({job}:{job:ListingJob}){
 const colors=listingColorEvidence(job);
 return <>{colors.visible&&<section className={styles.colorReference} aria-label="颜色与规格说明"><h4>图片外观参考</h4>{colors.unfinished&&<p><strong>本组尚无生成成功的图片</strong></p>}{colors.appearanceStatus&&<p>{colors.appearanceStatus}</p>}{colors.observed.map((line,index)=><p key={index}>{line}</p>)}{!colors.observed.length&&colors.facts.map((fact,index)=><p key={index}>{fact.value}</p>)}<p className={styles.note}>图片中可见的颜色可用于展示商品外观，不代表这些颜色都可购买。</p><div className={styles.saleableColors}><strong>可售颜色对照图</strong><span>{colors.colorStatus}{colors.unconfirmed?' 来源资料明确标记：可售颜色尚未确认。':''}</span></div></section>}{!!job.skipped?.length&&<details className="listing-skipped"><summary>本次未制作的详情图 · {job.skipped.length} 类</summary>{job.skipped.map((item,index)=><p key={item+index}>{/^颜色选择[：:]/.test(item)?'颜色对照图：本次未单独制作，不影响其他图片展示商品的可见颜色。':item}</p>)}</details>}{!!job.facts?.length&&<details className="listing-skipped"><summary>本次使用的商品资料</summary><ListingFacts facts={job.facts} attachments={job.attachments}/></details>}</>;
}
