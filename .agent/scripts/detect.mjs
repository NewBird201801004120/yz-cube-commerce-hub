import fs from 'node:fs';
import path from 'node:path';
import { exists, readJson, run } from './io.mjs';

const LOCKFILES = [['npm','package-lock.json'],['pnpm','pnpm-lock.yaml'],['yarn','yarn.lock'],['bun','bun.lock'],['bun','bun.lockb']];
function scriptsOf(pkg) { return pkg?.scripts ?? {}; }
export function detectProject(root,{config}={}) {
  const manifestPath = path.join(root, 'package.json');
  const pkg = exists(manifestPath) ? readJson(manifestPath) : {};
  const locks = LOCKFILES.filter(([, file]) => exists(path.join(root, file))).map(([manager, file]) => ({ manager, file, tracked: Boolean(run('git', ['ls-files', '--error-unmatch', file], root, { allowFailure: true })) }));
  const declared = pkg.packageManager?.split('@')[0] ?? null;
  const inferred = declared || locks.find(x => x.tracked)?.manager || locks[0]?.manager || (exists(manifestPath)?'npm':null);
  const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages ?? [];
  const expanded = [];
  for (const pattern of workspaces) {
    if (pattern.endsWith('/*')) {
      const base = path.join(root, pattern.slice(0, -2));
      if (exists(base)) for (const name of fs.readdirSync(base)) if (exists(path.join(base, name, 'package.json'))) expanded.push(`${pattern.slice(0, -1)}${name}`);
    } else if (exists(path.join(root, pattern, 'package.json'))) expanded.push(pattern);
  }
  const workspaceDetails = expanded.map(workspace => {
    const wpkg = readJson(path.join(root, workspace, 'package.json'));
    return { path: workspace, name: wpkg.name ?? workspace, scripts: scriptsOf(wpkg), dependencies: { ...(wpkg.dependencies ?? {}), ...(wpkg.devDependencies ?? {}) } };
  });
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...Object.assign({}, ...workspaceDetails.map(w => w.dependencies)) };
  const conflicts = [];
  if (locks.length > 1) conflicts.push({ code: 'MULTIPLE_LOCKFILES', severity: 'high', files: locks.map(x => x.file) });
  if (declared && locks.some(x => x.manager !== declared)) conflicts.push({ code: 'PACKAGE_MANAGER_MISMATCH', severity: 'high', declared, files: locks.map(x => x.file) });
  const languages=[['node','package.json'],['python','pyproject.toml'],['python','requirements.txt'],['go','go.mod'],['rust','Cargo.toml']].filter(([,file])=>exists(path.join(root,file))).map(([language])=>language);
  const verificationCommands={};
  if(['npm','pnpm','yarn','bun'].includes(inferred))for(const name of Object.keys(scriptsOf(pkg)))verificationCommands[name]={command:inferred,args:['run',name]};
  let projectConfig=config;
  if(projectConfig===undefined){const file=path.join(root,'.agent','project.yaml');try{projectConfig=exists(file)?readJson(file):{};}catch(error){conflicts.push({code:'INVALID_PROJECT_CONFIG',severity:'high',message:error.message});projectConfig={};}}
  const declaredCommands=projectConfig?.verification_commands??{};
  if(!declaredCommands||typeof declaredCommands!=='object'||Array.isArray(declaredCommands))conflicts.push({code:'INVALID_VERIFICATION_COMMANDS',severity:'high'});
  else for(const [name,spec] of Object.entries(declaredCommands)){
    delete verificationCommands[name];
    if(!spec||typeof spec.command!=='string'||!spec.command.trim()||!Array.isArray(spec.args)||!spec.args.every(x=>typeof x==='string')){conflicts.push({code:'INVALID_VERIFICATION_COMMAND',severity:'high',name});continue;}
    verificationCommands[name]={command:spec.command,args:[...spec.args]};
  }
  const requiredRootScripts=projectConfig?.required_scripts?Object.values(projectConfig.required_scripts).flat():languages.includes('node')?['lint','typecheck','test','build','verify:t0','verify:t1','verify:t2']:[];
  const missingRootScripts=requiredRootScripts.filter(name=>!verificationCommands[name]);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    detectorVersion: '0.1.0',
    git: { commit: run('git', ['rev-parse', 'HEAD'], root, { allowFailure: true }) || null, branch: run('git', ['branch', '--show-current'], root, { allowFailure: true }) || null, dirty: Boolean(run('git', ['status', '--porcelain'], root, { allowFailure: true })) },
    packageManager: { declared, inferred, lockfiles: locks },
    workspaces: workspaceDetails,
    rootScripts: scriptsOf(pkg),
    verificationCommands,
    missingRootScripts,
    stack: { languages:[...new Set(languages)], nextjs: deps.next ?? null, react: deps.react ?? null, typescript: deps.typescript ?? null, tailwind: deps.tailwindcss ?? null, radix: Object.keys(deps).some(x => x.startsWith('@radix-ui/')), cva: Boolean(deps['class-variance-authority']), shadcnInitialized: exists(path.join(root, 'components.json')) },
    conflicts
  };
}
