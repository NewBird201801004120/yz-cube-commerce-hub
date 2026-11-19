import fs from 'node:fs';
import path from 'node:path';
import { changedFiles, evaluateGate, loadProjectConfig } from './gate.mjs';
import { createCommitEvidence, verifyEvidence, runChecks } from './trust.mjs';
export function verifyProject({root,base,predicted, trusted=false,contractFile,snapshotFile}) {
  const config=loadProjectConfig(root);
  trusted=trusted||config.ci?.mode==='trusted';
  if(trusted){
    contractFile=contractFile??config.ci?.contract;
    snapshotFile=snapshotFile??config.ci?.snapshot;
    if(!contractFile||!snapshotFile)throw new Error('Trusted verification requires contract and snapshot JSON paths (--contract/--snapshot or project ci configuration)');
    const contract=JSON.parse(fs.readFileSync(path.resolve(root,contractFile),'utf8')),snapshot=JSON.parse(fs.readFileSync(path.resolve(root,snapshotFile),'utf8'));
    if(base&&base!==contract.baseCommit)throw new Error('CI base does not match approved contract base');
    const evidence=createCommitEvidence({root,contract,snapshot});
    const verification=verifyEvidence(root,evidence,{contract,snapshot});
    return{mode:'trusted',gate:evidence.gate,evidence,verification,passed:verification.passed};
  }
  const gate=evaluateGate({root,config,files:changedFiles(root,base),predictedTier:predicted??config.project?.default_task_tier??'T0'});
  const checks=gate.passed?runChecks(root,config.required_scripts?.[gate.effectiveTier]??[],{config}):[];
  return{mode:'basic',gate,checks,passed:gate.passed&&checks.every(check=>check.passed)};
}
