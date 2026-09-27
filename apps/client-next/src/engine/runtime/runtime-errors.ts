// Report transitions, not frames. Recovery rearms the same fault; the map is
// bounded by subsystem names rather than the number of distinct messages.
export function createRuntimeErrors(report:(message:string)=>void){
 const active=new Map<string,string>();
 return {
  update(source:string,error:string|null|undefined){
   if(!error){active.delete(source);return;}
   if(active.get(source)===error)return;
   active.set(source,error);report(`${source}: ${error}`);
  }
 };
}
