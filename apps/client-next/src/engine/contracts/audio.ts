export interface ItemSoundRequest {
    readonly handle:'SND_EQUIP'|'SND_DROPITEM';
    readonly typeFlags:number;
}

export interface SoundEvent {
    readonly loop?:boolean;
    readonly stop?:boolean;
    readonly spatial?: boolean;
    readonly id: string;
    readonly path: string;
    readonly gain: number;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly expires: number;
}

export interface SoundListener {readonly position:readonly[number,number,number];readonly forward:readonly[number,number,number];readonly up:readonly[number,number,number];}
