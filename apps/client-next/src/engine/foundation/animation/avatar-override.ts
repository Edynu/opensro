// 8EAA90: surviving attached items retain their list position. New avatars are
// appended in source order; the first record with the lowest priority wins.
export interface AvatarOverride {readonly animation:string;readonly priority:number;}
export interface AvatarOverrideSelection {readonly order:readonly number[];readonly selected?:number;}
export function selectAvatarOverride(previous:AvatarOverrideSelection|undefined,current:readonly number[],records:Readonly<Record<string,AvatarOverride>>):AvatarOverrideSelection{
 const admitted=new Set(current),order=(previous?.order??[]).filter(id=>admitted.has(id));
 for(const id of current)if(!order.includes(id))order.push(id);
 let selected:number|undefined;
 for(const id of order){const row=records[id];if(!row?.animation)continue;if(selected===undefined||row.priority<records[selected]!.priority)selected=id;}
 return {order,selected};
}
