import type {AnimationMetadata, AnimationWarpCurve} from './animation-metadata';
// Native a66a40: implicit (0,0)/(1,1), linear authored knots, float stores.
export function animationWarp(curve:AnimationWarpCurve, phase:number):number {
    if(phase<=0)return 0;if(phase>=1)return 1;
    let x=0,y=0;
    for(const point of curve.records){
        if(point.phase>=phase && point.phase!==0)return Math.fround(y+(phase-x)*(point.value-y)/(point.phase-x));
        x=point.phase;y=point.value;
    }
    return Math.fround(y+(phase-x)*(1-y)/(1-x));
}
// adf220 stores naturalDuration / requestedDuration as float; ae07e0 keeps
// integer cursor plus fractional remainder. The curve is a motion integral,
// never a replacement for the skeleton's clip cursor.
export function actionCursor(elapsedMs:number, naturalDurationMs:number, requestedDurationMs=0):number {
    if(!Number.isFinite(elapsedMs)||!Number.isFinite(naturalDurationMs)||naturalDurationMs<=0||!Number.isFinite(requestedDurationMs)||requestedDurationMs<0)throw new Error('Invalid action clock');
    const rate=requestedDurationMs===0?1:Math.fround(naturalDurationMs/requestedDurationMs);
    return Math.min(naturalDurationMs,Math.max(0,Math.trunc(elapsedMs*rate)));
}
export function actionMotionWeight(definition:AnimationMetadata,previousMs:number,cursorMs:number,weight=1):number {
    if(cursorMs<=previousMs)return 0;
    const curve=definition.timeWarpCurve;
    return Math.fround(Math.fround(weight)*Math.fround(animationWarp(curve,Math.fround(cursorMs/definition.durationMs))-animationWarp(curve,Math.fround(previousMs/definition.durationMs))));
}
// ae0710 uses lower_bound at BOTH ends: [previous,cursor), not (previous,cursor].
// 8df430 dispatches stage zero on phase entry; each event-1 callback advances
// the phase-list cursor once (8df0d0), independent of its parameter words.
export function actionStageEvents(definition:AnimationMetadata,previousMs:number,cursorMs:number,entered:boolean):number[] {
    const events=entered?[0]:[];let ordinal=0;
    for(const event of definition.trackEvents){
        if(event.eventCode!==1)continue;
        ordinal++;
        if(event.cursorMs>=previousMs&&event.cursorMs<cursorMs)events.push(ordinal);
    }
    return events;
}
