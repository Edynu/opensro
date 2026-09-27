export interface CharacterFade {mode:boolean;current:number;start:number;progress:number;}
// 8632d0 snapshots current alpha only when the target changes. 862c60 stores
// float progress, then 9c2660/cvttsd2si truncates the interpolated integer alpha.
export function advanceCharacterFade(state:CharacterFade,hidden:boolean,seconds:number):number {
 if(!Number.isFinite(seconds)||seconds<0)throw new Error('Invalid character fade clock');
 if(state.mode!==hidden){state.mode=hidden;state.start=state.current;state.progress=0;}
 if(state.progress<1){state.progress=Math.min(1,Math.fround(state.progress+2*Math.fround(seconds)));const target=hidden?0:255;state.current=state.progress===1?target:Math.trunc(state.start+(target-state.start)*state.progress);}
 return state.current/255;
}
