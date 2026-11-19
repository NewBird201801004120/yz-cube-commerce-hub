import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
// The package root exports Prisma's public types, not its executable CLI.
// Read the declared binary so npm/pnpm layouts and future CLI paths are supported.
const manifest=require.resolve('prisma/package.json');
const {bin}=JSON.parse(readFileSync(manifest,'utf8'));
const entry=typeof bin==='string'?bin:bin?.prisma;
if(typeof entry!=='string'||!entry)throw new Error('Prisma package does not declare a CLI binary');
const r=spawnSync(process.execPath,[resolve(dirname(manifest),entry),...process.argv.slice(2)],{stdio:'inherit',env:process.env});process.exit(r.status??1);
