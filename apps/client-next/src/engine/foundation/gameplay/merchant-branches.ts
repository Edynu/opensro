export type MerchantBranchId=number&{readonly merchantBranchId:unique symbol};
export interface MerchantBranch {readonly id:MerchantBranchId;readonly labelSymbol:string;readonly tabs:readonly number[];}

// Native 5D5BE0 menu rows name refshoptabgroup; the shop shows that group's
// tabs. Keep the wire catalogue's absolute tab identities through filtering.
export function merchantBranches(value:unknown):readonly MerchantBranch[]{
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>256)throw Error('Invalid merchant groups');
 const branches: {id:MerchantBranchId;labelSymbol:string;tabs:number[]}[]=[];let tabIndex=0;
 for(const group of value){
  if(!group||!Array.isArray(group.Tabs))throw Error('Invalid merchant tabs');
  for(const tab of group.Tabs){
   if(tabIndex>255)throw Error('Merchant tab capacity');
   // Older detached fixtures do not publish group metadata.
   if(tab.GroupID!==undefined&&tab.GroupID!==0){
    if(!Number.isInteger(tab.GroupID)||tab.GroupID<1||tab.GroupID>0x7fffffff||typeof tab.GroupLabelSymbol!=='string'||!tab.GroupLabelSymbol||tab.GroupLabelSymbol.length>256)throw Error('Invalid merchant branch');
    let branch=branches.find(b=>b.id===tab.GroupID);
    if(!branch){branch={id:tab.GroupID as MerchantBranchId,labelSymbol:tab.GroupLabelSymbol,tabs:[]};branches.push(branch);}
    if(branch.labelSymbol!==tab.GroupLabelSymbol||branch.tabs.length>=4)throw Error('Invalid merchant branch tabs');
    branch.tabs.push(tabIndex);
   }
   tabIndex++;
  }
 }
 return branches;
}
