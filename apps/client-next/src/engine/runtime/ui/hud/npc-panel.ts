import type {NpcConversation} from '@/engine/foundation/gameplay/npc-dialogue';
import type {UiEvent,UiRect} from '@/engine/contracts/ui';
// Presentation-only scroll ownership; packet/quest authority stays in gameplay.
export function createNpcPanel(){
 let destinations=false;let key='',top=0,range=0,travel=0,bounds:UiRect=[0,0,0,0];
 const clamp=(value:number)=>Math.max(0,Math.min(range,value));
 return {
  observe(state:NpcConversation|undefined){const next=state&&state.phase!=='closed'?JSON.stringify([state.gid,state.dialogueRevision,state.phase==='menu'?null:state.dialogue]):'';if(next!==key){key=next;destinations=false;top=0;range=0;return true;}return false;},
  destinations:()=>destinations,
  top:()=>top,
  geometry(value:{range:number;travel:number;bounds:UiRect}){range=value.range;travel=value.travel;bounds=value.bounds;top=clamp(top);},
  event(event:UiEvent){if(!key)return false;
   if(event.kind==='activate'&&event.id==='npc-portal-open'){destinations=true;top=0;return true;}
   if(event.kind==='activate'&&(event.id==='npc-scroll-up'||event.id==='npc-scroll-down')){top=clamp(Math.round(top)+(event.id==='npc-scroll-up'?-1:1));return true;}
   if(event.kind==='drag'&&event.id==='npc-scroll-thumb'){if(travel>0)top=clamp(top+event.dy*range/travel);return true;}
   if(event.kind==='scroll'&&event.x>=bounds[0]&&event.x<bounds[0]+bounds[2]+30&&event.y>=bounds[1]&&event.y<bounds[1]+bounds[3]){top=clamp(Math.round(top)+Math.sign(event.delta)*3);return true;}return false;
  },
 };
}
