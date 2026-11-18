export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
  const response=await fetch(`/api/v1${path}`,{...options,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...options.headers}}).catch(()=>{throw new Error(options.method&&options.method!=='GET'?'连接中断，操作结果尚未确认。请先刷新记录核对，再决定是否重试。':'无法连接服务，请检查网络后重试。');});
  const body=await response.json().catch(()=>{throw Object.assign(new Error(response.status>=500?'网关未收到完整结果，后台操作可能仍在进行。请先刷新已保存记录核对，避免重复提交。':'服务返回了无法读取的结果，请刷新后重试。'),{status:response.status});});
  if(response.status===401&&path!=='/auth/login'&&typeof window!=='undefined')window.dispatchEvent(new Event('session-expired'));
  if(!response.ok){const error=new Error(Array.isArray(body.message)?body.message.join('；'):body.message||'请求未完成，请重试') as Error&{status:number};error.status=response.status;throw error;}
  if(response.ok&&path!=='/health'&&typeof window!=='undefined')window.dispatchEvent(new Event('session-restored'));
  return body as T;
}
export function errorMessage(e:unknown){return e instanceof Error?e.message:'操作未完成，请稍后重试';}
