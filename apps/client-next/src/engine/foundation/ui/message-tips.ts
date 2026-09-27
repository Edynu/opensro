export interface MessageTip {readonly id:number;readonly type:number;readonly minLevel:number;readonly maxLevel:number;readonly text:string;}
export function decodeMessageTips(value:unknown):readonly MessageTip[]{
 const rows=(value as {rows?:unknown})?.rows;if(!Array.isArray(rows)||rows.length>4096)throw Error('Invalid message tips');
 return rows.map(row=>{if(!row||!['id','type','minLevel','maxLevel'].every(k=>Number.isInteger(row[k]))||typeof row.text!=='string'||row.text.length>4096||row.minLevel<0||row.maxLevel<row.minLevel)throw Error('Invalid message tip');return {id:row.id,type:row.type,minLevel:row.minLevel,maxLevel:row.maxLevel,text:row.text};});
}
// 6F52B0: inclusive level interval; type 3 universal, otherwise player country.
export function eligibleMessageTips(rows:readonly MessageTip[],level:number,country:number|undefined){return rows.filter(row=>level>=row.minLevel&&level<=row.maxLevel&&(row.type===3||row.type===country));}
