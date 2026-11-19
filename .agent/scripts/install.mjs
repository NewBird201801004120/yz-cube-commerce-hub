import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {detectProject} from './detect.mjs';
import {loadProjectConfig,changedFiles,evaluateGate} from './gate.mjs';
import {createCommitEvidence} from './trust.mjs';
export function installProject(root){
  const config=loadProjectConfig(root),detection=detectProject(root),has=f=>fs.existsSync(path.join(root,f));
  // Dependency installers can execute project code; inspect policy and approval first.
  let gate;
  if(config.ci?.mode==='trusted'){
    if(!config.ci.contract||!config.ci.snapshot)throw new Error('Trusted installation requires ci.contract and ci.snapshot');
    const contract=JSON.parse(fs.readFileSync(path.resolve(root,config.ci.contract),'utf8')),snapshot=JSON.parse(fs.readFileSync(path.resolve(root,config.ci.snapshot),'utf8'));
    if(process.env.AEG_BASE&&process.env.AEG_BASE!==contract.baseCommit)throw new Error('CI base does not match approved contract base');
    gate=createCommitEvidence({root,contract,snapshot,runVerification:false}).gate;
  }else gate=evaluateGate({root,config,files:changedFiles(root,process.env.AEG_BASE),predictedTier:config.project?.default_task_tier??'T0'});
  if(!gate.passed)throw new Error(`Pre-install governance gate failed: ${gate.violations.map(x=>x.code).join(', ')}`);
  let commands=config.ci?.install_commands;
  if(!commands){
    commands=[];
    if(has('package.json')){
      const manager=detection.packageManager.inferred??'npm';
      const args={npm:['ci'],pnpm:['install','--frozen-lockfile'],yarn:['install','--immutable'],bun:['install','--frozen-lockfile']}[manager];
      if(!args)throw new Error(`Unsupported package manager: ${manager}; configure ci.install_commands`);
      if(manager==='yarn'){const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));const classic=pkg.packageManager?.startsWith('yarn@1.')||has('yarn.lock')&&fs.readFileSync(path.join(root,'yarn.lock'),'utf8').includes('# yarn lockfile v1');if(classic)args.splice(0,args.length,'install','--frozen-lockfile');}
      commands.push({command:manager,args});
    }
    if(has('requirements.txt'))commands.push({command:'python',args:['-m','pip','install','-r','requirements.txt']});
    else if(has('pyproject.toml'))commands.push({command:'python',args:['-m','pip','install','.']});
    if(has('go.mod'))commands.push({command:'go',args:['mod','download']});
    if(has('Cargo.toml'))commands.push({command:'cargo',args:['fetch','--locked']});
  }
  if(!Array.isArray(commands))throw new Error('ci.install_commands must be an array of {command,args}');
  for(const item of commands){
    if(typeof item.command!=='string'||!Array.isArray(item.args)||item.args.some(a=>typeof a!=='string'))throw new Error('Invalid installation command');
    const result=spawnSync(item.command,item.args,{cwd:root,stdio:'inherit'});
    if(result.status!==0)throw new Error(`Dependency installation failed: ${item.command} (${result.error?.message??result.status})`);
  }
  return{passed:true,commands};
}
