// Raw texture resource levels; never framebuffer captures or decoded PNGs.
export interface NativeTexture {readonly kind:'native-texture';readonly width:number;readonly height:number;readonly format:'bgra8unorm'|'bc2-rgba-unorm';readonly levels:readonly Uint8Array[];}
export type WorldTexture=ImageBitmap|NativeTexture;
