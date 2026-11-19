import {api} from './api';
import type {MarketDraft} from './localization';
export type CopyFields=Pick<MarketDraft,'title'|'sellingPoints'|'description'>;
export type CopySuggestion=CopyFields&{draftId:string;revision:number;language:string;warnings:string[]};
export type CopyInput=CopyFields&{revision:number;images:string[]};
export function suggestProductCopy(id:string,input:CopyInput,signal?:AbortSignal){return api<CopySuggestion>(`/localization/drafts/${encodeURIComponent(id)}/copy-suggestions`,{method:'POST',body:JSON.stringify(input),signal});}
export const copyHasContent=(field:keyof CopyFields,value:CopyFields)=>field==='sellingPoints'?value.sellingPoints.some(point=>!!point.trim()):!!value[field].trim();
