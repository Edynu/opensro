import type {EntityState} from '@/engine/contracts/world';
import type {Pose} from '@/engine/contracts/gameplay';

/** Retained admission order; animation and presentation still run every frame. */
export function createCharacterSelection(limit:number){
    type Row={entity:EntityState;gid:number;priority:number;distance:number};
    const input:Row[]=[],ranked:Row[]=[],selected:EntityState[]=[];
    return {
        select(entities:readonly EntityState[],anchor:Pose|undefined,localGid:number|undefined,mountedOn:number|undefined):readonly EntityState[]{
            let changed=input.length!==entities.length;
            for(let i=0;i<entities.length;i++){
                const entity=entities[i]!,priority=entity.gid===localGid?0:entity.gid===mountedOn?1:2;
                const x=anchor?entity.x+((entity.regionId&255)-(anchor.regionId&255))*1920-anchor.x:0;
                const z=anchor?entity.z+((entity.regionId>>>8)-(anchor.regionId>>>8))*1920-anchor.z:0;
                const distance=x*x+z*z,row=input[i];
                if(!row){input.push({entity,gid:entity.gid,priority,distance});changed=true;}
                else {changed=changed||row.gid!==entity.gid||row.priority!==priority||row.distance!==distance;row.entity=entity;row.gid=entity.gid;row.priority=priority;row.distance=distance;}
            }
            input.length=entities.length;
            if(changed){
                ranked.length=input.length;for(let i=0;i<input.length;i++)ranked[i]=input[i]!;
                ranked.sort((a,b)=>a.priority-b.priority||a.distance-b.distance||a.entity.gid-b.entity.gid);
            }
            selected.length=Math.min(limit,ranked.length);
            for(let i=0;i<selected.length;i++)selected[i]=ranked[i]!.entity;
            return selected;
        },
        reset(){input.length=0;ranked.length=0;selected.length=0;}
    };
}
