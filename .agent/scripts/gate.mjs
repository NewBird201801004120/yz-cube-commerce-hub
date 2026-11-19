import fs from 'node:fs';
import path from 'node:path';
import { readJson, run } from './io.mjs';
import { detectProject } from './detect.mjs';

const RANK = { T0: 0, T1: 1, T2: 2, T3: 3 };
const maxTier = (a, b) => RANK[a] >= RANK[b] ? a : b;
function globToRegExp(glob) {
  let out = '^';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') { if(glob[i+2]==='/'){out+='(?:.*/)?';i+=2;}else{out += '.*'; i++;} }
    else if (ch === '*') out += '[^/]*';
    else out += ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${out}$`);
}
const matches = (file, globs = []) => globs.some(glob => globToRegExp(glob).test(file));
export function changedFiles(root, base) {
  let committed=[];
  if(base){
    const object=run('git',['rev-parse','--verify','--end-of-options',`${base}^{}`],root);
    const type=run('git',['cat-file','-t',object],root);
    if(!['commit','tree'].includes(type))throw new Error(`Diff base must resolve to a commit or tree: ${base}`);
    const range=type==='tree'?[object,'HEAD']:[`${object}...HEAD`];
    committed=run('git',['diff','--name-only','-z',...range],root).split('\0').filter(Boolean);
  }
  const tracked = run('git', ['diff', '--name-only', '-z', 'HEAD'], root).split('\0').filter(Boolean);
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard', '-z'], root).split('\0').filter(Boolean);
  return [...new Set([...committed, ...tracked, ...untracked])].sort();
}
export function evaluateGate({ root, config, files, predictedTier = 'T0', allowedPaths = [], contract = null }) {
  const detection = detectProject(root,{config});
  const violations = [];
  const reasons = [];
  if (!(predictedTier in RANK)) throw new Error(`Invalid risk tier: ${predictedTier}`);
  for (const rule of config.risk_rules ?? []) if (!(rule.tier in RANK)) throw new Error(`Invalid risk tier: ${rule.tier}`);
  let effectiveTier = predictedTier;
  if (detection.conflicts.some(x => x.code === 'MULTIPLE_LOCKFILES')) violations.push({ code: 'MULTIPLE_LOCKFILES', files: detection.packageManager.lockfiles.map(x => x.file) });
  for(const doc of config.required_docs??[])if(!fs.existsSync(path.join(root,doc)))violations.push({code:'MISSING_REQUIRED_DOC',file:doc});
  for (const file of files) {
    if (matches(file, config.frozen_paths)) violations.push({ code: 'FROZEN_PATH_CHANGED', file });
    if (allowedPaths.length && !matches(file, allowedPaths)) violations.push({ code: 'OUTSIDE_ALLOWED_PATHS', file });
    if((config.structure?.allowed_roots??[]).length&&!matches(file,config.structure.allowed_roots))violations.push({code:'OUTSIDE_PROJECT_STRUCTURE',file});
    if(matches(file,config.structure?.forbidden_patterns??[]))violations.push({code:'FORBIDDEN_STRUCTURE',file});
    for (const rule of config.risk_rules ?? []) if (matches(file, rule.paths)) {
      const next = maxTier(effectiveTier, rule.tier);
      if (next !== effectiveTier) reasons.push({ code: 'RISK_PATH', file, from: effectiveTier, to: next });
      effectiveTier = next;
    }
  }
  try{const pkg=readJson(path.join(root,'package.json')),all={...(pkg.dependencies??{}),...(pkg.devDependencies??{})};for(const name of config.dependency_policy?.denied??[])if(name in all)violations.push({code:'DENIED_DEPENDENCY',dependency:name});if((config.dependency_policy?.allowed??[]).length)for(const name of Object.keys(all))if(!config.dependency_policy.allowed.includes(name))violations.push({code:'UNAPPROVED_DEPENDENCY',dependency:name});}catch{}
  const crossWorkspace = new Set(files.map(f => f.match(/^apps\/[^/]+/)?.[0]).filter(Boolean));
  if (crossWorkspace.size > 1 && RANK[effectiveTier] < RANK.T2) { reasons.push({ code: 'MULTIPLE_WORKSPACES', workspaces: [...crossWorkspace], from: effectiveTier, to: 'T2' }); effectiveTier = 'T2'; }
  for (const file of files.filter(file => /^\.agent\/ledger\/.*\.(json|ya?ml)$/.test(file))) {
    try {
      const ledger = readJson(path.join(root, file));
      const missing = ['task', 'goal', 'scope', 'tier', 'verification'].filter(key => !ledger[key] || typeof ledger[key] !== 'object');
      if (missing.length) violations.push({ code: 'INVALID_LEDGER', file, missing });
    } catch (error) { violations.push({ code: 'INVALID_LEDGER', file, error: error instanceof Error ? error.message : 'parse_error' }); }
  }
  if (!Array.isArray(config.required_scripts?.[effectiveTier])) violations.push({code:'MISSING_VERIFICATION_PLAN',tier:effectiveTier});
  if ((config.required_scripts?.[effectiveTier] ?? []).some(name => !detection.verificationCommands[name])) {
    violations.push({ code: 'MISSING_REQUIRED_SCRIPTS', tier: effectiveTier, scripts: (config.required_scripts[effectiveTier] ?? []).filter(name => !detection.verificationCommands[name]) });
  }
  if(contract&&RANK[effectiveTier]>=RANK.T2&&!contract.approvedAt)violations.push({code:'CONTRACT_APPROVAL_REQUIRED',tier:effectiveTier});
  if (effectiveTier === 'T3' && !(contract && contract.consequenceConfirmation && contract.consequenceConfirmation.contractId===contract.contractId && contract.consequenceConfirmation.baseCommit===contract.baseCommit && contract.consequenceConfirmation.policySnapshotId===contract.policySnapshotId && contract.consequenceConfirmation.source?.trim() && contract.consequenceConfirmation.consequence?.trim() && contract.approvedAt)) violations.push({ code: 'T3_REQUIRES_HUMAN_CONSEQUENCE_CONFIRMATION' });
  return { schemaVersion: 2, predictedTier, effectiveTier, changedFiles: files, reasons, violations, passed: violations.length === 0 };
}
export function loadProjectConfig(root,{lite=false}={}) {
  if(!lite)return readJson(path.join(root,'.agent','project.yaml'));
  return {project:{name:path.basename(root),lifecycle:'demo',scale:'demo',default_task_tier:'T1'},required_docs:[],frozen_paths:[],structure:{allowed_roots:[],forbidden_patterns:[]},dependency_policy:{denied:[],allowed:[]},risk_rules:[],required_scripts:{T0:[],T1:[],T2:[],T3:[]}};
}
