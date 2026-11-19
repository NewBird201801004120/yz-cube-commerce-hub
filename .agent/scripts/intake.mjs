import fs from 'node:fs';
import path from 'node:path';

const hasAny=(text,terms)=>terms.some(term=>text.includes(term));
const unique=xs=>[...new Set(xs)];
const T3=['支付','付款','账本','点数','积分','权限','登录','认证','auth','billing','payment','ledger','migration','迁移','生产数据','删除数据'];
const BACKEND=['后端','接口','api','数据库','服务端','worker','provider','http','支付','登录','权限','账本','webhook'];
const FRONTEND=['页面','界面','ui','按钮','组件','首页','官网','落地页','h5','动效','仪表盘','工作台','后台页面','前端','卡片','视觉','app','应用','平台','可交互','交互式','saas'];
const MOTION=['动效','动画','高动效','炫酷','震撼','粒子','three.js','webgl','gsap','沉浸'];
const BRAND=['官网','落地页','品牌站','发布页','hero','作品集','营销页'];
const PRODUCT=['仪表盘','工作台','后台','设置页','数据表','dashboard','控制台'];
const COMMERCE=['商品','商详','购物车','结算','电商','商城'];
const H5=['h5','小程序页','移动端页面','手机页面','竖屏活动'];
const EXISTING=['cue','现有','已有','当前项目','这个页面','把首页','在项目','优化','修改','增加','接入','修复'];
const PROTOTYPE=['demo','演示','原型','提案','快速展示','临时'];
const PRODUCTION=['正式','上线','生产','长期维护','可继续开发','商用'];
const DEMO=['demo','演示','演示版','原型','提案','快速展示','只验证流程','假数据','给我看看'];
const LARGE=['完整创作平台','完整产品','真实支付','退款','对账','迁移现有','统一重做','多个服务','不停机','商业化运营','整套登录','所有已有账号'];
const SMALL=['改文案','文案改成','颜色改成','增加一个','参数校验','按钮溢出','只修改','不改接口','不调整','页面优化一下'];

export function classifyIntent(text,{projectName='PROJECT',decisions={}}={}){
  const raw=text.trim(); const t=raw.toLowerCase();
  const domains=[]; if(hasAny(t,FRONTEND)||hasAny(t,['网页','手机']))domains.push('frontend'); if(hasAny(t,BACKEND)&&!hasAny(t,['不改接口','接口兼容']))domains.push('backend');
  if(!domains.length && hasAny(t,['搜索','筛选'])) domains.push('frontend');
  // Negation and simulation are scoped to individual risk subjects. A mock UI
  // must never suppress a separate real payment, migration or permission change.
  const clauses=t.split(/[，,。；;]|但是|但|同时|并且/).filter(Boolean);
  const active = (terms) => terms.some(term => clauses.some(c => c.includes(term) && !new RegExp(`(?:不要|不做|不需要|不接|不连接|不上|不|非)\\s*(?:真实)?${term}`).test(c)));
  const explicitProduction=active(PRODUCTION)||active(['真实支付','真实付款','生产数据']);
  const demoLike=active(DEMO)&&!explicitProduction;
  const pureCopy=hasAny(t,['文案','改字','颜色','间距','样式']) && !hasAny(t,['接入','新增接口','支付流程','迁移','重构','实现','删除数据','修改权限判断','生产数据','删除','更改权限','调整权限']);
  const riskSignals=T3.filter(term=>clauses.some(c=>{
    if(!c.includes(term))return false;
    if(new RegExp(`(?:不改|不调整|不接|不连接|不迁移|不删除)\\s*(?:真实)?${term}`).test(c))return false;
    if(pureCopy&&new RegExp(`${term}(?:不足)?(?:提示|按钮|页面|页)?(?:文案|颜色|间距|样式)`).test(c)&&!hasAny(c,['开放','授予','撤销','删除','执行','并','和']))return false;
    if(hasAny(c,['真实','生产数据']))return true;
    const scopedMock=clauses.some(x=>x.includes(term)&&hasAny(x,['模拟','假数据','不连接','不接真实']));
    const displayOnly=hasAny(c,['页面','登录页']) && demoLike && hasAny(t,['假数据','模拟']);
    return !(demoLike&&((scopedMock&&hasAny(c,['页面','登录页','展示']))||displayOnly||hasAny(c,['模拟','假数据'])));
  }));
  const highRisk=riskSignals.length>0;
  let predictedTier=highRisk?'T3':domains.includes('backend')?'T2':domains.includes('frontend')?'T1':'T0';
  if(pureCopy&&!highRisk)predictedTier='T0';
  if(demoLike&&!highRisk&&predictedTier==='T2')predictedTier='T1';
  if(hasAny(t,['重构','共用搜索结果','真实视频 provider']))predictedTier=highRisk?'T3':'T2';
  if(hasAny(t,LARGE)&&!demoLike)predictedTier='T3';
  const action=hasAny(t,['修复','bug','报错','坏了','错误'])?'fix':hasAny(t,['新建','从零','做一个','做个','做完整','做成','出一个','出个','快速出','快速展示','演示一个','创建','生成','实现','搭建','开发','写个','写一个','build a','create a'])?'create':hasAny(t,['优化','修改','增加','接入','改成','新增','加一个','迁移','重构','重做','替换','拆成','完善','升级','改造'])?'modify':'unknown';
  const existing=hasAny(t,EXISTING)||(projectName!=='PROJECT'&&t.includes(projectName.toLowerCase()));
  const softwareSubject=domains.length>0||hasAny(t,['脚本','代码','系统','项目','产品','csv','重构','迁移','优化一下','工具','函数','模块','组件','算法','程序','插件','sdk','微服务','命令行','软件包']);
  const explanatory=/^(?:请|帮我)?(?:解释|介绍|什么是|为什么|如何理解|总结|翻译|你好|谢谢)/.test(t);
  const explicitNonSoftware=hasAny(t,['写一封信','写一首诗','写一个故事','写一篇文章','整理会议纪要']);
  // null means interpretation is still needed; it must not silently bypass
  // development governance as if an ordinary conversation had been identified.
  const isSoftwareRequest=explanatory||explicitNonSoftware?false:softwareSubject&&action!=='unknown'?true:null;

  let delivery=decisions['delivery.mode']??(explicitProduction?'production':demoLike?'prototype':existing?'maintainable':hasAny(t,['脚本','批处理','csv','整理文件'])&&!domains.length?'one-off':'unspecified');
  if(decisions['search.scope']==='all_visible'&&!highRisk){predictedTier='T2';if(!domains.includes('backend'))domains.push('backend');}
  let primarySkill=null,register=null;
  const visual=domains.includes('frontend');
  if(visual&&predictedTier!=='T0'){
    if(action==='create'&&!existing&&hasAny(t,['产品','应用','平台','app'])&&!hasAny(t,[...BRAND,...PRODUCT,...COMMERCE,...H5])) primarySkill='finesse-brief';
    else if(hasAny(t,H5)){primarySkill='finesse-ui';register='h5';}
    else if(hasAny(t,COMMERCE)){primarySkill='finesse-ui';register='commerce';}
    else if(hasAny(t,BRAND)||hasAny(t,MOTION)){primarySkill='finesse-ui';register='brand';}
    else if(hasAny(t,['优化','审查','改得高级','高级一些','更清楚','polish'])) primarySkill='design-review';
    else if(hasAny(t,PRODUCT)){primarySkill='finesse-ui';register='product';}
  }
  const assumptions=[]; const candidates=[];
  if(action==='create'&&!existing&&delivery==='unspecified'&&!decisions['delivery.mode']) candidates.push({field:'delivery.mode',impact:3,uncertainty:3,question:'这个成果以后还需要继续开发吗？',why:'这会决定代码是优先快速展示，还是按长期维护标准组织。',recommended:'maintainable',options:[{id:'maintainable',label:'可继续开发版（推荐）',description:'页面做好，同时遵守正式项目结构和基础测试。'},{id:'prototype',label:'快速演示版',description:'优先尽快完成界面和效果，使用可撤销的模拟数据。'},{id:'production',label:'完整产品版',description:'同时考虑真实数据、登录、运维和完整验证。'}]});
  if(!decisions['search.scope']&&hasAny(t,['搜索','筛选'])&&!hasAny(t,['当前页面','已加载','全部成员','后台全部','服务端搜索','服务端成员搜索'])) candidates.push({field:'search.scope',impact:3,uncertainty:3,question:`搜索需要覆盖哪些${hasAny(t,['成员'])?'成员':hasAny(t,COMMERCE)?'商品':'数据'}？`,why:'只筛选当前页面和搜索后台全部数据，工作量与数据范围明显不同。',recommended:'all_visible',options:[{id:'all_visible',label:'全部可见数据（推荐）',description:'搜索当前用户有权查看的全部数据，通常需要后端支持。'},{id:'loaded_only',label:'当前页面数据',description:'只过滤已经加载的数据，实现更快。'}]});
  if(!decisions['success.outcome']&&(raw.length<8||hasAny(t,['优化一下','改好看点','高级一点','给我看看','完善一下']))&&!hasAny(t,['首页','组件','工作台','官网','按钮','卡片'])) candidates.push({field:'success.outcome',impact:3,uncertainty:3,question:'你最希望这次改变哪种结果？',why:'没有明确结果时，容易出现做了很多修改却没有解决你的问题。',recommended:'clarity',options:[{id:'clarity',label:'更清楚好用（推荐）',description:'优先信息层级、操作路径和状态反馈。'},{id:'visual',label:'更有视觉冲击',description:'优先品牌感、视觉表现和动效。'},{id:'conversion',label:'更容易促成操作',description:'优先引导用户完成核心动作。'}]});
  if(!candidates.length&&delivery==='unspecified'){delivery='maintainable';assumptions.push('未明确交付模式；按可继续开发、可撤销的默认方式推进。');}
  if(!domains.length) assumptions.push('未识别到明确技术领域；进入规划前需结合目标项目文件定位。');
  const question=candidates.sort((a,b)=>b.impact*b.uncertainty-a.impact*a.uncertainty)[0]??null;
  const confidence=action==='unknown'||!domains.length?'low':question?'medium':'high';
  const scopeSize=hasAny(t,LARGE)?'large':hasAny(t,SMALL)||pureCopy||(!domains.length&&predictedTier==='T0')?'small':'medium';
  const size=delivery==='prototype'?'demo':scopeSize;
  return {schemaVersion:1,source:{text:raw,projectName},action,isSoftwareRequest,domains:unique(domains),delivery:{mode:delivery},project:{size:'unknown'},task:{existingProject:existing,size,scopeSize,sizeAuthority:'intake-prediction',...(decisions['search.scope']?{searchScope:decisions['search.scope']}:{}),...(decisions['success.outcome']?{successOutcome:decisions['success.outcome']}:{})},risk:{predictedTier,signals:riskSignals,finalAuthority:'diff-gate',phaseBlocked:predictedTier==='T3'},ui:{primarySkill,register,projectRulesOverrideSkill:true},confidence,clarification:question?{required:true,...question,materialImpact:'answer changes scope, acceptance or delivery plan'}:{required:false},assumptions};
}

export function createLedger(intent,id){return {task:{id,request:intent.source.text},goal:{statement:intent.source.text,outcomes:[],non_goals:[]},scope:{allowed_paths:[],forbidden_paths:[]},tier:{predicted:intent.risk.predictedTier,effective:null},intent,clarifications:[],verification:{required:[],evidence:[]}};}
export function applyClarification(ledger,answer){const q=ledger.intent?.clarification;if(!q?.required)throw new Error('No pending clarification');const option=q.options.find(x=>x.id===answer);if(!option)throw new Error(`Invalid answer: ${answer}`);ledger.clarifications??=[];ledger.clarifications.push({field:q.field,question:q.question,answer:option.id,label:option.label,answeredAt:new Date().toISOString()});const decisions=Object.fromEntries(ledger.clarifications.map(x=>[x.field,x.answer]));ledger.intent=classifyIntent(ledger.intent.source.text,{projectName:ledger.intent.source.projectName??'PROJECT',decisions});ledger.tier.predicted=ledger.intent.risk.predictedTier;return ledger;}
export function writeLedger(root,ledger){const id=ledger.task.id;if(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id))throw new Error(`Invalid ledger id: ${id??''}`);const base=path.resolve(root,'.agent','ledger'),file=path.resolve(base,`${id}.yaml`);if(!file.startsWith(`${base}${path.sep}`))throw new Error('Ledger path escapes root');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,`${JSON.stringify(ledger,null,2)}\n`);return file;}
