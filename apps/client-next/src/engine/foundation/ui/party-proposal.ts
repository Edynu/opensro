import type {UiRect} from '@/engine/contracts/ui';
import {frameParts} from './frame-ring';
import {messageBox} from './message-box';
export const MESSAGE_FRAME='/assets/images/Media_extracted/interface/messagebox/msgbox2_window_';
export const MESSAGE_TILE='/assets/images/Media_extracted/interface/ifcommon/bg_tile/com_bg_tile_b.png';
export const PARTY_OPTION='/assets/images/Media_extracted/interface/messagebox/msgbox_blackbox.png';
export function partyProposalAssets(){return [MESSAGE_TILE,PARTY_OPTION,...frameParts().map(p=>MESSAGE_FRAME+p+'.png')];}
// 52F460 case 7 (5305D0..530988), 525D60 and MsgBoxINIF.
// 7644E0 passes zero option bits for inbound type-1 invitations.
// The option art's natural extent and (3,7,3,6) client insets are native;
// the old port's 100x14 stretched option rectangles are not.
export function partyProposalLayout(width:number,height:number,optionSize:readonly[number,number]|undefined,position:readonly[number,number]|null=null){
 const box=messageBox(width,height,300,176,position),[x,y]=box.frame;
 const at=(dx:number,dy:number,w:number,h:number):UiRect=>[x+dx,y+dy,w,h];
 return {
  ...box,
  name:at(16,48,300,12),question:at(16,64,300,12),
  options:optionSize?[44,156].map(dx=>({image:at(dx,93,...optionSize),text:at(dx+3,100,optionSize[0]-6,optionSize[1]-13)})):[],
  accept:at(72,139,76,24),refuse:at(152,139,76,24),
 };
}
// 7644E0 type 5 -> kind 15; 52F460 retains the MsgBoxINIF geometry.
export function guildProposalLayout(width:number,height:number,position:readonly[number,number]|null=null){
 const box=messageBox(width,height,308,148,position),[x,y]=box.frame;
 const at=(dx:number,dy:number,w:number,h:number):UiRect=>[x+dx,y+dy,w,h];
 return {...box,name:at(0,52,300,12),question:at(6,70,300,12),options:[],accept:at(72,99,76,24),refuse:at(152,99,76,24)};
}
