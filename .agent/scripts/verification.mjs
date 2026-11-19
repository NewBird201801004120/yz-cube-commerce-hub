import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import {detectProject} from './detect.mjs';

// argv execution deliberately avoids shell interpolation. A declared command is
// project code, and follows the same authorization/trust boundary as test scripts.
export function runChecks(root,names,{config,timeoutMs=120000}={}){
  if(!Array.isArray(names)||!names.every(x=>typeof x==='string'))throw new Error('Verification names must be an array of strings');
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>3600000)throw new Error('Invalid verification timeout');
  const detection=detectProject(root,{config});
  return names.map(name=>{
    const start=Date.now(),spec=Object.hasOwn(detection.verificationCommands,name)?detection.verificationCommands[name]:null;
    const invalid=detection.conflicts.some(x=>x.code==='INVALID_PROJECT_CONFIG'||x.code==='INVALID_VERIFICATION_COMMANDS'||x.code==='INVALID_VERIFICATION_COMMAND'&&x.name===name);
    let result;try{result=!spec||invalid?{status:null,error:new Error(`Missing or invalid verification command: ${name}`)}:spawnSync(spec.command,spec.args,{cwd:root,encoding:'utf8',timeout:timeoutMs,maxBuffer:1024*1024,shell:false});}catch(error){result={status:null,error};}
    return {name,passed:result.status===0&&!result.error,status:result.status??null,durationMs:Date.now()-start,outputHash:crypto.createHash('sha256').update(`${result.stdout??''}${result.stderr??''}${result.error?.message??''}`).digest('hex'),...(spec?{command:spec.command,args:spec.args}:{}),...(result.error?{error:result.error.code??'VERIFICATION_UNAVAILABLE'}:{})};
  });
}
