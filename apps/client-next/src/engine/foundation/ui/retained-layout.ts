/** One product per owner; keys contain explicit domain values, never world state. */
export function createRetainedLayout<T>(){
 let keys:readonly unknown[]=[],product:T|undefined,valid=false,rebuilds=0,reuses=0;
 return {
  read(next:readonly unknown[],build:()=>T):T{
   if(valid&&keys.length===next.length&&keys.every((value,i)=>Object.is(value,next[i]))){reuses++;return product!;}
   const value=build();keys=[...next];product=value;valid=true;rebuilds++;return value;
  },
  stats:()=>({rebuilds,reuses}),
  reset(){keys=[];product=undefined;valid=false;}
 };
}
