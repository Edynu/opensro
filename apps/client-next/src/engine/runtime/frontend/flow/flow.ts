import type {FrontendPhase,FrontendSnapshot} from "@/engine/contracts/frontend";
export function createFrontendFlow(){
 let phase:FrontendPhase="loading-title",generation=1,elapsed=0,error:string|null=null,revealLogoAlpha=0;
 function introAlpha(){return Math.max(0,Math.min(1,(elapsed-15)/3));}
 function enter(next:FrontendPhase){phase=next;elapsed=0;generation++;}
 return {
  ready(epoch:number){if(epoch!==generation)return;if(phase==="loading-title")enter("intro");else if(phase==="loading-dock")enter("dock-arrival");else if(phase==='loading-create')enter('customize');else if(phase==='loading-race')enter('create');},
  reveal(){if(phase==="intro"){revealLogoAlpha=introAlpha();enter("login-reveal");}},
  authenticated(){if(phase==='loading-title'||phase==='intro'){enter('loading-dock');}else if(phase==="login"||phase==="login-reveal"){enter("login-accepted");}},
  create(){if(phase==="dock")enter("create-arrival");},
  back(){if(phase==="create")enter("create-return");else if(phase==='customize')enter('create-exit');},
  race(){if(phase==='create')enter('race-zoom');},
  created(){if(phase==='customize')enter('loading-dock');},
  entryRejected(){if(phase==='loading-world')enter('loading-dock');},
  leave(){if(phase==='dock')enter('title-exit');},
  returnedToDock(){if(phase==='world'||phase==='loading-world')enter('loading-dock');},
  start(){if(phase==="dock")enter("departing");},
  resumeWorld(){if(phase!=='loading-world'&&phase!=='world')enter('loading-world');},
  worldReady(){if(phase==="loading-world")enter("world");},
  fail(message:string){if(phase==="failed")return;error=message;enter("failed");},
  reset(){error=null;enter("loading-title");},
  advance(delta:number,cameraComplete=false){if(!Number.isFinite(delta)||delta<0)throw new Error("Invalid frontend delta");elapsed+=Math.min(delta,3);
   if(phase==="login-reveal"&&elapsed>=.5)enter("login");
   else if(phase==="login-accepted"&&elapsed>=.5)enter("loading-dock");
   else if(phase==="dock-arrival"&&cameraComplete)enter("dock");
   else if(phase==="create-arrival"&&cameraComplete)enter("create");
   else if(phase==="create-return"&&cameraComplete)enter("dock");
   else if(phase==='race-zoom'&&cameraComplete)enter('loading-create');
   else if(phase==='create-exit'&&elapsed>=.5)enter('loading-race');
   else if(phase==='title-exit'&&cameraComplete)enter('title-logout');
   else if(phase==="departing"&&elapsed>=.5)enter("loading-world");
  },
  snapshot():FrontendSnapshot{return {phase,generation,elapsed,error,alpha:phase==="intro"?introAlpha():Math.min(1,elapsed/.5),logoAlpha:phase==="intro"?introAlpha():phase==="login-reveal"?revealLogoAlpha*Math.max(0,1-elapsed/.5):0};},
  dispose(){error=null;enter("failed");}
 };
}
