import type { CharacterActor } from './character';
export interface HawkAnimation {readonly clip:string;readonly durationMs:number;readonly loop:boolean;readonly trackEvents:readonly {readonly cursorMs:number;readonly eventCode:number}[];}
export interface HawkImpact {readonly resultKey:string;readonly id:number;readonly holder:number;readonly target:number;readonly skill:number;readonly damage:number;readonly at:number;}
export interface EffectStage {
    readonly script?:import('@/engine/foundation/animation/effect-script').EffectScript;
    readonly native?:{
        readonly slot:number;readonly attach:number;readonly trade:number;readonly kill:number;
        readonly scale:'MOB_BASE'|'CHAR_BASE'|null;readonly rotation:number;
        readonly fadeInMs:number;readonly fadeOutMs:number;readonly damageTypes:readonly string[];
        readonly actionOptions:{readonly enabled:boolean;readonly direction:number;readonly distance:number;readonly residualDistance:number;readonly simultaneousRelease:boolean};
    };
    readonly parameters?:readonly [number,number,number];
    readonly phase?:string;
    readonly movement?:{readonly delayMs:number;readonly startSpeed:number;readonly endSpeed:number};
    readonly targetBone?:string|null;
    readonly targetOffset?:readonly [number,number,number];
    readonly arrivalResource?:string|null;
    readonly soundEnd?:string|null;
    readonly resource: string | null;
    readonly damageEvent: boolean;
    readonly startEvent: number;
    readonly action: string;
    readonly move: string;
    readonly bone: string | null;
    readonly offset: readonly [
        number,
        number,
        number
    ];
    readonly life: number;
    readonly sound: string | null;
    readonly count: number;
    readonly scripts: readonly string[];
}
export interface EffectRecord {
    readonly hitLight?:{readonly color:readonly [number,number,number];readonly duration:number;readonly range:number;readonly attenuation:number};
    readonly attachedMotion?:{readonly set:string;readonly id:number};
    readonly damageEffect?:string|null;
    readonly secondaryEffect?:boolean;
    readonly arrowEffects?:readonly [string|null,string|null];
    readonly hideWeapon?:number;
    readonly overlap?:boolean;
    readonly attachedAction?:import('@/engine/foundation/animation/impact-source').AttachedAction;
    readonly phaseClips?:readonly (readonly string[])[];
    readonly clips: readonly string[];
    readonly stages: readonly EffectStage[];
}
export type EffectCatalog = Readonly<Record<string, EffectRecord>>;
export type EffectAttachment = {
    readonly kind: 'world';
} | {
    readonly kind: 'entity';
    readonly offset: readonly [
        number,
        number,
        number
    ];
};
export interface EffectRelease {readonly fade:number;released?:number;previous?:number;progress?:number;opacity?:number;}
export interface EffectVisual {
    readonly landed?:{readonly at:number};
    readonly auxiliary?:{actor:CharacterActor;readonly fade:number;previous:number;progress:number;opacity:number;started?:number;expired:boolean}[];
    readonly command?:EffectRelease&{readonly slot:number;readonly loop:boolean};
    readonly visualStarted?:number;
    readonly family?:{readonly fadeIn:number;readonly fadeOut:number;readonly stopEmission:boolean;end:{readonly at:number;readonly remove:boolean}|null;previous:number;progress:number;opacity:number};
    readonly camera?:{readonly target:number;readonly script:Omit<import('./camera-script').CameraScript,'atMs'>};
    readonly independent?:boolean;
    readonly impact?:{readonly cast:import('./gameplay').CastState;readonly target:number;readonly index:number;readonly soundSkill:number;readonly allTargets?:boolean;readonly secondary?:boolean;readonly atTarget?:boolean};
    readonly actor: CharacterActor;
    readonly attachment: EffectAttachment;
    readonly owner: number;
    readonly token: number;
    readonly life: number;
    readonly flight?:EffectFlight;
}

export interface EffectFlight {
    orientation?:CharacterActor['pose'];
    readonly curve?:{readonly state:import('@/engine/foundation/animation/projectile-curve').ProjectileCurve;previousMs:number};
    readonly arc?:import('@/engine/foundation/animation/projectile-time').ProjectileArc;
    destination:CharacterActor['pose'];
    readonly speed:number;readonly delay:number;readonly arrivalResource:string|null;readonly soundEnd:string|null;soundBegin:string|null;
    readonly moving?:{
        pose:CharacterActor['pose'];previous:number;delay:number;travelled:number;age:number;
        readonly route:{readonly kind:'radial';readonly spacing:number}|{readonly kind:'chain';readonly targets:readonly number[];cursor:number;pending:number|null;readonly trigger:EffectTrigger;readonly bone:string|null;readonly offset:readonly [number,number,number]};
    };
}

export interface EffectImpactEvent {
    readonly position?:CharacterActor["pose"];
    readonly secondary?:boolean;readonly atTarget?:boolean;
    readonly allTargets?:boolean;
    readonly kind:'launch'|'arrival'|'discard'|'hop'|'skip';
    readonly flight:number;
    readonly cast:import('./gameplay').CastState;
    readonly target:number;
    readonly index:number;
    readonly at:number;
    readonly soundSkill?:number;
}

export interface EffectTrigger {
    readonly sampleCurrent?:boolean;
    readonly attackKind?:number;
    readonly cast:import('./gameplay').CastState;
    readonly phase:string;
    readonly event:number;
    readonly at:number;
}
