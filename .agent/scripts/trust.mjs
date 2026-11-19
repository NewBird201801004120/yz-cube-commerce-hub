import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { safeContainedPath, assertSafeId } from './safe-path.mjs';
import { loadPolicyPack } from './policy.mjs';
import { changedFiles, evaluateGate, loadProjectConfig } from './gate.mjs';
import { run } from './io.mjs';
import {runChecks} from './verification.mjs';
export {runChecks} from './verification.mjs';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export const canonicalJson=value=>JSON.stringify(canonical(value));
export const sha256=value=>crypto.createHash('sha256').update(typeof value==='string'?value:canonicalJson(value)).digest('hex');
const writeAtomic=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});fs.renameSync(tmp,file);};
const git=(root,args,allowFailure=false)=>run('git',args,root,{allowFailure});
export const gitContext=root=>({commit:git(root,['rev-parse','HEAD']),tree:git(root,['rev-parse','HEAD^{tree}']),branch:git(root,['branch','--show-current'],true)||null});

export function compilePolicySnapshot({root,packRoot,policyIds=[],taskId=null}){
  const config=loadProjectConfig(root),state=JSON.parse(fs.readFileSync(path.join(root,'.agent','state.json'),'utf8'));
  if(!/^prj_[a-f0-9]{24}$/.test(state.projectId??''))throw new Error('Invalid project identity');
  if(typeof state.governanceVersion!=='string'||!config.project||!config.required_scripts)throw new Error('Incomplete project governance configuration');
  const packs=loadPolicyPack(packRoot,policyIds.length?policyIds:state.enabledPacks??[]);
  const missing=packs.filter(x=>!x.available).map(x=>x.id);if(missing.length)throw new Error(`Missing policy packs: ${missing.join(', ')}`);
  const source={governanceVersion:state.governanceVersion,projectId:state.projectId,projectConfig:config,projectOverrides:state.overrides??[],packs:packs.map(x=>({id:x.id,contentHash:sha256(x.content),content:x.content}))};
  const digest=sha256(source),snapshotId=`pol_${digest.slice(0,24)}`,snapshot={schemaVersion:1,snapshotId,taskId,createdAt:new Date().toISOString(),sourceHash:digest,...source,git:gitContext(root)};
  snapshot.integrity=sha256({...snapshot,createdAt:undefined,integrity:undefined});return snapshot;
}
export function savePolicySnapshot(root,snapshot){assertSafeId(snapshot.snapshotId,'snapshot id');const file=safeContainedPath(path.join(root,'.agent'),'runtime','snapshots',`${snapshot.snapshotId}.json`);writeAtomic(file,snapshot);return file;}
export function loadPolicySnapshot(root,id){assertSafeId(id,'snapshot id');return JSON.parse(fs.readFileSync(safeContainedPath(path.join(root,'.agent'),'runtime','snapshots',`${id}.json`),'utf8'));}
export function verifyPolicySnapshot(snapshot){const actual=sha256({...snapshot,createdAt:undefined,integrity:undefined});return{passed:actual===snapshot.integrity,expected:snapshot.integrity,actual};}

export function buildExecutionContract({session,snapshot,baseCommit=snapshot.git.commit,allowedPaths=null,successCriteria=null,nonGoals=null}){
  if(session.workspace?.projectId&&session.workspace.projectId!==snapshot.projectId)throw new Error('Session and policy snapshot project mismatch');
  const i=session.interpretation?.intent??{},config=snapshot.projectConfig,allowed=allowedPaths??i.scope?.allowed_paths??session.contract?.allowedPaths??[];
  const contract={schemaVersion:1,contractId:`ctr_${sha256({taskId:session.id,snapshot:snapshot.snapshotId,baseCommit,allowed}).slice(0,24)}`,taskId:session.id,goal:session.request.text,projectId:snapshot.projectId,workspace:session.workspace?.root??null,baseCommit,policySnapshotId:snapshot.snapshotId,delivery:session.interpretation?.workflow??'unknown',predictedTier:i.risk?.predictedTier??'T0',allowedPaths:allowed,forbiddenPaths:config.frozen_paths??[],requiredDocs:config.required_docs??[],structure:config.structure??{},dependencyPolicy:config.dependency_policy??{},verificationScripts:config.required_scripts??{},successCriteria:successCriteria??i.successCriteria??['目标功能完成','对应风险等级验证通过'],nonGoals:nonGoals??session.contract?.excludes??[],approvedAt:null};
  return{...contract,integrity:sha256(contract)};
}
export function verifyExecutionContract(contract){const {integrity,...body}=contract;const actual=sha256(body);return{passed:integrity===actual,expected:integrity,actual};}
export function approveExecutionContract(contract,{actor='user',at=new Date().toISOString(),source=null,consequence=null}={}){if(!verifyExecutionContract(contract).passed)throw new Error('Invalid execution contract');if(consequence&&!source?.trim())throw new Error('Consequence confirmation requires an explicit approval source');const next={...contract,approvedAt:at,approvedBy:actor,approvalSource:source};if(consequence)next.consequenceConfirmation={contractId:contract.contractId,baseCommit:contract.baseCommit,policySnapshotId:contract.policySnapshotId,source,consequence,actor,at};delete next.integrity;return{...next,integrity:sha256(next)};}
export function saveExecutionContract(root,contract){assertSafeId(contract.contractId,'contract id');const file=safeContainedPath(path.join(root,'.agent'),'runtime','contracts',`${contract.contractId}.json`);writeAtomic(file,contract);return file;}
export function loadExecutionContract(root,id){assertSafeId(id,'contract id');return JSON.parse(fs.readFileSync(safeContainedPath(path.join(root,'.agent'),'runtime','contracts',`${id}.json`),'utf8'));}


export function createCommitEvidence({root,contract,snapshot,baseCommit=contract.baseCommit,runVerification=true}){
  const policyCheck=verifyPolicySnapshot(snapshot),contractCheck=verifyExecutionContract(contract);if(!policyCheck.passed||!contractCheck.passed)throw new Error('Contract or policy snapshot integrity failure');
  if(contract.policySnapshotId!==snapshot.snapshotId||contract.projectId!==snapshot.projectId)throw new Error('Contract and policy snapshot mismatch');
  if(baseCommit!==contract.baseCommit)throw new Error('Evidence base must match contract base');
  const state=JSON.parse(fs.readFileSync(path.join(root,'.agent/state.json'),'utf8'));if(state.projectId!==contract.projectId)throw new Error('Evidence project mismatch');
  const ancestor=spawnSync('git',['merge-base','--is-ancestor',baseCommit,'HEAD'],{cwd:root});if(ancestor.status!==0)throw new Error('Contract base is not an ancestor of HEAD');
  const beforeHash=workspaceHash(root);
  const head=gitContext(root),files=changedFiles(root,baseCommit),gate=evaluateGate({root,config:snapshot.projectConfig,files,predictedTier:contract.predictedTier,allowedPaths:contract.allowedPaths,contract,snapshot});
  const scripts=snapshot.projectConfig.required_scripts?.[gate.effectiveTier]??[],checks=runVerification&&gate.violations.length===0?runChecks(root,scripts,{config:snapshot.projectConfig}):[];
  const body={schemaVersion:1,evidenceId:null,taskId:contract.taskId,contractId:contract.contractId,policySnapshotId:snapshot.snapshotId,baseCommit,headCommit:head.commit,headTree:head.tree,createdAt:new Date().toISOString(),changedFiles:files,gate,checks,requiredChecks:scripts,verificationCompleted:runVerification&&checks.length===scripts.length,workspaceHash:beforeHash,workspaceStable:beforeHash===workspaceHash(root),contractHash:contract.integrity,snapshotHash:snapshot.integrity,passed:gate.passed&&runVerification&&checks.length===scripts.length&&checks.every(x=>x.passed)&&beforeHash===workspaceHash(root)};
  body.evidenceId=`evd_${sha256(body).slice(0,24)}`;body.integrity=sha256({...body,integrity:undefined});return body;
}
export function saveEvidence(root,evidence){assertSafeId(evidence.evidenceId,'evidence id');const file=safeContainedPath(path.join(root,'.agent'),'runtime','evidence',`${evidence.evidenceId}.json`);writeAtomic(file,evidence);return file;}
export function loadEvidence(root,id){assertSafeId(id,'evidence id');return JSON.parse(fs.readFileSync(safeContainedPath(path.join(root,'.agent'),'runtime','evidence',`${id}.json`),'utf8'));}
// Bind all tracked and non-ignored untracked files, including dirty contents and modes.
// Runtime artifacts are excluded to avoid invalidating evidence by saving evidence itself.
export function workspaceHash(root){
  const files=git(root,['ls-files','-z','--cached','--others','--exclude-standard']).split('\0').filter(Boolean);
  return sha256([...new Set(files)].filter(f=>!f.startsWith('.agent/runtime/')).sort().map(file=>{
    const full=path.join(root,file);try{const st=fs.lstatSync(full);return{file,mode:st.mode,type:st.isSymbolicLink()?'link':'file',hash:st.isSymbolicLink()?sha256(fs.readlinkSync(full)):sha256(fs.readFileSync(full).toString('base64'))};}catch(e){if(e.code==='ENOENT')return{file,deleted:true};throw e;}
  }));
}
export function verifyEvidence(root,evidence,{contract=null,snapshot=null}={}){
  const {integrity,...body}=evidence,actual=sha256(body),head=gitContext(root);
  const checks=[{id:'integrity',passed:integrity===actual},{id:'head-commit',passed:evidence.headCommit===head.commit},{id:'head-tree',passed:evidence.headTree===head.tree},{id:'workspace',passed:evidence.workspaceStable===true&&evidence.workspaceHash===workspaceHash(root)},{id:'gate',passed:evidence.gate?.passed===true},{id:'verification',passed:evidence.verificationCompleted===true&&Array.isArray(evidence.requiredChecks)&&Array.isArray(evidence.checks)&&evidence.checks.length===evidence.requiredChecks.length&&evidence.requiredChecks.every((name,i)=>evidence.checks[i]?.name===name&&evidence.checks[i]?.passed===true&&evidence.checks[i]?.status===0)},{id:'evidence-result',passed:evidence.passed===true}];
  if(contract||snapshot){
    checks.push({id:'contract-policy-binding',passed:!!contract&&!!snapshot&&verifyExecutionContract(contract).passed&&verifyPolicySnapshot(snapshot).passed&&contract.projectId===snapshot.projectId&&contract.policySnapshotId===snapshot.snapshotId&&evidence.contractId===contract.contractId&&evidence.taskId===contract.taskId&&evidence.policySnapshotId===snapshot.snapshotId&&evidence.baseCommit===contract.baseCommit&&evidence.contractHash===contract.integrity&&evidence.snapshotHash===snapshot.integrity});
    if(contract&&snapshot){const expected=snapshot.projectConfig.required_scripts?.[evidence.gate?.effectiveTier]??[];checks.push({id:'required-checks',passed:canonicalJson(expected)===canonicalJson(evidence.requiredChecks)});let projectId;try{projectId=JSON.parse(fs.readFileSync(path.join(root,'.agent/state.json'))).projectId;}catch{}checks.push({id:'project',passed:projectId===contract.projectId});}
  }
  return{schemaVersion:2,passed:checks.every(x=>x.passed),checks,current:head,evidence:{id:evidence.evidenceId,commit:evidence.headCommit}};
}
