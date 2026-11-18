import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configureLocalSimulation,DEFAULT_LOCALIZATION_OWNER_EMAIL} from '../team-simulation-config.mjs';

test('cold setup uses environment email without a shared login file and retains token on restart',()=>{
 const root=mkdtempSync(join(tmpdir(),'team-config-'));
 try{
  const file=configureLocalSimulation(root,{LOCALIZATION_OWNER_EMAIL:' Owner@Example.com '});
  const initial=readFileSync(file,'utf8'),clients=JSON.parse(initial);
  assert.equal(clients[0].ownerEmail,'owner@example.com');assert.equal(clients[0].tokenSha256.length,64);
  assert.equal(existsSync(join(root,'.local/shared-login.txt')),false);
  configureLocalSimulation(root,{LOCALIZATION_OWNER_EMAIL:'owner@example.com'});assert.equal(readFileSync(file,'utf8'),initial);
  assert.throws(()=>configureLocalSimulation(root,{LOCALIZATION_OWNER_EMAIL:'other@example.com'}),/不一致/);assert.equal(readFileSync(file,'utf8'),initial);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('invalid explicit environment email gives actionable configuration error without creating credentials',()=>{
 const root=mkdtempSync(join(tmpdir(),'team-config-'));
 try{for(const value of ['','not-an-email','a\nb@example.com'])assert.throws(()=>configureLocalSimulation(root,{LOCALIZATION_OWNER_EMAIL:value}),/LOCALIZATION_OWNER_EMAIL/);assert.equal(existsSync(join(root,'.local')),false);}
 finally{rmSync(root,{recursive:true,force:true});}
});

test('fresh checkout starts with the shared default without an environment or login file',()=>{
 const root=mkdtempSync(join(tmpdir(),'team-default-'));
 try{const file=configureLocalSimulation(root,{});assert.equal(JSON.parse(readFileSync(file,'utf8'))[0].ownerEmail,DEFAULT_LOCALIZATION_OWNER_EMAIL);assert.equal(existsSync(join(root,'.env.team')),false);assert.equal(existsSync(join(root,'.local/shared-login.txt')),false);}
 finally{rmSync(root,{recursive:true,force:true});}
});
