"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {api} from '@/lib/api';
type IconKind='shop'|'products'|'listing'|'localization'|'video'|'ai'|'audit'|'chevron';
function Icon({kind}:{kind:IconKind}){
 const shapes:Record<IconKind,React.ReactNode>={
  shop:<><path d="M3 10h18l-2-6H5l-2 6Z"/><path d="M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 13v8h14v-8M9 21v-6h6v6"/></>,
  products:<><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Z"/><path d="m3 8 9 5 9-5M12 13v8M7.5 5.5l9 5"/></>,
  listing:<><rect x="3" y="5" width="16" height="16" rx="2"/><path d="M7 2h14v14M3 17l5-5 4 4 3-3 4 4"/><circle cx="8" cy="10" r="1"/></>,
  localization:<><circle cx="10" cy="12" r="8"/><path d="M2 12h16M10 4c-4 4-4 12 0 16M10 4c2 2 3 5 3 8M17 17h6m-3-3 3 3-3 3"/></>,
  video:<><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/></>,
  ai:<><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4"/></>,
  audit:<><path d="M14 3H5v18h14V8l-5-5ZM14 3v5h5M8 12h8M8 16h5"/></>,
  chevron:<path d="m9 18 6-6-6-6"/>,
 };
 return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[kind]}</svg>;
}
export function Shell({email,active,filters,children}:{email:string;active:'shops'|'audit'|'developer'|'listing'|'localization'|'video'|'ai';filters?:React.ReactNode;children:React.ReactNode}){
 const [collapsed,setCollapsed]=useState(false),[groups,setGroups]=useState<Record<string,boolean>>({});
 useEffect(()=>{const media=window.matchMedia('(max-width:700px)');const update=()=>setCollapsed(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
 async function logout(){await api('/auth/logout',{method:'POST'});window.location.assign('/login');}
 const items:{id:'shops'|'audit'|'developer'|'listing'|'localization'|'video'|'ai';group:string;title:string;href:string;icon:Exclude<IconKind,'chevron'>}[]=[{id:'shops',group:'平台与店铺',title:'店铺列表与授权',href:'/channels/shops',icon:'shop'},{id:'developer',group:'商品管理',title:'店铺商品',href:'/developer',icon:'products'},{id:'listing',group:'商品工具',title:'Listing 组图生成',href:'/tools/listing',icon:'listing'},{id:'localization',group:'商品工具',title:'商品本地化与上架',href:'/tools/localization',icon:'localization'},{id:'video',group:'商品工具',title:'商品短视频',href:'/tools/short-video',icon:'video'},{id:'ai',group:'系统设置',title:'AI API 配置',href:'/settings/ai',icon:'ai'},{id:'audit',group:'系统管理',title:'授权操作记录',href:'/settings/audit',icon:'audit'}];
 const sections=Array.from(new Set(items.map(item=>item.group))).map(group=>({group,items:items.filter(item=>item.group===group)}));
 return <div className={'shell'+(collapsed?' sidebar-collapsed':'')}><aside><div className="brand"><img src="/brand/yz_cube_logo.png" alt="颜值立方 Logo"/><div className="brand-copy"><strong>顏值立方</strong><span>YZ E-COMMERCE</span><small><i/>跨境经营中台</small></div></div><button className="sidebar-toggle" onClick={()=>setCollapsed(!collapsed)} aria-label={collapsed?'展开菜单':'收起菜单'} title={collapsed?'展开菜单':'收起菜单'}><Icon kind="chevron"/></button><nav aria-label="主菜单">{sections.map(section=><div className="nav-section" key={section.group}><button className="nav-group" onClick={()=>setGroups(p=>({...p,[section.group]:p[section.group]===false}))} aria-expanded={groups[section.group]!==false}><span>{section.group}</span><span className={groups[section.group]!==false?'group-arrow open':'group-arrow'}>⌄</span></button>{(collapsed||groups[section.group]!==false)&&section.items.map(item=><Link key={item.id} aria-current={active===item.id?'page':undefined} className={active===item.id?'active':''} href={item.href} title={item.title}><Icon kind={item.icon}/><span>{item.title}</span></Link>)}</div>)}</nav><div className="aside-foot"><div><strong title={email}>{email||'管理员'}</strong><small>企业店铺授权管理</small></div><span className="seal">YZ</span><p>跨境电商运营中台</p></div></aside><div className="workspace"><header><div className="header-row"><div className="breadcrumb"><span>{active==='shops'?'平台与店铺':active==='developer'?'商品管理':(active==='listing'||active==='localization'||active==='video')?'商品工具':active==='ai'?'系统设置':'系统管理'}</span><span>/</span><strong>{active==='shops'?'店铺列表与授权':active==='developer'?'店铺商品':active==='listing'?'Listing 组图生成':active==='localization'?'商品本地化与上架':active==='video'?'商品短视频':active==='ai'?'AI API 配置':'授权操作记录'}</strong></div><div className="account"><span title={email}>{email}</span><button onClick={logout}>退出登录</button></div></div>{filters&&<div className="toolbar">{filters}</div>}</header><main className="content">{children}</main><footer><span><span className="seal">顏值立方</span>颜值立方 (YZ GROUP) · 跨境电商经营运营平台</span><span>Shopee · 店铺授权管理</span></footer></div></div>;
}
