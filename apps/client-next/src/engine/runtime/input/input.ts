import {sightMode,thirdPersonYaw,type SightMode} from '@/engine/foundation/rendering/camera-options';
import type { InputOwner, InputCommand, RawInput } from "@/engine/contracts/input";
import {zoomCamera} from '@/engine/foundation/rendering/camera-wheel';
import {virtualKey} from '@/engine/foundation/ui/input-options';
export function createInput(): InputOwner {
    let queue: InputCommand[] = [], sequence = 0, failure: string | null = null;
    let dropKey=90,dropHeld=false,blindKey=86,blindHeld=false;
    let sight:SightMode=0,mouseMode:0|1=0;
    let pointer:{x:number;y:number}|null=null,buttons=0,yaw=0,pitch=Math.PI/18,distance=80;
    return {
        dropNameBinding(value:number){dropKey=value;dropHeld=false;},
        dropNamesHeld:()=>dropHeld,
        blindBinding(value:number){blindKey=value;blindHeld=false;},
        blindHeld:()=>blindHeld,
        mouseMode(value:0|1){if(value!==0&&value!==1)throw Error("Invalid mouse mode");mouseMode=value;pointer=null;buttons=0;},
        sight(value:SightMode){sight=sightMode(value);},
        camera(playerYaw?:number){if(sight===1&&playerYaw!==undefined)yaw=thirdPersonYaw(playerYaw);return {yaw,pitch,distance};},
        accept(event: RawInput) {
            if (failure)
                return;
            if (queue.length >= 512) {
                failure = "Input queue exceeded 512 commands";
                return;
            }
            if(!Number.isFinite(event.timeMs)||event.kind==='pointer'&&(!Number.isFinite(event.x)||!Number.isFinite(event.y)||!Number.isInteger(event.buttons))||event.kind==='wheel'&&!Number.isFinite(event.delta)){failure='Invalid camera/input event';return;}
            // Platform capture has already filtered UI-owned events. Camera
            // response belongs to this display-thread owner, not worker ticks.
            if(event.kind==='release'){pointer=null;buttons=0;dropHeld=false;blindHeld=false;}
            else if(event.kind==='key'&&dropKey&&virtualKey(event.code)===dropKey)dropHeld=event.down;
            else if(event.kind==='key'&&blindKey&&virtualKey(event.code)===blindKey)blindHeld=event.down;
            else if(event.kind==='pointer'){
                if(pointer&&(buttons&(mouseMode===0?2:1))&&(event.buttons&(mouseMode===0?2:1))){yaw+=(event.x-pointer.x)*.005;if(sight!==2)pitch=Math.max(-1.0707963705062866,Math.min(1.0707963705062866,pitch+(event.y-pointer.y)*Math.fround(.005)));}
                pointer={x:event.x,y:event.y};buttons=event.buttons;
            }else if(event.kind==='wheel')distance=zoomCamera(distance,event.delta);
            queue.push({ ...event, sequence: ++sequence });
        },
        drain() {
            if (!queue.length)
                return null;
            const commands = queue;
            queue = [];
            return { first: commands[0]!.sequence, last: commands[commands.length - 1]!.sequence, commands };
        },
        error: () => failure
    };
}
