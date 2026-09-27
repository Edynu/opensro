export interface WireFrame {
    readonly opcode: number;
    readonly payload: Uint8Array;
}
export interface NetworkOwner {
    connect(url: string, admission: string, resume?: Uint8Array): void;
    send(frame: WireFrame): void;
    // False retains this frame and its successors while admission awaits data.
    drain(consume: (frame: WireFrame) => boolean | void): void;
    disconnect(): void;
    enterWorld(division:string, character:string, token:string):void;
    dispose(): void;
}
