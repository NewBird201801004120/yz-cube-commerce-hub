export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
  const response=await fetch(`/api/v1${path}`,{...options,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...options.headers}});
  const body=await response.json().catch(()=>{throw Object.assign(new Error(response.status>=500?'网关未收到完整结果，后台操作可能仍在进行。请先刷新已保存记录核对，避免重复提交。':'服务返回了无法读取的结果，请刷新后重试。'),{status:response.status});});
  if(!response.ok){const error=new Error(body.message||'请求未完成') as Error&{status:number};error.status=response.status;throw error;}
  return body as T;
}
export function errorMessage(e:unknown){return e instanceof Error?e.message:'操作未完成，请稍后重试';}
