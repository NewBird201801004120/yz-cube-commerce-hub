'use client';
import {useEffect,useId,useRef,type ReactNode} from 'react';

export function Dialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null);
 const headingId=useId();
 useEffect(()=>{const dialog=ref.current;if(!dialog)return;dialog.showModal();return()=>dialog.close();},[]);
 return <dialog ref={ref} className="app-dialog" aria-labelledby={headingId} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget){const rect=e.currentTarget.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)onClose();}}}><div className="dialog-heading"><h2 id={headingId}>{title}</h2><button type="button" className="icon-button" aria-label="关闭窗口" onClick={onClose}>×</button></div>{children}</dialog>;
}
