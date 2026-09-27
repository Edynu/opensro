// Ordered ingress, separate from coalesced authoritative gameplay snapshots.
export type EffectiveHpEvent =
 | {readonly kind:'hp-seed';readonly gid:number;readonly hp:number}
 | {readonly kind:'hp-result';readonly gid:number;readonly key:string;readonly fatal:boolean}
 | {readonly kind:'hp-refresh';readonly gid:number;readonly hp:number;readonly sourceFlags:number;readonly atMs:number}
 | {readonly kind:'hp-revive';readonly gid:number};

export type CombatPresentationEvent = EffectiveHpEvent | {readonly kind:'buff-ended';readonly gid:number;readonly at:number} | {readonly kind:'cast-finalize';readonly cast:import('./gameplay').CastState};
