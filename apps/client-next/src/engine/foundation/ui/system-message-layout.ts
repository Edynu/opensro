import {tooltipColor} from './tooltip-rows';
import type {UiQuad,UiRect,UiControl} from '@/engine/contracts/ui';
import type {AuthoredLayout} from './authored-layout';
import {chatScrollbar} from './chat-scrollbar';
import {textBoxLines} from './text-lines';
// CIFSystemMessage: 42px groups of three text lines; two groups at construction.
export function systemMessageLayout(layout:AuthoredLayout,width:number,height:number,rows:number,lines:readonly (string|{readonly value:string;readonly colorArgb:number})[],size:(path:string)=>readonly[number,number]|undefined,text:(value:string,r:UiRect,clip:UiRect,color:UiQuad['color'])=>readonly UiQuad[],hover:string|null,pressed:string|null,offset=0,measure:(value:string)=>number=value=>value.length*7,keepChrome=false){
 const rowsWithColor=lines.filter(row=>(typeof row==='string'?row:row.value).length>0).flatMap(row=>{const value=typeof row==='string'?row:row.value,colorArgb=typeof row==='string'?0xffdbc99b:row.colorArgb;return textBoxLines(value,316,measure,true).map(value=>({value,colorArgb}));});
 const quads:UiQuad[]=[],controls:UiControl[]=[],paths:string[]=[],x=width-357,y=height-90-(rows*42+33),full:UiRect=[0,0,width,height],white=[1,1,1,1] as const;
 const chrome=keepChrome||hover?.startsWith('status-')===true,background:UiRect=[x,y,353,rows*42+33];controls.push({id:'status-panel',label:'System messages',kind:'region',rect:background});
 for(const [suffix,dy,h]of [['UP',0,4],['MID',4,rows*42+25],['DOWN',rows*42+29,4]] as const){const node=layout['GDR_SYETEM_MESSAGE_BG_'+suffix]!;paths.push(node.texture);if(chrome&&size(node.texture))quads.push({texture:node.texture,rect:[x,y+dy,335,h],uv:node.uv,color:white,clip:full});}
 // 524AA5..524AD7: bottom-align short lists by the unused row count.
 const end=rowsWithColor.length-Math.min(Math.max(0,offset),Math.max(0,rowsWithColor.length-rows*3)),clip:UiRect=[x+10,y+15,316,rows*42],visible=rowsWithColor.slice(Math.max(0,end-rows*3),end),padding=Math.max(0,rows*3-rowsWithColor.length)*14;visible.forEach((row,i)=>quads.push(...text(row.value,[clip[0],clip[1]+padding+i*14,clip[2],14],clip,tooltipColor(row.colorArgb))));
 const scroll=chatScrollbar('status-scroll',[x+337,y+37,16,Math.max(0,rows*42-57)],rowsWithColor.length,rows*3,offset,size,full,hover,pressed);paths.push(...scroll.paths);if(chrome)quads.push(...scroll.quads);if(chrome)controls.push(...scroll.controls);
 const filter=layout.GDR_SYETEM_MESSAGE_CHATOPTION_BTN!,filterVariants=['','_focus','_press'].map(s=>filter.texture.replace('.png',s+'.png'));paths.push(...filterVariants);const filterPath=filterVariants[pressed==='status-filter'?2:hover==='status-filter'?1:0]!;if(chrome&&size(filterPath))quads.push({texture:filterPath,rect:[x+337,y,16,20],uv:[0,0,1,1],color:white,clip:full});if(chrome)controls.push({id:'status-filter',label:'Message filtering',kind:'button',rect:[x+337,y,16,20]});
 const node=layout.GDR_SYETEM_MESSAGE_SIZE_BTN!,r:UiRect=[x+337,y+rows*42+13,16,20],variants=['','_focus','_press'].map(s=>node.texture.replace('.png',s+'.png'));paths.push(...variants);const path=variants[pressed==='status-size'?2:hover==='status-size'?1:0]!;if(chrome&&size(path))quads.push({texture:path,rect:r,uv:[0,0,1,1],color:white,clip:full});if(chrome)controls.push({id:'status-size',label:'Change status panel size',kind:'button',rect:r});
 return {quads,controls,paths,blocks:[[x,y,353,rows*42+33] as UiRect],scrolling:{range:scroll.range,travel:scroll.travel,bounds:background}};
}
