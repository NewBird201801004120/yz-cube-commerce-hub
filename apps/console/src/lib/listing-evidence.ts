import type {ListingJob} from './listing';
export type EvidenceVariant={sku:string;options:string[];stock?:number|null;price?:number|null;placeholder?:boolean};
export const isLinkedVariant=(variant:EvidenceVariant)=>variant.placeholder===true||(!variant.options.length&&/^FM-\d+$/.test(variant.sku));
export function evidenceVariants(value:string):EvidenceVariant[]|null{
 try{const input=JSON.parse(value.replace(/^SKU与规格\s*[：:]\s*/,''));if(!Array.isArray(input)||!input.length||input.length>100||!input.every(v=>v&&typeof v.sku==='string'&&Array.isArray(v.options)&&v.options.every((option:unknown)=>typeof option==='string')))return null;return input;}catch{return null;}
}
/** Read-only presentation adapter for historical notes; never rewrites stored evidence. */
export function readableListingNotes(value:string){
 const dimensions=value.match(/(?:^|\n)规格名称[：:]\s*([^\n]*)/)?.[1].split(' / ')||[];
 return value.split('\n').map(line=>{if(!/^SKU与规格\s*[：:]/.test(line))return line;const variants=evidenceVariants(line);if(!variants)return 'SKU与规格：请返回商品资料核对规格。';return 'SKU与规格：\n'+variants.map(variant=>isLinkedVariant(variant)?`${variant.sku} 为来源关联标识，来源未提供实际可售规格。`:[`SKU：${variant.sku}`,...variant.options.map((option,index)=>`${dimensions[index]||`规格${index+1}`}：${option}`),...(variant.options.length?[]:['单规格']),...(variant.stock===null||variant.stock===undefined?[]:[`库存：${variant.stock}`]),...(variant.price===null||variant.price===undefined?[]:[`售价：${variant.price}`])].join('；')).join('\n');}).join('\n');
}
export function listingColorEvidence(job:Pick<ListingJob,'facts'|'notes'|'slots'|'skipped'|'completed'>){
 const observed=(job.notes||'').split('\n').filter(line=>/可见颜色[：:]|可见外观[：:]/.test(line));
 const facts=(job.facts||[]).filter(fact=>fact.key==='visual'||fact.key==='colors');
 const colorSlot=job.slots?.find(slot=>slot.id==='colors'),appearanceSlots=(job.slots||[]).filter(slot=>slot.id==='appearance');
 const unconfirmed=(job.facts||[]).some(fact=>fact.key==='colors'&&/unconfirmed|not confirmed|未确认|未核实|待确认/i.test(fact.value));
 const colorStatus=colorSlot?colorSlot.status==='success'&&colorSlot.imageUrl?'已生成，请按实际商品规格核对。':'已安排，尚未生成成功。':'本次未单独制作；可售颜色以实际商品规格为准。';
 const appearanceStatus=appearanceSlots.length?appearanceSlots.some(slot=>slot.status==='success'&&slot.imageUrl)?'外观展示图已生成。':'外观展示已安排，尚未生成成功。':'';
 return {observed,facts,unconfirmed,colorStatus,appearanceStatus,unfinished:job.completed===0,visible:observed.length>0||facts.length>0||!!colorSlot||!!job.skipped?.some(item=>/^颜色选择[：:]/.test(item))};
}
