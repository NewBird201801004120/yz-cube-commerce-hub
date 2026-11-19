'use client';
import {Button} from '@/components/ui/button';
import type {MarketDraft} from '@/lib/localization';
import styles from './workspace.module.css';

type Props={value:MarketDraft;disabled:boolean;onChange:(next:MarketDraft)=>void};
const number=(value:string)=>value===''?null:Number(value);
export function ProductEditor({value,disabled,onChange}:Props){
 const patch=(next:Partial<MarketDraft>)=>onChange({...value,...next,marketConfirmed:false,imagesReviewed:false});
 return <fieldset disabled={disabled} className={styles.editor}>
  <label><span>商品标题</span><input value={value.title} onChange={e=>patch({title:e.target.value})} required/></label>
  <label><span>商品卖点</span><textarea value={value.sellingPoints.join('\n')} placeholder="每行一条，可留空" onChange={e=>patch({sellingPoints:e.target.value.split('\n')})}/></label>
  <label><span>商品描述</span><textarea className={styles.longDescription} value={value.description} onChange={e=>patch({description:e.target.value})}/></label>
  {!!value.specificationNames.length&&<div className={styles.editorFields}>{value.specificationNames.map((name,index)=><label key={index}><span>规格名称 {index+1}</span><input value={name} onChange={e=>patch({specificationNames:value.specificationNames.map((current,i)=>i===index?e.target.value:current)})}/></label>)}</div>}
  <div className="table-scroll"><table className={styles.editorVariants}><thead><tr><th>SKU</th>{value.specificationNames.map((name,i)=><th key={i}>{name||`规格 ${i+1}`}</th>)}<th>售价 · {value.shop.currency}</th><th>库存</th></tr></thead><tbody>{value.variants.map((variant,index)=>{
   const update=(next:Partial<MarketDraft['variants'][number]>)=>patch({variants:value.variants.map((current,i)=>i===index?{...current,...next}:current)});
   return <tr key={index}><td>{variant.sku}</td>{variant.options.map((option,i)=><td key={i}><input aria-label={`${variant.sku} 规格 ${i+1}`} value={option} onChange={e=>update({options:variant.options.map((current,j)=>j===i?e.target.value:current)})}/></td>)}<td><input aria-label={`${variant.sku} 售价`} type="number" min="0" step="any" value={variant.price??''} onChange={e=>update({price:number(e.target.value)})}/></td><td><input aria-label={`${variant.sku} 库存`} type="number" min="0" step="1" value={variant.stock??''} onChange={e=>update({stock:number(e.target.value)})}/></td></tr>;
  })}</tbody></table></div>
  <div className={styles.editorFields}><label><span>包裹重量 kg</span><input type="number" min="0" step="any" value={value.weightKg??''} onChange={e=>patch({weightKg:number(e.target.value)})}/></label>{(['length','width','height'] as const).map((key,i)=><label key={key}><span>{['长','宽','高'][i]} cm</span><input type="number" min="0" step="any" value={value.dimensionsCm[key]??''} onChange={e=>patch({dimensionsCm:{...value.dimensionsCm,[key]:number(e.target.value)}})}/></label>)}</div>
  <div className={styles.editorImages}><div><strong>商品图片</strong><Button type="button" variant="outline" onClick={()=>patch({images:[...value.images,'']})}>添加图片地址</Button></div>{value.images.map((url,index)=><div className={styles.editorImageRow} key={index}><label><span>图片 {index+1}</span><input aria-label={`图片 ${index+1} 地址`} type="url" value={url} placeholder="https://…" onChange={e=>patch({images:value.images.map((current,i)=>i===index?e.target.value:current)})}/></label><Button type="button" variant="outline" aria-label={`删除图片 ${index+1}`} onClick={()=>patch({images:value.images.filter((_,i)=>i!==index)})}>移除</Button>{index>0&&<Button type="button" variant="outline" aria-label={`上移图片 ${index+1}`} onClick={()=>{const images=[...value.images];[images[index-1],images[index]]=[images[index],images[index-1]];patch({images});}}>上移</Button>}</div>)}</div>
 </fieldset>;
}
