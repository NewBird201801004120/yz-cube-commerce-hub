export type ProductDescription = {
 description?:string;
 description_info?:{extended_description?:{field_list?:Array<{field_type?:string;text?:string}>}};
};

/** Prefer the ordered text blocks of a rich description; fall back to plain text. */
export function productDescriptionText(item:ProductDescription):string {
 const fields=item.description_info?.extended_description?.field_list;
 const blocks=Array.isArray(fields)?fields.flatMap(field=>field?.field_type==='text'&&typeof field.text==='string'&&field.text.trim()?[field.text.trim()]:[]):[];
 return blocks.length?blocks.join('\n\n'):(typeof item.description==='string'?item.description.trim():'');
}
