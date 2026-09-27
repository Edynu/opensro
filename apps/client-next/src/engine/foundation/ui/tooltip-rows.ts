export interface TooltipRow {readonly value:string;readonly color:number;readonly heading?:boolean;readonly strong?:boolean;readonly ornament?:'item'|'diamond';}
export function tooltipFormat(template:string,...values:(string|number)[]):string {
 let i=0;return template.replace(/%%|%[sd]/g,token=>token==='%%'?'%':String(values[i++]??''));
}
export function tooltipColor(argb:number):readonly [number,number,number,number]{return [(argb>>>16&255)/255,(argb>>>8&255)/255,(argb&255)/255,(argb>>>24)/255];}
