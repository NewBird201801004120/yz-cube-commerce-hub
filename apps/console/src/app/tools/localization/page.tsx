"use client";
import {useEffect,useState} from 'react';
import ProductWorkspace from './product-workspace';
import SelectionWorkspace from './selection-workspace';
import {localizationApi} from '@/lib/localization';
export default function Page(){
 const [selection,setSelection]=useState<boolean|null>(null);
 useEffect(()=>{let alive=true;const params=new URLSearchParams(location.search),id=params.get('draft');
  if(params.get('readonly')==='1'||!id){setSelection(false);return;}
  if(params.get('selection')==='1'){setSelection(true);return;}
  void Promise.all([localizationApi.draft(id),localizationApi.sources()]).then(([draft,sources])=>{if(alive)setSelection(sources.some(s=>s.id===draft.sourceId&&s.sourceSystem==='fastmoss-selection'));}).catch(()=>{if(alive)setSelection(false);});
  return()=>{alive=false;};
 },[]);
 if(selection===null)return <p role="status">正在读取商品…</p>;
 return selection?<SelectionWorkspace/>:<ProductWorkspace mode="localization"/>;
}
