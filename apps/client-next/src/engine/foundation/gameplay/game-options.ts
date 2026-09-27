// 5CB7F0 binds labels; 5CB180 binds storage; 5CB550 defines Reset defaults.
// Offsets belong to local SROptionSet state, never to character privileges.
export function gameOptionRows(){return [
 ['ownName',12,'UIIT_STT_ONESELF_SIGN',true,0],['playerNames',13,'UIIT_STT_OTHER_CHAR_SIGN',true,0],
 ['monsterNames',14,'UIIT_STT_MONSTER_SIGN',true,0],['npcNames',15,'UIIT_STT_NPC_SIGN',true,0],
 ['guildNames',16,'UIIT_STT_GUILDVIEW_SIGN',true,0],['fortressNames',17,'UIIT_STT_FORT_USERMARK_NAME_SIGN',true,0],
 ['ownStatus',21,'UIIT_STT_QUICKSTATE_OWNER',true,0],['cosStatus',22,'UIIT_STT_QUICKSTATE_COS',true,0],
 ['partyStatus',23,'UIIT_STT_QUICKSTATE_PARTY',true,0],['monsterStatus',24,'UIIT_STT_QUICKSTATE_MONSTER',true,0],
 ['guide',0,'UIIT_STT_GUIDEVIEW_SIGN',true,1],['partyInvites',1,'UIIT_STT_INVITE_PARTY_SIGN',true,1],
 ['eventGuide',6,'UIIT_STT_EVENTGUIDE_SIGN',true,1],['exchangeRequests',2,'UIIT_STT_REQUEST_EXCHANGE_SIGN',true,1],
 ['whispers',4,'UIIT_STT_GET_WHISPER_SIGN',true,1],['hideSystemMessages',7,'UIIT_MSG_SYSTEM_WND_HIDEMSG',true,1],
 ['partyBuffs',8,'UIIT_MSG_QUICK_PARTY_CHARACTER_BUFF',true,1],['windowMode',9,'UIIT_STT_WINDOWMODE_CHANGE',false,1],
 ['highQualityIntro',10,'UIIT_STT_INTRO_USER_MOSTER_BLIND',true,1],['hideSilkCos',11,'UIIT_STT_BLIND_SILK_COS',false,1],
 ['hpWarning',18,'UIIT_STT_CAUTION_HP',true,1],['mpWarning',19,'UIIT_STT_CAUTION_MP',true,1],
 ['warningSound',20,'UIIT_STT_CAUTION_SOUND',true,1],
] as const;}
export type GameOption=ReturnType<typeof gameOptionRows>[number][0];
export type GameOptions=Readonly<Record<GameOption,boolean>>;
export function defaultGameOptions():GameOptions{return Object.fromEntries(gameOptionRows().map(([key,,,value])=>[key,value])) as GameOptions;}
// 679C80 initializes startup state; 5CB550 is the separate Reset command.
// The native constructor omits sound byte +14 entirely (also absent from
// 4BBD00 persistence). Use deterministic silence for that unspecified byte.
export function initialGameOptions():GameOptions{return {...defaultGameOptions(),hpWarning:false,mpWarning:false,warningSound:false,ownStatus:false,cosStatus:false,partyStatus:false,monsterStatus:false};}
export function gameOptions(value:unknown):GameOptions {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid local game options');
 const raw=value as Record<string,unknown>;
 if(Object.keys(raw).length!==gameOptionRows().length||gameOptionRows().some(([key])=>typeof raw[key]!=='boolean'))throw Error('Invalid local game option fields');
 return Object.fromEntries(gameOptionRows().map(([key])=>[key,raw[key]])) as GameOptions;
}
export function gameOption(value:string):GameOption {
 const row=gameOptionRows().find(([key])=>key===value);if(!row)throw Error('Unknown game option');return row[0];
}
