// Active v1.150 gachanpcmap row: NPC 9251, visible set 1, lottery set 2.
// gachaitemset set 1: [selection ID, reward reference, quantity].
export function gachaPrizes(){const names:Record<number,string>={"5912": "SN_ITEM_MALL_HP_SUPERSET_5_BAG", "5913": "SN_ITEM_MALL_MP_SUPERSET_5_BAG", "6855": "SN_ITEM_ETC_ARCHEMY_MAGICSTONE_ATHANASIA_09", "6891": "SN_ITEM_ETC_ARCHEMY_MAGICSTONE_ASTRAL_09", "3783": "SN_ITEM_MALL_RESURRECTION_100P_SCROLL", "3884": "SN_ITEM_MALL_GOLD_TIME_SERVICE_TICKET_4W", "4035": "SN_ITEM_CH_SWORD_08_A_RARE", "4071": "SN_ITEM_CH_BLADE_08_A_RARE", "4104": "SN_ITEM_CH_SPEAR_07_A_RARE", "4140": "SN_ITEM_CH_TBLADE_07_A_RARE", "4176": "SN_ITEM_CH_BOW_07_A_RARE", "4215": "SN_ITEM_CH_SHIELD_08_A_RARE"};return [
 [1,4140,1],[2,4035,1],[3,4104,1],[4,4071,1],[5,4176,1],[6,4215,1],
 [7,6891,1],[8,6855,1],[9,3884,1],[10,5912,1000],[11,5913,1000],[12,3783,11]
 ].map(([entry,refObjId,quantity])=>({entry:entry!,refObjId:refObjId!,quantity:quantity!,nameSymbol:names[refObjId!]!}));}
export function isGachaTicket(flags:number){return (flags&0xfffe)===0xf6c;}
