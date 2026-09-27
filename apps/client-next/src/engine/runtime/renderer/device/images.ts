import type { ImageCommands, ImageDraw } from '@/engine/runtime/renderer/internal/gpu-contract';

function decompressBc2Level(bytes: Uint8Array, width: number, height: number): Uint8Array {
    const out = new Uint8Array(width * height * 4);
    const bw = Math.ceil(width / 4), bh = Math.ceil(height / 4);
    let inOffset = 0;
    for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
            const blockOffset = inOffset;
            inOffset += 16;
            const alpha0 = bytes[blockOffset]! | (bytes[blockOffset + 1]! << 8) | (bytes[blockOffset + 2]! << 16) | (bytes[blockOffset + 3]! << 24);
            const alpha1 = bytes[blockOffset + 4]! | (bytes[blockOffset + 5]! << 8) | (bytes[blockOffset + 6]! << 16) | (bytes[blockOffset + 7]! << 24);
            const c0 = bytes[blockOffset + 8]! | (bytes[blockOffset + 9]! << 8);
            const c1 = bytes[blockOffset + 10]! | (bytes[blockOffset + 11]! << 8);
            const r0 = (c0 >> 11) & 31, r0_8 = (r0 << 3) | (r0 >> 2);
            const g0 = (c0 >> 5) & 63, g0_8 = (g0 << 2) | (g0 >> 4);
            const b0 = c0 & 31, b0_8 = (b0 << 3) | (b0 >> 2);
            const r1 = (c1 >> 11) & 31, r1_8 = (r1 << 3) | (r1 >> 2);
            const g1 = (c1 >> 5) & 63, g1_8 = (g1 << 2) | (g1 >> 4);
            const b1 = c1 & 31, b1_8 = (b1 << 3) | (b1 >> 2);
            const pal = [
                [r0_8, g0_8, b0_8],
                [r1_8, g1_8, b1_8],
                [Math.round((2 * r0_8 + r1_8) / 3), Math.round((2 * g0_8 + g1_8) / 3), Math.round((2 * b0_8 + b1_8) / 3)],
                [Math.round((r0_8 + 2 * r1_8) / 3), Math.round((g0_8 + 2 * g1_8) / 3), Math.round((b0_8 + 2 * b1_8) / 3)]
            ];
            const lookup = bytes[blockOffset + 12]! | (bytes[blockOffset + 13]! << 8) | (bytes[blockOffset + 14]! << 16) | (bytes[blockOffset + 15]! << 24);
            for (let py = 0; py < 4; py++) {
                const y = by * 4 + py;
                if (y >= height) continue;
                for (let px = 0; px < 4; px++) {
                    const x = bx * 4 + px;
                    if (x >= width) continue;
                    const pi = py * 4 + px;
                    const aNibble = pi < 8 ? ((alpha0 >>> (pi * 4)) & 0xF) : ((alpha1 >>> ((pi - 8) * 4)) & 0xF);
                    const a8 = (aNibble << 4) | aNibble;
                    const cIdx = (lookup >>> (pi * 2)) & 3;
                    const color = pal[cIdx]!;
                    const outIdx = (y * width + x) * 4;
                    out[outIdx] = color[0]!;
                    out[outIdx + 1] = color[1]!;
                    out[outIdx + 2] = color[2]!;
                    out[outIdx + 3] = a8;
                }
            }
        }
    }
    return out;
}

export function createImages(current: () => GPUDevice, fail: (error: unknown) => void, pipeline: () => GPURenderPipeline, sampler: GPUSampler, generateMips: (texture: GPUTexture, levels: number, layers: number) => void) {
    const textures = new Map<ImageDraw, GPUTexture>();
    const commands: ImageCommands = Object.freeze({
        upload(image: import("@/engine/contracts/texture").WorldTexture, frames: readonly import("@/engine/contracts/texture").WorldTexture[] = [image],mipmaps=true): ImageDraw {
            const gpu = current();
            gpu.pushErrorScope("validation");
            try {
                if (!frames.length || frames.some(frame => frame.width !== image.width || frame.height !== image.height))
                    throw new Error("Animation texture dimensions differ");
                const native='kind' in image?image:null;
                const decompress=native?.format==='bc2-rgba-unorm'&&!gpu.features.has('texture-compression-bc');
                if(native&&(!native.levels.length||native.levels.length>1+Math.floor(Math.log2(Math.max(image.width,image.height)))))throw Error('Invalid native mip count');
                const levels = native?native.levels.length:mipmaps?1 + Math.floor(Math.log2(Math.max(image.width, image.height))):1;
                const texture = gpu.createTexture({ mipLevelCount: levels, size: [image.width, image.height, frames.length], format: decompress?"rgba8unorm":native?.format??"rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | (native&&!decompress?0:GPUTextureUsage.RENDER_ATTACHMENT) });
                try {
                    for (let layer = 0; layer < frames.length; layer++){
                        const source=frames[layer]!;
                        if('kind' in source){
                            if(source.format!==native?.format||source.levels.length!==levels)throw Error('Native texture levels differ');
                            for(let level=0;level<levels;level++){
                                const w=Math.max(1,image.width>>level),h=Math.max(1,image.height>>level);
                                const bc=source.format==='bc2-rgba-unorm'&&!decompress;
                                const raw=source.levels[level] as Uint8Array;
                                const data=decompress?decompressBc2Level(raw,w,h):raw;
                                gpu.queue.writeTexture({texture,mipLevel:level,origin:[0,0,layer]},data as Uint8Array<ArrayBuffer>,{bytesPerRow:bc?Math.ceil(w/4)*16:w*4,rowsPerImage:bc?Math.ceil(h/4):h},[bc?Math.ceil(w/4)*4:w,bc?Math.ceil(h/4)*4:h]);
                            }
                        }else {if(native)throw Error('Mixed native and bitmap texture array');gpu.queue.copyExternalImageToTexture({source},{texture,origin:[0,0,layer]},[image.width,image.height]);}
                    }
                    if(!native&&levels>1)generateMips(texture, levels, frames.length);
                    const binding = gpu.createBindGroup({ layout: pipeline().getBindGroupLayout(0), entries: [{ binding: 0, resource: sampler! }, { binding: 1, resource: texture.createView({ dimension: "2d", arrayLayerCount: 1 }) }] });
                    const draw = Object.freeze({ pipeline: pipeline(), binding });
                    textures.set(draw, texture);
                    return draw;
                }
                catch (error) {
                    texture.destroy();
                    throw error;
                }
            }
            finally {
                gpu.popErrorScope().then(error => { if (error)
                    fail(error.message); }).catch(fail);
            }
        },
        release(draw: ImageDraw) { textures.get(draw)?.destroy(); textures.delete(draw); }
    });
    return { commands, texture: (image: ImageDraw) => { const texture = textures.get(image); if (!texture)
            throw new Error('Stale image handle'); return texture; }, dispose() { for (const texture of textures.values())
            texture.destroy(); textures.clear(); } };
}
