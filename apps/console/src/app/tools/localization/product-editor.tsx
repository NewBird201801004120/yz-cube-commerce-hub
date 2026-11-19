'use client';
import {useEffect,useRef,useState} from 'react';
import {ProductImage} from '@/components/product-image';
import {localizationApi as client} from '@/lib/localization';
import {errorMessage} from '@/lib/api';
import {Button} from '@/components/ui/button';
import type {MarketDraft} from '@/lib/localization';
import styles from './workspace.module.css';
import {CopySuggestions} from './copy-suggestions';

type Props={referenceImages?:string[];value:MarketDraft;disabled:boolean;onChange:(next:MarketDraft)=>void;onChooseListing:()=>void;onUploadingChange:(value:boolean)=>void};
const number=(value:string)=>value===''?null:Number(value);
export function ProductEditor({value,disabled,onChange,onChooseListing,onUploadingChange,referenceImages=[]}:Props){
 const [uploading,setUploading]=useState(0),[uploadError,setUploadError]=useState(''),[dragging,setDragging]=useState(false);
 const input=useRef<HTMLInputElement>(null),moving=useRef<number|null>(null),uploadLock=useRef(false),latest=useRef(value),alive=useRef(true);
 latest.current=value;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 function updateImages(images:string[]){const next={...latest.current,images,marketConfirmed:false,imagesReviewed:false};latest.current=next;onChange(next);}
 async function uploadFiles(files:File[]){
  if(disabled||uploadLock.current||!files.length)return;
  setUploadError('');
  if(latest.current.images.length+files.length>9){setUploadError('最多上传 9 张图片，请减少本次选择的文件。');return;}
  if(files.some(f=>!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size>8*1024*1024)){setUploadError('请选择 PNG、JPEG 或 WebP 图片，每张不超过 8MB。');return;}
  uploadLock.current=true;setUploading(files.length);onUploadingChange(true);
  let failures=0;
  try{for(const file of files){try{const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('图片读取失败'));reader.readAsDataURL(file);});const result=await client.uploadImage(data.split(',')[1]);if(!alive.current)return;updateImages([...latest.current.images,result.url]);}catch(e){failures++;if(alive.current)setUploadError(`${failures} 张图片上传失败：${errorMessage(e)}。可重新选择失败图片上传。`);}finally{if(alive.current)setUploading(n=>n-1);}}}finally{uploadLock.current=false;if(alive.current){setUploading(0);onUploadingChange(false);}}
 }
 function moveImage(from:number,to:number){if(disabled||uploading||from===to)return;const images=[...latest.current.images];const [image]=images.splice(from,1);if(image===undefined)return;images.splice(to,0,image);updateImages(images);}

 const patch=(next:Partial<MarketDraft>)=>onChange({...value,...next,marketConfirmed:false,imagesReviewed:false});
 return <fieldset disabled={disabled} className={styles.editor}>
  <CopySuggestions value={value} referenceImages={referenceImages} disabled={disabled||!!uploading} onApply={patch}/>
  <label><span>商品标题</span><input value={value.title} onChange={e=>patch({title:e.target.value})} required/></label>
  <label><span>商品卖点（选填）</span><textarea value={value.sellingPoints.join('\n')} placeholder="每行一条，可留空" onChange={e=>patch({sellingPoints:e.target.value.split('\n')})}/></label>
  <label><span>商品描述</span><textarea className={styles.longDescription} value={value.description} onChange={e=>patch({description:e.target.value})}/></label>
  <div className={styles.editorImages}>
   <div><strong>商品图片 <small>{value.images.length} / 9</small></strong><div className={styles.actions}>{referenceImages.length>0&&<Button type="button" variant="outline" disabled={disabled||!!uploading} onClick={()=>{setUploadError('');updateImages([...new Set(referenceImages)].slice(0,9));}}>使用参考图</Button>}<Button type="button" variant="outline" disabled={disabled||!!uploading} onClick={onChooseListing}>使用已生成组图</Button><Button type="button" variant="outline" disabled={disabled||!!uploading||value.images.length>=9} onClick={()=>input.current?.click()}>上传图片</Button></div></div>
   {!value.images.length&&referenceImages.length>0&&<div className={styles.referenceImages}><span>来源参考图，点击“使用参考图”后才会用于商品。</span><div>{referenceImages.slice(0,9).map((url,index)=><ProductImage key={`${url}-${index}`} src={url} alt={`来源参考图 ${index+1}`}/>)}</div></div>}
   <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="上传商品图片" disabled={disabled||!!uploading||value.images.length>=9} onChange={e=>{void uploadFiles(Array.from(e.target.files||[]));e.target.value='';}}/>
   <div className={`${styles.imageDropZone} ${dragging?styles.imageDropActive:''}`} onDragOver={e=>{e.preventDefault();if(e.dataTransfer.types.includes('Files'))setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);if(e.dataTransfer.files.length)void uploadFiles(Array.from(e.dataTransfer.files));}}>
    <div className={styles.uploadImageGrid}>{value.images.map((url,index)=><div className={styles.uploadImageCard} key={`${url}-${index}`} draggable={!disabled&&!uploading} onDragStart={e=>{moving.current=index;e.dataTransfer.setData('text/plain',String(index));e.dataTransfer.effectAllowed='move';}} onDragEnd={()=>{moving.current=null;}} onDragOver={e=>e.preventDefault()} onDrop={e=>{if(e.dataTransfer.files.length)return;e.preventDefault();e.stopPropagation();if(moving.current!==null)moveImage(moving.current,index);moving.current=null;}}><div className={styles.uploadThumbnail}><ProductImage src={url} alt={`商品图片 ${index+1}`}/><span>{index===0?'主图':index+1}</span></div><div className={styles.imageCardActions}>{index>0&&<button type="button" disabled={disabled||!!uploading} aria-label={`上移图片 ${index+1}`} onClick={()=>moveImage(index,index-1)}>上移</button>}<button type="button" disabled={disabled||!!uploading} aria-label={`删除图片 ${index+1}`} onClick={()=>updateImages(latest.current.images.filter((_,i)=>i!==index))}>移除</button></div></div>)}</div>
    <p className={styles.dropHint}>{uploading?`正在上传，剩余 ${uploading} 张…`:value.images.length>=9?'已达 9 张上限':'拖入图片，或点击上传图片'}</p>
   </div>
   <p className={styles.uploadHelp}>PNG、JPEG、WebP，每张最多 8MB，建议使用 800 × 800 或更高的正方形图片。拖动图片可排序，保存资料后生效。</p>
   {uploadError&&<p role="alert" className={styles.problem}>{uploadError}</p>}
  </div>
  {!!value.specificationNames.length&&<div className={styles.editorFields}>{value.specificationNames.map((name,index)=><label key={index}><span>规格名称 {index+1}</span><input value={name} onChange={e=>patch({specificationNames:value.specificationNames.map((current,i)=>i===index?e.target.value:current)})}/></label>)}</div>}
  <div className={`table-scroll ${styles.editorVariantScroll}`}><table className={styles.editorVariants}><colgroup><col className={styles.skuColumn}/>{value.specificationNames.map((_,i)=><col key={i} className={styles.optionColumn}/>)}<col className={styles.numberColumn}/><col className={styles.numberColumn}/></colgroup><thead><tr><th>SKU</th>{value.specificationNames.map((name,i)=><th key={i}>{name||`规格 ${i+1}`}</th>)}<th>售价 · {value.shop.currency}</th><th>库存</th></tr></thead><tbody>{value.variants.map((variant,index)=>{
   const update=(next:Partial<MarketDraft['variants'][number]>)=>patch({variants:value.variants.map((current,i)=>i===index?{...current,...next}:current)});
   return <tr key={index}><td><span className={styles.skuValue} title={variant.sku}>{variant.sku}</span></td>{variant.options.map((option,i)=><td key={i}><input aria-label={`${variant.sku} 规格 ${i+1}`} value={option} onChange={e=>update({options:variant.options.map((current,j)=>j===i?e.target.value:current)})}/></td>)}<td><input aria-label={`${variant.sku} 售价`} type="number" min="0" step="any" value={variant.price??''} onChange={e=>update({price:number(e.target.value)})}/></td><td><input aria-label={`${variant.sku} 库存`} type="number" min="0" step="1" value={variant.stock??''} onChange={e=>update({stock:number(e.target.value)})}/></td></tr>;
  })}</tbody></table></div>
  <div className={styles.packageFields}><label><span>包裹重量</span><div className={styles.unitField}><input aria-label="包裹重量" type="number" min="0" step="any" value={value.weightKg??''} onChange={e=>patch({weightKg:number(e.target.value)})}/><span>kg</span></div></label><div className={styles.dimensionsRow}><span>包裹尺寸</span><div className={styles.dimensionInputs}>{(['length','width','height'] as const).map((key,i)=><label key={key}><span>{['长','宽','高'][i]}</span><input aria-label={`包裹${['长','宽','高'][i]}`} type="number" min="0" step="any" value={value.dimensionsCm[key]??''} onChange={e=>patch({dimensionsCm:{...value.dimensionsCm,[key]:number(e.target.value)}})}/></label>)}<span className={styles.dimensionUnit}>cm</span></div></div></div>

 </fieldset>;
}
