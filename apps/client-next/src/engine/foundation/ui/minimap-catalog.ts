import type {Pose} from '@/engine/contracts/gameplay';
export function minimapNpcPositions(value:unknown):ReadonlyMap<number,Pose>{
 const data=value as {format?:string;version?:number;rows?:unknown[]};if(data.format!=='sro-npcpos'||data.version!==1||!Array.isArray(data.rows)||data.rows.length>65536)throw Error('Invalid minimap NPC table');
 // 80D9D0 stores AX and three float32s. 7D7B40 inserts; duplicate IDs keep the first row.
 const result=new Map<number,Pose>();for(const row of data.rows){if(typeof row!=='string')throw Error('Invalid NPC position row');const fields=row.split('\t').map(Number);if(fields.length!==5||fields.some(n=>!Number.isFinite(n)))throw Error('Invalid NPC position');const [id,regionId,x,y,z]=fields as [number,number,number,number,number];if(!Number.isInteger(id)||id<=0||!Number.isInteger(regionId)||regionId< -32768||regionId>65535)throw Error('Invalid NPC position identity');if(!result.has(id))result.set(id,{regionId:regionId&65535,x:Math.fround(x),y:Math.fround(y),z:Math.fround(z),angle:0});}return result;
}
