import type {UiQuad} from '@/engine/contracts/ui';

// Generic window input inhibition (9FCDB0) is not CIFButton disabling (540740).
export type ButtonAccess='enabled'|'inhibited'|'disabled';
export function buttonAccess(inhibited:boolean,unavailable=false):ButtonAccess {
 return unavailable?'disabled':inhibited?'inhibited':'enabled';
}
export function buttonTextColor(normal:UiQuad['color'],access:ButtonAccess):UiQuad['color'] {
 // 540720 initializes CTextBoard state 3 to FFE6E6E6. Scene opacity is separate.
 return access==='disabled'?[230/255,230/255,230/255,1]:normal;
}
