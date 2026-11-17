import type {LocalizationSource,LocalizationDraft} from './localization-engine';

type Row=Record<string,any>;
const rec=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const rows=(v:unknown):Row[]=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)):[];
const norm=(v:unknown)=>typeof v==='string'?v.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g,' '):'';
const names=(v:Row,keys:string[])=>[...keys.map(k=>v[k]),...rows(v.multi_lang).map(x=>x.value)].map(norm).filter(Boolean);
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
export function attributeRows(payload:unknown,categoryId:number|null):Row[]{
 const p=rec(payload);
 if(Array.isArray(p.list))return rows(p.list.find((x:Row)=>x.category_id===categoryId)?.attribute_tree);
 if(Array.isArray(p.attribute_list))return rows(p.attribute_list);
 const tree=rows(p.attribute_tree),category=tree.find(x=>x.category_id===categoryId);
 return category?rows(category.attribute_list||category.attribute_tree):[];
}
function mandatory(a:Row){return typeof a.mandatory==='boolean'?a.mandatory:a.is_mandatory===true;}
function attributeValueIssues(a:Row,values:LocalizationDraft['attributes'][number]['values']):string[]{
 const issues:string[]=[],label=a.name||a.display_attribute_name||a.attribute_name||a.attribute_id;
 const max=rec(a.attribute_info).max_value_count;
 if(positive(max)&&values.length>max)issues.push(`属性 ${label} 超出允许的值数量`);
 const candidates=rows(a.attribute_value_list);
 for(const v of values){
  if(!v.value.trim())issues.push(`属性 ${label} 的值不能为空`);
  if(v.id&& !candidates.some(c=>c.value_id===v.id))issues.push(`属性 ${label} 的值不属于目标类目`);
  if(!v.id&&!candidates.length&&! [3].includes(rec(a.attribute_info).input_type))issues.push(`属性 ${label} 的自由输入规则尚未确认`);
  if(!v.id&&candidates.length&&! [3].includes(rec(a.attribute_info).input_type))issues.push(`属性 ${label} 需要目标候选值`);
  const units=a.attribute_unit||a.unit_list;
  if(Array.isArray(units)&&units.length&&!units.some((u:any)=>norm(typeof u==='string'?u:u.unit||u.value_unit)===norm(v.unit)))issues.push(`属性 ${label} 需要有效单位`);
 }
 return issues;
}

/** Destination adaptation uses supplied facts and current shop rules. It never invents product facts. */
export function adaptMarket(source:LocalizationSource,draft:LocalizationDraft,rawMetadata:unknown):{patch:Partial<LocalizationDraft>;issues:string[]}{
 const raw=rec(rawMetadata),patch:Partial<LocalizationDraft>={},issues:string[]=[];
 const limits=rec(raw.limits);
 if(rec(limits.weight_limit).weight_mandatory===true&&!positive(draft.weightKg))issues.push('缺少目标店铺必填包装重量 weightKg');
 if(rec(limits.dimension_limit).dimension_mandatory===true&&!Object.values(draft.dimensionsCm).every(positive))issues.push('缺少目标店铺必填包装长宽高 dimensionsCm');
 for(const variant of draft.variants){if(!positive(variant.price))issues.push(`SKU ${variant.sku} 缺少有效最终售价`);if(!Number.isSafeInteger(variant.stock)||Number(variant.stock)<0||variant.stock===null)issues.push(`SKU ${variant.sku} 缺少非负整数库存`);}
 const params=Object.entries(source.parameters),brands=rows(rec(raw.brands).brand_list);
 const brandParam=params.find(([k])=>['品牌','brand'].includes(norm(k)))?.[1];
 if(draft.brandId!==null&&draft.brandId!==0){
  if(!brands.some(b=>b.brand_id===draft.brandId))issues.push(rec(raw.brands).candidatesIncomplete?'品牌候选尚未读取完整，暂不能确认已保存品牌':'已保存品牌不属于目标类目候选，请核对品牌');
 }else{
  const matches=brandParam?brands.filter(b=>names(b,['name','display_brand_name','original_brand_name']).includes(norm(brandParam))):[];
  const brand=matches.length===1?matches[0]:brands.find(b=>b.brand_id===0);
  if(brand){patch.brandId=brand.brand_id;patch.brandName=brand.original_brand_name||brand.display_brand_name||brand.name;}
  else issues.push('目标类目未返回可用品牌或无品牌选项，请核对品牌');
 }
 const targets=attributeRows(raw.attributes,draft.categoryId),attributes=structuredClone(draft.attributes);
 for(const existing of attributes){const a=targets.find(a=>a.attribute_id===existing.id);if(!a)issues.push(`属性 ${existing.id} 不属于目标类目`);else issues.push(...attributeValueIssues(a,existing.values));}
 for(const a of targets){
  const current=attributes.find(v=>v.id===a.attribute_id);
  if(current?.values.length)continue;
  const keys=names(a,['name','display_attribute_name','original_attribute_name','attribute_name']);
  const facts=params.filter(([key])=>keys.includes(norm(key)));
  let mapped:LocalizationDraft['attributes'][number]['values']|undefined;
  if(facts.length===1&&facts[0][1].trim()){
   const fact=facts[0][1],candidates=rows(a.attribute_value_list),choices=candidates.filter(v=>names(v,['name','display_value_name','original_value_name']).includes(norm(fact)));
   if(choices.length===1)mapped=[{id:choices[0].value_id,value:choices[0].original_value_name||choices[0].name||choices[0].display_value_name}];
   // Only explicit free-text input mode 3 is auto-filled; dropdown/combo/unknown modes need candidates or review.
   else if(!candidates.length&&[3].includes(rec(a.attribute_info).input_type))mapped=[{value:fact}];
  }
  if(mapped&&!attributeValueIssues(a,mapped).length){if(current)current.values=mapped;else attributes.push({id:a.attribute_id,values:mapped});}
  else if(mandatory(a))issues.push(`缺少可可靠匹配的必填属性：${a.name||a.display_attribute_name||a.attribute_name||a.attribute_id}`);
 }
 if(JSON.stringify(attributes)!==JSON.stringify(draft.attributes))patch.attributes=attributes;

 const channels=rows(rec(raw.logistics).logistics_channel_list),existing=draft.logistics;
 const dimensions=draft.dimensionsCm,completeDimensions=Object.values(dimensions).every(positive);
 const channelIssues=(c:Row,l?:LocalizationDraft['logistics'][number]):string[]=>{
  const reasons:string[]=[],label=c.logistics_channel_name||c.logistics_channel_id;
  const weight=rec(c.weight_limit),max=rec(c.item_max_dimension),min=rec(c.item_min_dimension),volume=rec(c.volume_limit);
  if(c.enabled!==true)reasons.push('店铺未启用');
  if(draft.preOrder?.isPreOrder&&c.support_pre_order===false)reasons.push('不支持预售');
  if((positive(weight.item_max_weight)||positive(weight.item_min_weight))&&!positive(draft.weightKg))reasons.push('缺少包裹重量');
  if(positive(draft.weightKg)&&(positive(weight.item_max_weight)&&draft.weightKg>weight.item_max_weight||positive(weight.item_min_weight)&&draft.weightKg<weight.item_min_weight))reasons.push('包裹重量不符合限制');
  const dimensional=['length','width','height','dimension_sum'].some(k=>positive(max[k])||positive(max['max_'+k])||positive(min[k])||positive(min['min_'+k]));
  const volumetric=positive(volume.item_max_volume)||positive(volume.item_min_volume);
  if((dimensional||volumetric)&&!completeDimensions)reasons.push('需补齐包裹长宽高以检查限制');
  if(completeDimensions){
   if(dimensional&&[max.unit,min.unit].some(u=>u&&u!=='cm'&&u!=='UNKNOWN'))reasons.push('渠道尺寸单位尚未适配');
   for(const k of ['length','width','height'] as const){const upper=max[k]??max['max_'+k],lower=min[k]??min['min_'+k];if(positive(upper)&&Number(dimensions[k])>upper||positive(lower)&&Number(dimensions[k])<lower)reasons.push('包裹尺寸不符合限制');}
   const sum=Number(dimensions.length)+Number(dimensions.width)+Number(dimensions.height);if(positive(max.dimension_sum)&&sum>max.dimension_sum||positive(min.dimension_sum)&&sum<min.dimension_sum)reasons.push('包裹三边和不符合限制');
   if(volumetric){if(volume.unit!=='cm3'&&volume.unit!=='cm³')reasons.push('渠道体积单位尚未确认');else {const size=Number(dimensions.length)*Number(dimensions.width)*Number(dimensions.height);if(positive(volume.item_max_volume)&&size>volume.item_max_volume||positive(volume.item_min_volume)&&size<volume.item_min_volume)reasons.push('包裹体积不符合限制');}}
  }
  if(c.fee_type==='SIZE_SELECTION'){
   if(l?.sizeId===undefined)reasons.push('缺少尺寸档 sizeId');else if(!rows(c.size_list).some(s=>s.size_id===l.sizeId))reasons.push('尺寸档不属于目标渠道');
  }else if(c.fee_type==='CUSTOM_PRICE'){if(l?.shippingFee===undefined)reasons.push('缺少确认运费 shippingFee');}
  else if(!['SIZE_INPUT','FIXED_DEFAULT_PRICE'].includes(c.fee_type))reasons.push('渠道计费规则尚未适配');
  if(Object.values(rec(c.channel_relation_rules)).some(v=>Array.isArray(v)&&v.length))reasons.push('渠道关联开关规则需要确认');
  return [...new Set(reasons)].map(r=>`物流 ${label}：${r}`);
 };
 if(existing.length){
  for(const l of existing.filter(l=>l.enabled)){const channel=channels.find(c=>c.logistics_channel_id===l.id);if(!channel)issues.push(`物流 ${l.id} 不属于目标店铺`);else issues.push(...channelIssues(channel,l));}
  if(!existing.some(l=>l.enabled))issues.push('尚未启用商品物流渠道');
  for(const c of channels.filter(c=>c.force_enable===true))if(!existing.some(l=>l.enabled&&l.id===c.logistics_channel_id))issues.push(`店铺强制启用物流 ${c.logistics_channel_name||c.logistics_channel_id} 尚未应用`);
 }else{
  const safe=channels.filter(c=>c.enabled===true&&!channelIssues(c).length);
  const selected=safe.filter(c=>c.force_enable===true);
  const ordinary=safe.filter(c=>c.force_enable!==true).sort((a,b)=>a.logistics_channel_id-b.logistics_channel_id)[0];
  if(ordinary)selected.push(ordinary);
  for(const c of channels.filter(c=>c.force_enable===true))issues.push(...channelIssues(c));
  if(selected.length)patch.logistics=selected.map(c=>({id:c.logistics_channel_id,enabled:true}));
  else {
   const hints=channels.filter(c=>c.enabled===true).flatMap(c=>channelIssues(c));
   issues.push(...hints,'尚无可自动启用的目标物流，请补齐商品资料或确认渠道配置');
  }
 }
 return {patch,issues:[...new Set(issues)]};
}
