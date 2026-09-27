import {readTextDataRowsSync} from '../shared/textDataIo.mjs';

// 7F1EA0: item-code lookup, animation string, extra resource, unsigned byte
// priority. 7E03B0 returns the first inserted value (unique-key tree).
export function parseAvatarVisualOverrides(rows,equipment){
 const byCode=new Map([...equipment.values()].map(row=>[row.code,row.id])),result={};
 for(const cells of rows){
  if(Number(cells[0])===0)continue;
  if(cells.length!==5)throw Error('Invalid avatar visual override row');
  const id=byCode.get(cells[1]),priority=Number(cells[4]);
  if(id===undefined)throw Error('Unknown avatar item '+cells[1]);
  if(!Number.isInteger(priority)||priority<0||priority>255)throw Error('Invalid avatar animation priority');
  const animation=cells[2],additionalBsr=cells[3].replaceAll('\\','/').toLowerCase();
  if(additionalBsr&&(!additionalBsr.startsWith('res/')||!additionalBsr.endsWith('.bsr')||additionalBsr.includes('..')))throw Error('Invalid auxiliary avatar resource');
  if(!Object.hasOwn(result,id))result[id]={animation,priority,additionalBsr};
 }
 return result;
}
export function loadAvatarVisualOverrides(file,equipment){return parseAvatarVisualOverrides(readTextDataRowsSync(file),equipment);}

// 8EADF0/8EA820 consume override sets independently of skillaniset rows.
// Keep all authored state IDs for enabled override names; never synthesize a
// missing state or borrow a similarly named resource from another body.
export function avatarAnimationRequirements(bsr,overrides,skillRequirements){
 const result=new Map([...skillRequirements].map(([name,ids])=>[name,new Set(ids)]));
 for(const row of Object.values(overrides)){
  const name=row.animation.toLowerCase();if(!name)continue;
  const set=bsr.animationSets?.find(set=>set.name.toLowerCase()===name);if(!set)continue;
  const ids=result.get(name)??new Set();
  for(const state of set.states)if(state.animationPath)ids.add(state.stateId);
  result.set(name,ids);
 }
 return result;
}
