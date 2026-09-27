export interface WorldTravel {readonly revision?:number;readonly mode:0|1|2|3|4|5|6;readonly region:number;}
export interface EntityEquipment {readonly slot:number;readonly refObjId:number;readonly typeFlags:number;readonly plus:number;}
// The msch 1 skin (CICharactor+0x294, 85C060): the RefObj a player wears,
// from its spawn row or 0x323A. revision tells a new application from the
// one an ended msch instance already restored.
export interface TransformSkin {readonly refObjId:number;readonly player:boolean;readonly equipment:readonly EntityEquipment[];readonly revision:number;}
export interface EntityState {
    readonly spawnAppearance?:number;
 readonly teleport?:{readonly radius:number;readonly height:number;readonly fortressId?:number};
    readonly nameColor?:number;readonly holdType?:number;
	readonly merchantBranches?:readonly import('@/engine/foundation/gameplay/merchant-branches').MerchantBranch[];
    readonly emote?:{readonly action:number;readonly revision:number;readonly atMs:number};
    readonly attackFlags?:number;
    readonly tidWord?:number;readonly level?:number;readonly maxHp?:number;readonly countryByte9c?:number;readonly rarity?:number;readonly rarityAuxIcon?:number;readonly monsterSkin?:number;
    readonly spawnSkills?:readonly import('@/engine/foundation/gameplay/spawn-skills').SpawnSkill[];
    readonly titleText?:string;readonly titleId?:number;readonly transformSkin?:TransformSkin;readonly cosAppearanceRefObjId?:number;
    readonly spawnDestination?:import('./gameplay').Pose;
    readonly jobType?:number;readonly jobGrade?:number;readonly guildName?:string;readonly guildId?:number;readonly guildGrantName?:string;readonly guildCrests?:readonly[number,number,number];readonly guildWarTeam?:number;readonly arenaTeam?:number;
    readonly appearanceState?:readonly number[];

    readonly groundItem?:{readonly typeFlags:number;readonly goldAmount:number;readonly ownerJid?:number;readonly tint:number;readonly appear?:number;readonly claimantGid?:number};
    readonly ownerGid?:number;readonly ownerName?:string;readonly pvpState?:number;readonly pickupRevision?:number;
    readonly equipment?:readonly EntityEquipment[];readonly avatars?:readonly EntityEquipment[];readonly bodyShape?:number;readonly visualFlags?:number;
    readonly mountedOn?:number;readonly gid:number;
    readonly refObjId:number;
    readonly kind:string;
    readonly regionId:number;
    readonly x:number; readonly y:number; readonly z:number;
    readonly heading:number;
    readonly name:string;
    readonly movementPath?:{readonly from:import('./gameplay').Pose;readonly to:import('./gameplay').Pose};readonly movementRevision?:number;readonly moving?:boolean;readonly movementMode?:number;readonly walkSpeed?:number;readonly runSpeed?:number;
}
export type WorldEvent = import("./effective-hp").CombatPresentationEvent | {readonly kind:"travel";readonly travel:WorldTravel} | import("./orb").VisualFeedback | {readonly kind:"ui-sound";readonly handle:import("@/engine/foundation/ui/sound-catalog").UiSoundHandle;readonly at:number} | {readonly kind:"gameplay";readonly state:import("./gameplay").GameplayState} | {readonly kind:"synchronized";readonly epoch:number} | {readonly kind:"reset";readonly epoch:number} |
    {readonly kind:'item-sound';readonly cue:import('./audio').ItemSoundRequest;readonly at:number} |
    {readonly kind:"spawn";readonly entity:EntityState} | {readonly kind:"state";readonly entity:EntityState} |
    {readonly kind:"despawn";readonly gid:number} |
    {readonly kind:"native";readonly opcode:number;readonly payload:Uint8Array} |
    {readonly kind:"bootstrap";readonly value:unknown};
export interface WorldBatch {readonly sequence:number;readonly events:readonly WorldEvent[];}
