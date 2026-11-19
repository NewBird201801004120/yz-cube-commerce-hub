#!/usr/bin/env node
import fs from 'node:fs';
import {installProject} from './install.mjs';
import {verifyProject} from './verify.mjs';
import path from 'node:path';
import { detectProject } from './detect.mjs';
import { changedFiles, evaluateGate, loadProjectConfig } from './gate.mjs';
import { applyClarification, classifyIntent, createLedger, writeLedger } from './intake.mjs';
const [command, ...args] = process.argv.slice(2);
const value = flag => { const i=args.indexOf(flag); return i>=0 ? args[i+1] : undefined; };
const root=path.resolve(value('--root') ?? process.cwd());
const ledgerFile=id=>{const clean=id.replace(/\.ya?ml$/,'');if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(clean))throw new Error(`Invalid ledger id: ${id}`);const base=path.resolve(root,'.agent','ledger'),file=path.resolve(base,`${clean}.yaml`);if(!file.startsWith(`${base}${path.sep}`))throw new Error('Ledger path escapes root');return file;};
const print=x=>process.stdout.write(`${JSON.stringify(x,null,2)}\n`);
if(command==='install')print(installProject(root));
else if(command==='verify'){const result=verifyProject({root,base:value('--base'),predicted:value('--predicted'),trusted:args.includes('--trusted'),contractFile:value('--contract'),snapshotFile:value('--snapshot')});print(result);if(!result.passed)process.exitCode=1;}
else if(command==='detect') print(detectProject(root));
else if(command==='intake'){const intent=classifyIntent(value('--text')??'',{projectName:loadProjectConfig(root)?.project?.name??'PROJECT'});if(args.includes('--write')){const id=value('--id');if(!id)throw new Error('--id required');print({intent,file:writeLedger(root,createLedger(intent,id))});}else print(intent);}
else if(command==='clarify'){const id=value('--ledger'),answer=value('--answer');if(!id||!answer)throw new Error('--ledger and --answer required');const file=ledgerFile(id);const ledger=JSON.parse(fs.readFileSync(file,'utf8'));applyClarification(ledger,answer);fs.writeFileSync(file,`${JSON.stringify(ledger,null,2)}\n`);print({file,clarifications:ledger.clarifications,intent:ledger.intent});}
else if(command==='gate'){const config=loadProjectConfig(root);const ledgerId=value('--ledger');const ledger=ledgerId?JSON.parse(fs.readFileSync(ledgerFile(ledgerId),'utf8')):null;const explicit=(value('--allowed')??'').split(',').filter(Boolean);const result=evaluateGate({root,config,files:changedFiles(root,value('--base')),predictedTier:value('--predicted')??ledger?.tier?.predicted??'T0',allowedPaths:explicit.length?explicit:ledger?.scope?.allowed_paths??[]});print(result);if(!result.passed)process.exitCode=1;}
else{console.error('Usage: node .agent/scripts/cli.mjs <detect|gate|verify> [--root PATH] [--base REF] [--predicted TIER] [--allowed GLOB,GLOB]');process.exitCode=2;}
