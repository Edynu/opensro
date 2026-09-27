// v1.150: 679E60 defaults; 5CD750 capture/conflict sweep; 5CC700 apply.
export interface InputOptions {readonly keys:readonly number[];readonly mouseMode:0|1;}
export function inputLabels():readonly string[]{return ["UIIT_STT_CHARACTER", "UIIT_STT_INVENTORY", "UIIT_STT_SKILL", "UIIT_STT_ACTION", "UIIT_STT_PARTY", "UIIT_STT_QUEST", "UIIT_STT_COMMUNITY", "UIIT_STT_WORLDMAP", "UIIT_STT_HWANMODE", "UIIT_STT_HELP", "UIIT_STT_VIEW_DROPPED_ITEM", "UIIT_STT_MOUSE_RIGHT_BUTTON", "UIIT_CTL_TOG_SIT_STAND_TT", "UIIT_CTL_AUTOGET_TT", "UIIT_STT_OPTION_COS_INFO", "UIIT_STT_OPTION_COS_RIDE", "UIIT_STT_OPTION_COS_SUMMONCANCEL", "UIIT_STT_OPTION_COS_FOLLOW", "UIIT_STT_OPTION_COS_ATTACK", "UIIT_STT_OPTION_COS_AI", "UIIT_CTL_REPLY_TT", "UIIT_PAG_MACROPOTION_TITLE", "UIIT_STT_OPTION_COS", "UIIT_STT_TOGGLE_PARTYMATCH", "UIIT_CTL_ALCHEMYBOX", "UIIT_STT_WARENETWORK_TITLE", "UIIT_STT_ENEMYUSER_SELECT_KEY", "UIIT_STT_LATEST_TARGET", "UIIT_STT_ASSIST_TARGET", "UIIT_STT_FACE_TARGET", "UIIT_STT_USER_MOSTER_BLIND", "UIIT_CTL_TC_TRAININGCAMP", "UIIT_STT_BLIND_ALLY", "UIIT_STT_BLIND_ENEMY"];}
export function defaultInputOptions():InputOptions{return {mouseMode:0,keys:[67, 73, 83, 65, 80, 81, 85, 77, 9, 72, 90, 88, 78, 71, 45, 36, 33, 46, 35, 34, 82, 84, 87, 69, 89, 70, 0, 0, 0, 0, 86, 76, 0, 0]};}
export function inputOptions(value:unknown):InputOptions {
 const v=value as InputOptions;
 if(!v||(v.mouseMode!==0&&v.mouseMode!==1)||!Array.isArray(v.keys)||v.keys.length!==34||v.keys.some(n=>!Number.isInteger(n)||n<0||n>255)||new Set(v.keys.filter(Boolean)).size!==v.keys.filter(Boolean).length)throw Error('Invalid input options');
 return {mouseMode:v.mouseMode,keys:[...v.keys]};
}
export function captureBinding(options:InputOptions,slot:number,vk:number):InputOptions{
 if(!Number.isInteger(slot)||slot<0||slot>=34||!captureAllowed(vk))return options;
 return {...options,keys:options.keys.map((key,index)=>index===slot?vk:key===vk?0:key)};
}
export function captureAllowed(vk:number):boolean{return Number.isInteger(vk)&&vk>0&&vk<=255&&![12,19,21,23,24,25,27,37,38,39,40,44,48,49,50,51,52,53,54,55,56,57,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,144,145,229].includes(vk);}
export function virtualKey(code:string):number{
 if(/^Key[A-Z]$/.test(code))return code.charCodeAt(3);
 if(/^Digit[0-9]$/.test(code))return code.charCodeAt(5);
 if(/^F([1-9]|1[0-2])$/.test(code))return 111+Number(code.slice(1));
 const keys:Record<string,number>={Backspace:8,Tab:9,Enter:13,NumpadEnter:13,ShiftLeft:16,ShiftRight:16,ControlLeft:17,ControlRight:17,AltLeft:18,AltRight:18,CapsLock:20,Escape:27,Space:32,PageUp:33,PageDown:34,End:35,Home:36,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Insert:45,Delete:46,Semicolon:186,Equal:187,Comma:188,Minus:189,Period:190,Slash:191,Backquote:192,BracketLeft:219,Backslash:220,BracketRight:221,Quote:222};return keys[code]??0;
}
export function bindingName(vk:number):string{
 const names:Record<number,string>={0:' ',8:'←',9:'Tab',13:'Enter',16:'Shift',17:'Ctrl',18:'Alt',20:'C/L',32:'Space',33:'PgUp',34:'PgDn',35:'End',36:'Home',45:'Ins',46:'Del',186:';',187:'=',188:',',189:'-',190:'.',191:'/',192:'`',219:'[',220:'\\',221:']',222:"'"};
 return names[vk]??(vk>=112&&vk<=123?'F'+(vk-111):String.fromCharCode(vk&255));
}
