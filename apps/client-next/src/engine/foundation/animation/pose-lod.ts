/** A8FB70 -> ADC040 -> ADDA10. Dispatch advances independently of this gate. */
export function createPoseLod(){
 let fraction=0,counter=0,rate=0,frame:number|undefined,accepted=true;
 return {
  sample(next:number,crowded:boolean,stamp:number){
   if(frame===stamp)return accepted;
   frame=stamp;
   if(next!==fraction){fraction=next;rate=Math.trunc(next*4)>=3?1:0;counter=rate;}
   if(crowded&&counter<rate){counter++;accepted=false;}
   else {if(crowded)counter=0;accepted=true;}
   return accepted;
  }
 };
}
