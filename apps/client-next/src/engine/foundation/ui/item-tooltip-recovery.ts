import type {InventoryItem} from '@/engine/contracts/gameplay';
import type {TooltipRow} from './tooltip-rows';

// Complete parameter branches of 557230 except its live cooldown-clock lookup.
// Cure parameters are neither HP/MP amounts nor the abnormal icon bit indexes.
export function itemTooltipRecovery(item:InventoryItem,text:(symbol:string)=>string):readonly TooltipRow[]{
 const f=item.tooltip?.fields,t=(item.typeFlags>>>7)&15,k=item.typeFlags>>>11;
 if(!f||(item.typeFlags&0x7e)!==0x6c||(t!==1&&t!==2))return [];
 const rows:TooltipRow[]=[],add=(value:string)=>rows.push({value,color:0xffffffff});
 const value=(i:number)=>f['itemParam'+(i+1)+'_'+(0x29c+i*4).toString(16)]??0;
 const values=[value(0),value(1),value(2),value(3),value(4),value(5)] as const;
 if(t===1){
  if(k===9){if(values[0]>0)add(`${text('PARAM_HEAL_HGP')}[${values[0]}%]`);}
  else if(![6,8,10].includes(k))for(const [i,symbol,ratio]of [[0,'PARAM_HEAL_HP',false],[1,'PARAM_HEAL_HP',true],[2,'PARAM_HEAL_MP',false],[3,'PARAM_HEAL_MP',true]] as const)if(values[i]>0)add(`${text(symbol)}[${values[i]}]${ratio?'%':''}`);
 }else if(k===1){
  for(const [mask,symbol]of [[0x1e2800,'PARAM_WEAKLY'],[0x1c0,'PARAM_RESTRICTION'],[0x1e18600,'PARAM_CURSING']] as const)if(values[0]&mask)add(`${text(symbol)}${text('PARAM_CURE')} ${values[1]}${text('UIIT_STT_GRADE')}`);
 }else if(values.every(value=>value>0))add(`${text('PARAM_CURE_STATE')} ${values[0]}`);
 else for(const [i,suffix]of ['FROZEN','FROSTBITE','BURN','ESHOCK','POISON','ZOMBIE'].entries())if(value(i)>0)add(`${text('PARAM_CURE_'+suffix+'_LV')} ${value(i)}`);
 return rows;
}
