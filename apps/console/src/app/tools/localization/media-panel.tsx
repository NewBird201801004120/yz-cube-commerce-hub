'use client';
import {useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {localizationApi} from '@/lib/localization';
import type {LocalizationMedia,MarketDraft} from '@/lib/localization';
import styles from './localization.module.css';

type Props={draft:MarketDraft;onChange:(patch:Partial<MarketDraft>)=>void;readOnly?:boolean};
const emptyMedia=():LocalizationMedia=>({assets:[],variantImages:[],detailBlocks:[]});
const safeImage=(url:string)=>{if(/^\/api\/v1\/localization\/assets\/[a-f0-9-]{36}$/.test(url))return true;try{const u=new URL(url);return url.length<=2048&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.hostname.includes('.')&&!/^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.test)$/.test(u.hostname)&&!/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)&&!u.hostname.includes(':');}catch{return false;}};
const textState={unknown:'尚未核对',none:'无文字',present:'含文字'};

export default function MediaPanel({draft,onChange,readOnly=false}:Props){
 const [url,setUrl]=useState(''),[role,setRole]=useState<'detail'|'variant'>('detail'),[detailImage,setDetailImage]=useState(''),[error,setError]=useState(''),[uploading,setUploading]=useState(false),[uploadNotice,setUploadNotice]=useState('');
 const uploadActive=useRef(false),latest=useRef({draft,onChange,readOnly});latest.current={draft,onChange,readOnly};
 const media=draft.media||emptyMedia(),asset=(id:string)=>media.assets.find(x=>x.id===id);
 function change(next:LocalizationMedia){setError('');onChange({media:next,imagesReviewed:false});}
 function updateAsset(id:string,patch:Partial<LocalizationMedia['assets'][number]>){change({...media,assets:media.assets.map(x=>x.id===id?{...x,...patch}:x)});}
 function addImage(){if(media.assets.length>=30){setError('补充图片最多30张，请先移除不用的图片。');return;}if(!safeImage(url.trim())){setError('请使用公开 HTTPS 图片地址，或已上传到中台的图片地址。');return;}change({...media,assets:[...media.assets,{id:crypto.randomUUID(),url:url.trim(),role,textInImage:'unknown'}]});setUrl('');}
 function removeImage(id:string){change({...media,assets:media.assets.filter(x=>x.id!==id),variantImages:media.variantImages.filter(x=>x.assetId!==id),detailBlocks:media.detailBlocks.filter(x=>x.type!=='image'||x.assetId!==id)});}
 function moveBlock(index:number,offset:number){const blocks=[...media.detailBlocks],other=index+offset;if(other<0||other>=blocks.length)return;[blocks[index],blocks[other]]=[blocks[other],blocks[index]];change({...media,detailBlocks:blocks});}
 async function uploadImage(file:File){
  if(uploadActive.current)return;
  setError('');setUploadNotice('');
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)){setError('请上传 PNG、JPEG 或 WebP 图片。');return;}
  if(file.size>8*1024*1024){setError('图片超过8 MB，请压缩后上传。');return;}
  if(media.assets.length>=30){setError('补充图片最多30张，请先移除不用的图片。');return;}
  const draftId=draft.id,selectedRole=role;uploadActive.current=true;setUploading(true);
  try{
   const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>typeof reader.result==='string'?resolve(reader.result.split(',')[1]):reject(new Error());reader.onerror=()=>reject(new Error());reader.readAsDataURL(file);});
   const uploaded=await localizationApi.uploadImage(data);
   if(!safeImage(uploaded.url))throw new Error();
   const current=latest.current;
   if(current.draft.id!==draftId||current.readOnly){setError('图片已上传，但当前版本已切换，请返回原版本重新选择图片。');return;}
   const currentMedia=current.draft.media||emptyMedia();
   if(currentMedia.assets.length>=30){setError('图片已上传，但补充图片已满30张，请先移除不用的图片后重新添加。');return;}
   current.onChange({media:{...currentMedia,assets:[...currentMedia.assets,{id:crypto.randomUUID(),url:uploaded.url,role:selectedRole,textInImage:'unknown'}]},imagesReviewed:false});
   setUploadNotice(`已上传为${selectedRole==='detail'?'详情图':'规格配图'}，请保存草稿并核对图中文字。`);
  }catch{setError('图片上传未完成，请检查图片或网络后重试。');}
  finally{uploadActive.current=false;setUploading(false);}
 }
 const variantAssets=media.assets,detailAssets=media.assets.filter(x=>x.role==='detail');
 const preview=<div className={styles.stack}>
  {media.variantImages.length>0&&<><h3>规格配图预览</h3><div className={styles.images}>{media.variantImages.map(binding=>{const image=asset(binding.assetId);return <div className={styles.image} key={binding.sku}>{image&&safeImage(image.url)?<img src={image.url} alt={`${binding.sku} 规格图片`} referrerPolicy="no-referrer"/>:<p className="error">配图尚未补齐</p>}<span>{binding.sku}</span></div>;})}</div></>}
  {media.detailBlocks.length>0&&<><h3>商品详情预览</h3><div className={styles.stack}>{media.detailBlocks.map((block,index)=>{if(block.type==='text')return <p key={index} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{block.text}</p>;const image=asset(block.assetId);return image&&safeImage(image.url)?<img key={index} src={image.url} alt={`商品详情图片 ${index+1}`} referrerPolicy="no-referrer" style={{maxWidth:'100%',height:'auto'}}/>:<p className="error" key={index}>详情图片尚未补齐</p>;})}</div></>}
  {!media.variantImages.length&&!media.detailBlocks.length&&<p className={styles.subtle}>尚未添加规格配图或图文详情。</p>}
 </div>;
 if(readOnly)return <section className={styles.stack}>{preview}</section>;
 return <section className={styles.stack} aria-label="规格配图与图文详情" style={{minWidth:0,maxWidth:'100%',overflowWrap:'anywhere'}}>
  <div className={styles.heading}><h3>规格配图与图文详情</h3></div>
  <p className={styles.notice}>商品文案翻译不会改变图片里的文字。含文字的图片需按目标市场单独制作，或使用已完成的 Listing 图片替换，再核对语言与真实参数。商品主图和附图仍在上方管理。</p>
  {error&&<p className="error" role="alert">{error}</p>}
  <label className={styles.line}><span>上传补充图</span><input className={styles.file} style={{minWidth:0,maxWidth:'100%',width:'100%'}} type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading||media.assets.length>=30} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void uploadImage(file);}}/></label>
  <p className={styles.subtle}>上传后按下方所选用途保存为详情图或规格配图，不占用上方9张商品展示图名额。支持8 MB以内的 PNG、JPEG、WebP。</p>
  {uploading&&<p className={styles.subtle} role="status">正在上传补充图片…</p>}
  {uploadNotice&&<p className={styles.subtle} role="status">{uploadNotice}</p>}
  <div className={styles.fields}><label><span>补充图片</span><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="公开 HTTPS 图片地址"/></label><label><span>图片用途</span><select value={role} onChange={e=>setRole(e.target.value as 'detail'|'variant')}><option value="detail">详情图</option><option value="variant">规格配图</option></select></label></div>
  <div className={styles.actions}><Button type="button" variant="outline" onClick={addImage} disabled={!url.trim()||media.assets.length>=30}>添加补充图片</Button></div>
  {media.assets.map((image,index)=><div className={styles.job} key={image.id}>
   <div className={styles.heading}><strong>{image.role==='gallery'?'商品主图 / 附图':image.role==='detail'?'详情图':'规格配图'} {index+1}</strong>{image.role!=='gallery'&&<div className={styles.actions}><Button type="button" variant="outline" onClick={()=>removeImage(image.id)}>移除图片及关联</Button></div>}</div>
   {safeImage(image.url)&&<img src={image.url} alt={`补充商品图片 ${index+1}`} referrerPolicy="no-referrer" style={{width:120,maxWidth:'100%',height:120,objectFit:'contain'}}/>}
   {image.role==='gallery'?<p className={styles.subtle}>此图片属于导入的主图 / 附图，请与上方商品图片保持一致。</p>:<label className={styles.line}><span>目标图片</span><input value={image.url} onChange={e=>updateAsset(image.id,{url:e.target.value})} aria-label={`图片 ${index+1} 目标地址`}/></label>}
   <div className={styles.fields}><label><span>图中文字</span><select value={image.textInImage} onChange={e=>updateAsset(image.id,{textInImage:e.target.value as typeof image.textInImage})}>{Object.entries(textState).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><label><span>图片语言</span><input value={image.sourceLanguage||''} maxLength={80} onChange={e=>updateAsset(image.id,{sourceLanguage:e.target.value.trim()?e.target.value:undefined})} placeholder="例如：中文、English"/></label></div>
  </div>)}
  <h3>为每个规格选择图片</h3>
  <div className={styles.fields}>{draft.variants.map(variant=><label key={variant.sku}><span title={variant.sku} style={{overflow:'hidden',textOverflow:'ellipsis'}}>{variant.sku}</span><select aria-label={`${variant.sku} 配图`} value={media.variantImages.find(x=>x.sku===variant.sku)?.assetId||''} onChange={e=>change({...media,variantImages:[...media.variantImages.filter(x=>x.sku!==variant.sku),...(e.target.value?[{sku:variant.sku,assetId:e.target.value}]:[])]})}><option value="">不设置配图</option>{variantAssets.map(image=><option value={image.id} key={image.id}>{image.role==='variant'?'规格图':image.role==='detail'?'详情图':'主图 / 附图'} {media.assets.indexOf(image)+1}</option>)}</select></label>)}</div>
  <div className={styles.heading}><h3>编排商品详情</h3><div className={styles.actions}><Button type="button" variant="outline" disabled={media.detailBlocks.length>=40} onClick={()=>change({...media,detailBlocks:[...media.detailBlocks,{type:'text',text:''}]})}>添加文字段落</Button></div></div>
  <label className={styles.line}><span>选择详情图</span><select value={detailImage} onChange={e=>setDetailImage(e.target.value)}><option value="">请选择已添加的详情图</option>{detailAssets.map(image=><option value={image.id} key={image.id}>详情图 {media.assets.indexOf(image)+1}</option>)}</select></label>
  <div className={styles.actions}><Button type="button" variant="outline" disabled={!detailAssets.some(x=>x.id===detailImage)||media.detailBlocks.length>=40} onClick={()=>{change({...media,detailBlocks:[...media.detailBlocks,{type:'image',assetId:detailImage}]});setDetailImage('');}}>插入详情图</Button></div>
  {media.detailBlocks.map((block,index)=><div className={styles.job} key={index}><div className={styles.heading}><strong>第 {index+1} 段 · {block.type==='text'?'文字':'图片'}</strong><div className={styles.actions}><Button type="button" variant="outline" disabled={index===0} onClick={()=>moveBlock(index,-1)}>上移</Button><Button type="button" variant="outline" disabled={index===media.detailBlocks.length-1} onClick={()=>moveBlock(index,1)}>下移</Button><Button type="button" variant="outline" onClick={()=>change({...media,detailBlocks:media.detailBlocks.filter((_,i)=>i!==index)})}>移除</Button></div></div>{block.type==='text'?<label className={styles.line}><span>详情文字</span><textarea value={block.text} maxLength={Math.min(10000,Math.max(0,20000-media.detailBlocks.reduce((sum,b,i)=>sum+(i!==index&&b.type==='text'?b.text.length:0),0)))} placeholder="填写目标市场详情文字；空段落请填写或移除" onChange={e=>change({...media,detailBlocks:media.detailBlocks.map((b,i)=>i===index?{type:'text',text:e.target.value}:b)})}/></label>:<p className={styles.subtle}>详情图 {media.assets.findIndex(x=>x.id===block.assetId)+1}</p>}</div>)}
  {preview}
 </section>;
}
