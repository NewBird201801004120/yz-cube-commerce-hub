'use client';
import {useEffect,useRef,type ReactNode} from 'react';

export function Dialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=ref.current;if(!dialog)return;dialog.showModal();return()=>dialog.close();},[]);
 return <dialog ref={ref} className="app-dialog" aria-label={title} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget){const rect=e.currentTarget.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)onClose();}}}><div className="dialog-heading"><h2>{title}</h2><button type="button" className="icon-button" aria-label="关闭窗口" onClick={onClose}>×</button></div>{children}</dialog>;
}
