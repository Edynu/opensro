import {actionCursor,actionStageEvents} from './action-time';
import type {AnimationMetadata} from './animation-metadata';
import type {CharacterLayer} from '@/engine/contracts/character';
import {animationActivation,type AnimationActivation} from './animation-activation';
export interface ActionPhase {readonly clip:string;readonly definition:AnimationMetadata;}
export interface ActionSchedule {
    readonly phases:readonly (ActionPhase|null)[];
    phase:number;started:number;previous:number;entered:boolean;
    cancelledAt?:number;
    activation?:AnimationActivation;
    outgoing?:{phase:ActionPhase;started:number;stopped:number;loop:boolean;activation:AnimationActivation}[];
}
// The native event lane keeps the outgoing motion during its 200ms exit.
export function actionLayers(clock:ActionSchedule,now:number):CharacterLayer[]{
    clock.outgoing=clock.outgoing?.filter(row=>now<row.stopped+.2);
    const layers:CharacterLayer[]=[];
    const phase=clock.phases[clock.phase];
    if(phase&&clock.cancelledAt===undefined){const age=Math.max(0,now-clock.started),weight=Math.min(1,age/.2);if(weight>0)layers.push({clip:phase.clip,time:age,loop:clock.phase===1,weight,lane:'event',activation:clock.activation??=animationActivation(clock.started)});}
    for(const row of clock.outgoing??[]){const weight=Math.min(1,Math.max(0,row.stopped-row.started)/.2)*Math.max(0,1-(now-row.stopped)/.2);if(weight)layers.push({clip:row.phase.clip,time:Math.max(0,now-row.started),loop:row.loop,weight,lane:'event',activation:row.activation});}
    return layers;
}
// 8df480/8df430: zero-count phases dispatch stage zero and advance immediately.
// WAIT is installed at initialization, held until 8df180 releases it to SHOT.
// Cursor state belongs to the character presenter; this helper creates no owner.
export function advanceAction(clock:ActionSchedule,now:number,shotAt?:number,cancelledAt?:number) {
    const events:{phase:string;event:number;at:number}[]=[];
    function retire(phase:ActionPhase,stopped:number){(clock.outgoing??=[]).push({phase,started:clock.started,stopped,loop:clock.phase===1,activation:clock.activation??=animationActivation(clock.started)});}
    if(clock.cancelledAt!==undefined)return {events,phase:clock.phases[clock.phase],loop:false,time:Math.max(0,clock.cancelledAt-clock.started)};
    const cancel=cancelledAt!==undefined&&cancelledAt<=now?cancelledAt:undefined;
    if(cancel!==undefined)now=Math.max(clock.started,cancel);
    while(clock.phase<3){
        const phase=clock.phases[clock.phase],name=clock.phase===0?'READY':clock.phase===1?'WAIT':'SHOT';
        const release=clock.phase<2&&clock.phases[1]&&shotAt!==undefined&&shotAt<=now?Math.max(clock.started,shotAt):undefined;
        const until=release??now;
        if(!clock.entered){events.push({phase:name,event:0,at:clock.started});clock.entered=true;}
        if(phase&&clock.phase!==1){
            const cursor=actionCursor((until-clock.started)*1000,phase.definition.durationMs);
            const marks=phase.definition.trackEvents.filter(row=>row.eventCode===1);
            for(const event of actionStageEvents(phase.definition,clock.previous,cursor,false))events.push({phase:name,event,at:clock.started+marks[event-1]!.cursorMs/1000});
            clock.previous=cursor;
            if(cursor<phase.definition.durationMs&&release===undefined)break;
        } else if(phase&&release===undefined)break;
        if(phase)retire(phase,release??clock.started+phase.definition.durationMs/1000);
        if(release!==undefined){clock.phase=2;clock.started=release;}
        else {if(phase)clock.started+=phase.definition.durationMs/1000;clock.phase++;}
        clock.previous=0;clock.entered=false;clock.activation=undefined;
    }
    const phase=clock.phases[clock.phase];
    if(cancel!==undefined){if(phase)retire(phase,cancel);clock.cancelledAt=cancel;}
    return {events,phase,loop:clock.phase===1,time:phase?Math.max(0,now-clock.started):0};
}
