'use client';
import {ProductImage} from '@/components/product-image';
import type {ListingIntake} from '@/lib/listing-intake';
import styles from './source-intake.module.css';
const imageName=(id:string)=>{const match=id.match(/(\d+)$/);return match?`第 ${Number(match[1])+1} 张`:'来源图片';};
const reasons={attachment_limit:'超出本次图片数量上限',byte_limit:'超出附件大小限制',read_failed:'读取失败',detail_excluded:'详情图未作为商品参考图带入',not_analyzed:'本次未完成图片分析',not_recommended:'未推荐用于组图，请核对当前附件是否保留'};
export function IntakeCoverage({data,analyzed=false}:{data:ListingIntake;analyzed?:boolean}){
 const coverage=data.coverage;if(!coverage)return null;
 const unread=coverage.selectedImageIds.filter(id=>!coverage.readImageIds.includes(id));
 const notAnalyzed=analyzed?coverage.readImageIds.filter(id=>!coverage.analyzedImageIds.includes(id)):[];
 return <div className={styles.coverage} aria-label="图片读取情况"><strong>来源 {coverage.totalImages} 张 · 已读取 {coverage.readImageIds.length} 张{analyzed?` · 已分析 ${coverage.analyzedImageIds.length} 张`:''}</strong>{coverage.omitted.length>0&&<ul>{coverage.omitted.map((item,i)=><li key={item.imageId+i}>{imageName(item.imageId)}：{reasons[item.reason]}</li>)}</ul>}{unread.filter(id=>!coverage.omitted.some(item=>item.imageId===id)).length>0&&<p>未读取：{unread.filter(id=>!coverage.omitted.some(item=>item.imageId===id)).map(imageName).join('、')}</p>}{notAnalyzed.length>0&&<p>尚未分析：{notAnalyzed.map(imageName).join('、')}</p>}</div>;
}
export function IntakeVariants({data}:{data:ListingIntake}){
 if(!data.variants?.length)return null;
 return <section className={styles.structured}><h3>已有规格 / SKU</h3><div className="table-scroll"><table><thead><tr><th>{data.specificationNames?.join(' / ')||'规格'}</th><th>SKU</th><th>库存</th></tr></thead><tbody>{data.variants.map((variant,i)=><tr key={variant.sku+i}><td>{variant.placeholder?'来源未提供实际颜色规格':variant.options.join(' / ')||'单规格'}</td><td>{variant.placeholder?'未提供货号':variant.sku||'未提供'}</td><td>{variant.stock??'未提供'}</td></tr>)}</tbody></table></div></section>;
}
export function IntakeObservations({data,fallback,selected,onChange}:{data:ListingIntake;fallback?:ListingIntake|null;selected:string[];onChange:(ids:string[])=>void}){
 const images=[...(data.primary?[data.primary]:[]),...(data.supplements||[]),...(fallback?.primary?[fallback.primary]:[]),...(fallback?.supplements||[])];
 const observations=(data.visualObservations||[]).filter(item=>item.colors.length||item.appearance.length);
 return <section className={styles.structured}><h3>图片中的颜色与外观</h3><p className={styles.note}>选择要用于本次组图的图片观察，不会新增或修改可售规格。</p>{observations.length>0?<div className={styles.observations}>{observations.map((item,index)=>{const image=images.find(image=>image.id===item.imageId);return <label key={item.imageId+index} className={styles.observation}><input type="checkbox" checked={selected.includes(item.imageId)} onChange={event=>onChange(event.target.checked?[...selected,item.imageId]:selected.filter(id=>id!==item.imageId))}/>{image&&<ProductImage src={`data:${image.mime};base64,${image.data}`} alt={`${imageName(item.imageId)}商品参考图`}/>}<span><strong>{imageName(item.imageId)}{data.analysis.recommendedImageIds?.includes(item.imageId)?' · AI 建议参考':''}</strong>{item.colors.length>0&&<span>颜色：{item.colors.join('、')}</span>}{item.appearance.length>0&&<span>外观：{item.appearance.join('、')}</span>}</span></label>;})}</div>:<p className={styles.note}>没有可确认的颜色或外观观察，保留已有商品资料。</p>}</section>;
}
