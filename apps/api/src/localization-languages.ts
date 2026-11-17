/** Market-scoped copy options; listing eligibility still requires target-platform validation. */
const marketLanguages:Record<string,string[]>={PH:['English','Filipino'],SG:['English','简体中文'],MY:['Bahasa Melayu','English'],TH:['ไทย'],VN:['Tiếng Việt'],TW:['繁體中文'],ID:['Bahasa Indonesia'],BR:['Português'],MX:['Español'],CO:['Español'],CL:['Español']};
export function supportedLanguages(defaultLanguage:string,region?:string):string[]{
 const choices=region?marketLanguages[region]:undefined;
 if(!choices)return [defaultLanguage];
 return choices.includes(defaultLanguage)?[defaultLanguage,...choices.filter(x=>x!==defaultLanguage)]:[...choices];
}
