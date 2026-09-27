import type {SkillMetadata} from './skill-catalog';
export interface SkillCooldown {readonly skill:number;readonly group:number;readonly startedAtMs:number;readonly durationMs:number;}
// 776830 -> 67ADD0 -> 84AAC0. UI references query the same manager by skill
// or nonzero cool-time group (84B010/84B0E0); cast retirement is independent.
export function skillCooldown(rows:readonly SkillCooldown[],skill:number,group:number,now:number):{remainingMs:number;fraction:number}|null {
 const row=rows.find(r=>(r.skill===skill||!!group&&r.group===group)&&now<r.startedAtMs+r.durationMs);
 if(!row)return null;
 const remainingMs=Math.max(0,row.startedAtMs+row.durationMs-now);
 return {remainingMs,fraction:Math.min(1,remainingMs/row.durationMs)};
}
export function createSkillCooldowns(){
 let rows:readonly SkillCooldown[]=[];
 return {accepted(skill:SkillMetadata,now:number){if(!skill.cooldownMs)return;const group=skill.cooldownGroup??0;const retained=rows.filter(r=>now<r.startedAtMs+r.durationMs+500&&r.skill!==skill.id&&(!group||r.group!==group));if(retained.length>=4096)throw Error('Skill cooldown capacity exceeded');rows=[...retained,{skill:skill.id,group,startedAtMs:now,durationMs:skill.cooldownMs}];},state:()=>rows,step(now:number){const next=rows.filter(r=>now<r.startedAtMs+r.durationMs+500);if(next.length===rows.length)return false;rows=next;return true;},clear(){rows=[];}};
}
