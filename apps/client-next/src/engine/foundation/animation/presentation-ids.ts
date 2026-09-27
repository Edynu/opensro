/** One allocator per composed presentation. Wire GIDs are unsigned; local
 * actors occupy negative safe integers and never reuse an identity on reset. */
export function createPresentationIds():()=>number {
 let next=0;
 return ()=>{
  if(next<=Number.MIN_SAFE_INTEGER)throw Error('Presentation actor identity exhausted');
  return --next;
 };
}
