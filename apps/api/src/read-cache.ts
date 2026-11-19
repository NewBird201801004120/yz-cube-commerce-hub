/** Bounded, process-local snapshots for display reads only. Never use for write preconditions. */
export class ReadCache {
 private values=new Map<string,{expires:number;value:unknown;bytes:number}>();
 private pending=new Map<string,Promise<unknown>>();
 private bytes=0;
 constructor(private now=Date.now,private maxEntries=128,private maxBytes=16*1024*1024){}
 clear(){this.values.clear();this.pending.clear();this.bytes=0;}
 async read<T>(key:string,ttl:number,load:()=>Promise<T>,fresh=false):Promise<T>{
  const cached=this.values.get(key);
  if(!fresh&&cached&&cached.expires>this.now())return structuredClone(cached.value) as T;
  if(cached){this.values.delete(key);this.bytes-=cached.bytes;}
  const existing=this.pending.get(key);
  if(!fresh&&existing)return structuredClone(await existing) as T;
  // A forced refresh supersedes an older in-flight load; it must not refill the cache later.
  const request=Promise.resolve().then(load);
  this.pending.set(key,request);
  try{
   const value=await request;
   if(this.pending.get(key)===request&&ttl>0){
    const bytes=Buffer.byteLength(JSON.stringify(value)??'null');
    if(bytes<=this.maxBytes){
     for(const [k,v] of this.values)if(v.expires<=this.now()){this.values.delete(k);this.bytes-=v.bytes;}
     while(this.values.size>=this.maxEntries||this.bytes+bytes>this.maxBytes){const first=this.values.entries().next().value;if(!first)break;this.values.delete(first[0]);this.bytes-=first[1].bytes;}
     this.values.set(key,{expires:this.now()+ttl,value:structuredClone(value),bytes});this.bytes+=bytes;
    }
   }
   return structuredClone(value);
  }finally{if(this.pending.get(key)===request)this.pending.delete(key);}
 }
}
