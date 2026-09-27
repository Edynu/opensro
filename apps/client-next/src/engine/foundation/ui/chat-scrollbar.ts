import type {UiQuad,UiRect,UiControl} from '@/engine/contracts/ui';
// CIFVerticalScroll 545190/545290 and linked thumb value 5439D0.
export function chatScrollbar(id:string,r:UiRect,total:number,visible:number,offset:number,size:(path:string)=>readonly[number,number]|undefined,clip:UiRect,hover:string|null,pressed:string|null){
 const quads:UiQuad[]=[],paths:string[]=[],controls:UiControl[]=[],root='/assets/images/Media_extracted/interface/';
 const range=Math.max(0,total-visible),position=range?Math.trunc((range-Math.min(range,Math.max(0,offset)))*r[3]/range):0;
 const image=(path:string,rect:UiRect)=>{paths.push(path);if(size(path))quads.push({texture:path,rect,uv:[0,0,1,1],color:[1,1,1,1],clip});};
 function button(suffix:string,label:string,path:string,rect:UiRect,draggable=false){const key=id+'-'+suffix,variants=['','_focus','_press'].map(s=>path.replace('.png',s+'.png'));paths.push(...variants);image(variants[pressed===key?2:hover===key?1:0]!,rect);controls.push({id:key,label,rect,kind:'button',draggable});}
 image(root+'ifcommon/com_scroll_bar.png',[r[0],r[1],16,r[3]+16]);
 button('up','Scroll up',root+'chattingwnd/chat_arrow_up.png',[r[0],r[1]-16,16,16]);
 button('down','Scroll down',root+'chattingwnd/chat_arrow_down.png',[r[0],r[1]+r[3]+16,16,16]);
 button('thumb','Scroll messages',root+'ifcommon/com_scroll_button.png',[r[0],r[1]+position,16,16],true);
 return {quads,paths,controls,range,travel:r[3]};
}
