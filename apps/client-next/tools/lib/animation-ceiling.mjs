// Diagnostic intervention, never shipping optimization. Only the owned capture
// window freezes warmed skeletal poses. Actor/world transforms remain live.
export function createAnimationCeiling(freeze=false,alternate=false,combined=false){
 let mode=0,worldCalls=0,worldSkipped=0,worldCold=0,replay=freeze,frames=0,active=false,eligible=0,skipped=0,cold=0,builds=0,copies=0,joints=0;
 return {
  start(){active=true;frames=0;mode=worldCalls=worldSkipped=worldCold=0;replay=freeze;eligible=skipped=cold=builds=copies=joints=0;},
  pause(){active=false;},
  frame(){if(active&&combined){mode=[0,1,3,2,2,3,1,0][Math.floor(frames++/16)%8];replay=Boolean(mode&1);}else if(active&&alternate)replay=Math.floor(frames++/16)%2===1;return active&&replay?1:0;},
  worldMode(){return active&&combined&&(mode&2)?1:0;},
  worldReplay(ready){if(!active||!combined)return false;worldCalls++;if(!ready){worldCold++;return false;}if(mode&2){worldSkipped++;return true;}return false;},
  skip(ready,allowed){if(!active||!allowed)return false;eligible++;if(!ready){cold++;return false;}if(replay){skipped++;return true;}return false;},
  palette(built,count,allowed){if(!active||!allowed)return;copies++;if(built){builds++;joints+=count;}},
  stats(){return {freeze,alternate,combined,worldCalls,worldSkipped,worldCold,eligible,skipped,cold,paletteBuilds:builds,paletteCopies:copies,paletteJointsBuilt:joints,qualification:'Diagnostic frozen skeletal poses and optional stale world selection; visual fidelity intentionally fails. Current camera transforms and draws remain live. Palette copying/upload and renderer bookkeeping remain. Particle/ribbon models excluded from pose replay. Includes eligible portraits.'};}
 };
}
export function instrumentAnimationCeiling(source){
 source=source.replace(/\r\n/g,'\n');
 const insert=(marker,value)=>{if(source.split(marker).length!==2)throw Error('Animation ceiling boundary changed: '+marker);source=source.replace(marker,marker+value);};
 insert('const bindings=paletteBindings(model);','const ceilingEligible=model.primitives.some(p=>p.joints.length>1)&&!model.primitives.some(p=>p.emission||p.ribbon);');
 const evaluation=source.includes('layers?:readonly CharacterLayer[],defer=false)')?'evaluate(name: string, seconds: number, loop = true, layers?:readonly CharacterLayer[],defer=false) {':'evaluate(name: string, seconds: number, loop = true, layers?:readonly CharacterLayer[]) {';
 insert(evaluation,'if(globalThis.__worldProbeAnimationCeiling?.skip(hasPose,ceilingEligible))return false;');
 insert('cached={version:-1,data:new Float32Array(primitive.joints.length*16)};palettes.set(primitive,cached);}', 'globalThis.__worldProbeAnimationCeiling?.palette(cached.version!==poseVersion,primitive.joints.length,ceilingEligible);');
 return source;
}

export function instrumentWorldSelectionCeiling(source){
 const marker='if(!viewChanged&&!fadesChanging&&targetCellX===retainedTargetX&&targetCellZ===retainedTargetZ){';
 if(source.split(marker).length!==2)throw Error('World ceiling boundary changed');
 return source.replace(marker,'if(globalThis.__worldProbeAnimationCeiling?.worldReplay(!!lastView)||(!viewChanged&&!fadesChanging&&targetCellX===retainedTargetX&&targetCellZ===retainedTargetZ)){');
}
