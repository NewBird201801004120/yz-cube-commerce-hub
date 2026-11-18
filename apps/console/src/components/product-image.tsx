'use client';
import {useState} from 'react';
const placeholder=<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m3 17 5-5 5 5 3-3 5 5"/><circle cx="8" cy="8" r="1.5"/></svg>;

export function ProductImage({src,alt,className}:{src?:string;alt:string;className?:string}){
 const [failed,setFailed]=useState(''),[loaded,setLoaded]=useState('');
 if(!src||failed===src)return <div className={`product-image-fallback ${className||''}`} role="img" aria-label={`${alt}，图片暂不可用`}>{placeholder}<span>图片暂不可用</span></div>;
 return <div className={`product-image-shell ${className||''}`}>
  {loaded!==src&&<div className="product-image-fallback" aria-hidden="true">{placeholder}<span>正在加载图片…</span></div>}
  <img src={src} alt={alt} referrerPolicy="no-referrer" loading="lazy" style={{opacity:loaded===src?1:0}} onLoad={()=>setLoaded(src)} onError={()=>setFailed(src)}/>
 </div>;
}
