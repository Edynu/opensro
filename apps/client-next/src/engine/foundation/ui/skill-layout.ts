export interface SkillUi {readonly slots:Readonly<Record<string,SkillUi['skills']>>;readonly masteries:readonly {id:number;name:string;count:number;tab:number;tabName:string;icon:string}[];readonly groups:readonly {mastery:number;row:number;name:string;icon:string}[];readonly skills:readonly {id:number;group:number;level:number;mastery:number;row:number;column:number;icon:string;name:string;study:string}[];}
export function decodeSkillUi(value:unknown):SkillUi {
 const v=value as SkillUi&{version:number};if(v?.version!==1)throw Error('Invalid skill UI version');
 for(const [rows,ints,strings] of [[v.masteries,['id','count','tab'],['name','tabName','icon']],[v.groups,['mastery','row'],['name','icon']],[v.skills,['id','group','level','mastery','row','column'],['name','icon','study']]] as const){if(!Array.isArray(rows)||rows.length>65536)throw Error('Invalid skill UI rows');for(const row of rows){const r=row as unknown as Record<string,unknown>;if(!r||ints.some(k=>!Number.isSafeInteger(r[k])||(r[k] as number)<0)||strings.some(k=>typeof r[k]!=='string'))throw Error('Invalid skill UI row');}}
 const relativeIcon=(icon:string)=>icon.replace(/^icon[\\/]/i,'');
 const slots:Record<string,SkillUi['skills'][number][]>={};for(const row of v.skills){const key=row.mastery+':'+row.row+':'+row.column;(slots[key]??=[]).push({...row,icon:relativeIcon(row.icon)});}
 return {slots,masteries:v.masteries.map(r=>({...r,icon:relativeIcon(r.icon)})),groups:v.groups.map(r=>({...r,icon:relativeIcon(r.icon)})),skills:v.skills.map(r=>({...r,icon:relativeIcon(r.icon)}))};
}
