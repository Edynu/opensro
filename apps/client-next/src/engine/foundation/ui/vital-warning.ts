// 6B6D00 compares the rounded float gauge, not unrounded integer percentages.
export function vitalWarning(current:number|undefined,maximum:number|undefined):boolean {
 if(current===undefined||maximum===undefined||maximum<=0)return false;
 const ratio=Math.fround(Math.min(current,maximum)/maximum);
 return ratio>0&&ratio<Math.fround(.3);
}
