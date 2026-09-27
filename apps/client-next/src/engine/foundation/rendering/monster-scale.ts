// 861B00: player-lookalike thief/hunter records bypass rarity enlargement.
// Other grades (including unique and titan) have no extra size multiplier.
export function monsterScale(rarity:number,tidWord:number,percent=100):number{
 const human=(tidWord&0x7fe)===0xc6&&[2,3].includes((tidWord>>>11)&31);
 const factor=human?1:rarity===1?1.5:rarity===4?3:rarity===6?Math.fround(1.7):1;
 return Math.fround(factor*percent/100);
}
// The same spawn branch selects BMT slot 2 for ordinary champions. Other
// record kinds retain their authored slot; unavailable slots fall back at admission.
export function monsterMaterialSlot(rarity:number,tidWord:number,kind=0):number{
 if((tidWord&0x7fe)===0xc6&&[2,3].includes((tidWord>>>11)&31))return 0;
 const slot=kind===1||kind===3||kind===4?kind:0;
 return rarity===1&&slot<=1?2:slot;
}
