// CICharactor_UpdateStatusParamDecorations (85C590). changed = mask at
// +0x2B8 XOR the new mask. Bits walk from 1<<0 upward. The new mask is
// stored after the walk. Selector 1 of GetAbnormalStateIconPath (6E0010)
// is the short code; the decoration name is PARAM_ plus that code.
// A bit with no code attaches nothing (0x1000, 0x800000 and bits above
// 0x1000000; 0x400000 is CURSIE_MP, 6E0243). FindSkillIdByName (916830) feeds
// InitCast_Mode2; a name with no skilleffect row never becomes an actor.
//
// Tint bits call model vfunc +0x48(from, to, 1000). Clearing any of them
// calls vfunc +0x4C even when another tint bit is still set. The walk is
// low to high, so the last tint edge in one update wins.
// +0x2B6 is the body-visual byte CICharactor_SetBodyVisualState (85EC00)
// stores from its first argument. Value 1 is a real state (spawn and
// 0x3122 both call that writer). While it is 1 the material calls are
// skipped. Speed and the freeze pose lock are not.
//
// +0xBC is the scale CICharactor_AdvanceAnimation (853600) multiplies into
// the AdvanceFrame delta. Frostbite writes 0.5, SLOW writes 0.75, and
// clearing either writes 1.0 even if the other is still set.
// Freeze writes +0xB9 and LeaveActionState(9). AdvanceAnimation then
// passes a zero advance flag. Clearing freeze stores +0xB9 = 0.
// CancelAttachedSkillDecorationBySkillId (85C280) calls
// CIDecoSkill_ExtinguishAndCancel, which runs the record's end stage.
// PARAM_FZ's end stage is DEACT (status_bad_icing_off.efp).

export type Rgb = readonly [number, number, number];
export type StatusTint = {readonly from: Rgb; readonly to: Rgb};

function byte(n: number): number {
 return Math.fround(n / 255);
}

function tints(): Readonly<Record<number, StatusTint>> {
 return {
  0x2: {from: [byte(120), byte(140), 1], to: [byte(80), byte(98), 1]},
  0x4: {from: [1, 1, byte(64)], to: [byte(160), 1, 0]},
  0x8: {from: [1, byte(80), byte(80)], to: [1, byte(144), byte(32)]},
  0x10: {from: [byte(28), byte(50), byte(16)], to: [byte(64), byte(91), byte(45)]},
  0x20: {from: [byte(104), byte(80), 1], to: [byte(80), byte(48), byte(154)]},
  0x2000: {from: [1, 1, byte(64)], to: [byte(160), 1, 0]},
  0x4000: {from: [1, 1, byte(64)], to: [byte(160), 1, 0]}
 };
}

// 6E0010 selector 1, bit index 0..24. Empty entries are bits with no code
// (0x1000 and 0x800000). Tooltip and abnormal text read this same list.
export function statusCodes(): readonly string[] {
 return ['FZ','FB','ES','BU','PS','ZB','SLEEP','ROOT','SLOW','FEAR','MYOPIA','BLOOD','','DN','STUN','DISEASE','CHAOS','CURSE_PD','CURSE_MD','CURSE_STR','CURSE_INT','CURSE_HP','CURSIE_MP','','TIME_BOMB'];
}

function codes(): Readonly<Record<number, string>> {
 const table: Record<number, string> = {};
 statusCodes().forEach((code, index) => { if (code) table[1 << index] = code; });
 return table;
}

export type StatusView = {
 readonly mask: number;
 readonly rate: number;
 readonly poseLocked: boolean;
 readonly tint?: StatusTint | null;
 readonly names: readonly string[];
};

export const STATUS_DECORATION_MASK = 0x17fefff;

export function stepStatus(previous: StatusView | undefined, mask: number, bodyVisual: number): StatusView {
 const prior = previous ?? {mask: 0, rate: 1, poseLocked: false, names: []};
 const changed = (prior.mask ^ mask) >>> 0;
 let rate = prior.rate;
 let poseLocked = prior.poseLocked;
 let tint: StatusTint | null | undefined = undefined;
 const names = new Set(prior.names);
 const skipTint = bodyVisual === 1;
 const table = codes();
 const colors = tints();
 for (let bit = 1; bit !== 0; bit = (bit << 1) >>> 0) {
  if ((changed & bit) === 0)
   continue;
  const code = table[bit];
  const set = (mask & bit) !== 0;
  if (code) {
   const name = 'PARAM_' + code;
   if (set)
    names.add(name);
   else
    names.delete(name);
  }
  if (bit in colors) {
   if (!skipTint)
    tint = set ? colors[bit]! : null;
  }
  if (bit === 0x2 || bit === 0x100)
   rate = set ? (bit === 0x2 ? 0.5 : 0.75) : 1;
  if (bit === 0x1)
   poseLocked = set;
 }
 return {mask, rate, poseLocked, ...(tint === undefined ? (prior.tint ? {tint: prior.tint} : {}) : {tint}), names: [...names]};
}

// One history per character. Both the pose owner and the effect owner call
// view(); a repeated mask does not walk 85C590 again.
export function createStatusOwner() {
 const views = new Map<number, StatusView>();
 return {
  view(gid: number, mask: number, bodyVisual: number): StatusView {
   const prior = views.get(gid);
   const nextMask = mask >>> 0;
   if (prior && prior.mask === nextMask)
    return prior;
   const next = stepStatus(prior, nextMask, bodyVisual);
   views.set(gid, next);
   return next;
  },
  drop(gid: number) { views.delete(gid); }
 };
}
