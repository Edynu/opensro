import {createBloom} from './bloom';
import {createParticleQuery} from './particle-query';
import {createGpuAnimationResources} from './animation';
import {createGpuTiming} from './timing';
import {createThunder} from './thunder';
import {createFlares} from './flares';
import {createUiResources} from "./ui";
import { createPipelines } from './pipelines';
import { createImages } from './images';
import { createGeometryResources } from './geometry';
import type { DeviceOwner, FrameCommands, SurfaceCommands } from "@/engine/runtime/renderer/internal/gpu-contract";
import type { RuntimePhase } from "@/engine/contracts/runtime";
export function createDevice(timingEnabled=false,gpuAnimationEnabled=true): DeviceOwner {
    let textureFiltered=true,textureDetail=2;
    let timing:ReturnType<typeof createGpuTiming>|null=null;
    let phase: RuntimePhase = "starting", failure: string | null = null, device: GPUDevice | null = null;
    let environmentBuffer: GPUBuffer | null = null, sky: import("@/engine/runtime/renderer/internal/gpu-contract").ImageDraw | null = null;
    let geometry: ReturnType<typeof createGeometryResources> | null = null, images: ReturnType<typeof createImages> | null = null;
    let ui:ReturnType<typeof createUiResources>|null=null;
    let thunder:ReturnType<typeof createThunder>|null=null;
    let flares:ReturnType<typeof createFlares>|null=null;
    let bloom:ReturnType<typeof createBloom>|null=null;
    let particleQuery:ReturnType<typeof createParticleQuery>|null=null;
    const depthTextures = new Set<GPUTexture>();
    let epoch = 1, recoverable = false;
    let commands: FrameCommands | null = null, surface: SurfaceCommands | null = null;
    const generation = epoch;
    const fail = (error: unknown, canRecover = false) => {
        if (generation !== epoch)
            return;
        recoverable = canRecover;
        failure = String(error);
        phase = "failed";
    };
    if (!navigator.gpu) {
        fail("WebGPU is unavailable");
    }
    else
        navigator.gpu.requestAdapter().then(adapter => {
            if (generation !== epoch)
                return null;
            if (!adapter)
                throw new Error("No WebGPU adapter");
            const requiredFeatures:GPUFeatureName[]=[];if(adapter.features.has('texture-compression-bc'))requiredFeatures.push('texture-compression-bc');if(timingEnabled&&adapter.features.has('timestamp-query'))requiredFeatures.push('timestamp-query');
            return adapter.requestDevice({requiredFeatures});
        }).then(created => {
            if (!created)
                return;
            if (generation !== epoch) {
                created.destroy();
                return;
            }
            device = created;
            if(timingEnabled&&created.features.has('timestamp-query'))timing=createGpuTiming(created);
            created.lost.then(info => {
                if (phase === "running" || phase === "starting")
                    fail(`Device lost: ${info.message}`, info.reason !== "destroyed");
            });
            created.addEventListener("uncapturederror", event => fail(event.error.message));
            const current = () => {
                if (generation !== epoch || phase !== "running")
                    throw new Error("Stale device capability");
                return created;
            };
            commands = Object.freeze({ prepare:(...args:Parameters<NonNullable<FrameCommands['prepare']>>)=>geometry?.prepare?.(...args), beginTiming:(frameId?:number)=>timing?.begin(frameId), createBundleEncoder: (depth=true) => current().createRenderBundleEncoder({ label: "retained-scene", colorFormats: [navigator.gpu.getPreferredCanvasFormat()], ...(depth?{depthStencilFormat: "depth24plus" as const}:{}) }), createEncoder: () => current().createCommandEncoder({ label: "sro-frame" }), submit: (buffer: GPUCommandBuffer) => current().queue.submit([buffer]) });
            surface = Object.freeze({
                createColor(width:number,height:number){
                    const texture=current().createTexture({label:'deferred-frame-color',size:[width,height],format:navigator.gpu.getPreferredCanvasFormat(),usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});depthTextures.add(texture);
                    return Object.freeze({view:texture.createView(),present(target:GPUTexture){if(!depthTextures.has(texture))throw Error('Disposed frame color');const encoder=current().createCommandEncoder({label:'deferred-frame-present'});encoder.copyTextureToTexture({texture},{texture:target},[width,height]);current().queue.submit([encoder.finish()]);},dispose(){if(depthTextures.delete(texture))texture.destroy();}});
                },
                createDepth(width: number, height: number) {
                    const texture = current().createTexture({ label: "surface-depth", size: [width, height], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING });
                    depthTextures.add(texture);
                    return Object.freeze({ view: texture.createView(), dispose() { if (depthTextures.delete(texture))
                            texture.destroy(); } });
                }, configure: (context: GPUCanvasContext, format: GPUTextureFormat) => context.configure({ device: current(), format, alphaMode: "opaque",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_DST })
            });
            const pipelines = createPipelines(created, navigator.gpu.getPreferredCanvasFormat());
            images = createImages(current, fail, pipelines.image, pipelines.sampler, (texture, levels, layers) => {
                if (levels <= 1)
                    return;
                const encoder = current().createCommandEncoder({ label: "upload-texture-mips" });
                for (let layer = 0; layer < layers; layer++)
                    for (let level = 1; level < levels; level++) {
                        const binding = current().createBindGroup({ layout: pipelines.mips().getBindGroupLayout(0), entries: [{ binding: 0, resource: pipelines.worldSampler }, { binding: 1, resource: texture.createView({ dimension: "2d", baseArrayLayer: layer, arrayLayerCount: 1, baseMipLevel: level - 1, mipLevelCount: 1 }) }] });
                        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView({ dimension: "2d", baseArrayLayer: layer, arrayLayerCount: 1, baseMipLevel: level, mipLevelCount: 1 }), loadOp: "clear", storeOp: "store" }] });
                        pass.setPipeline(pipelines.mips());
                        pass.setBindGroup(0, binding);
                        pass.draw(6);
                        pass.end();
                    }
                current().queue.submit([encoder.finish()]);
            });
            environmentBuffer = created.createBuffer({ size: 336, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            geometry = createGeometryResources(created, current, fail, pipelines.geometry, images.texture, pipelines.worldSampler, pipelines.lightmapSampler, environmentBuffer,pipelines.worldSampling,gpuAnimationEnabled?createGpuAnimationResources(created):undefined,navigator.gpu.getPreferredCanvasFormat());
            ui=createUiResources(created,navigator.gpu.getPreferredCanvasFormat());
            thunder=createThunder(created,navigator.gpu.getPreferredCanvasFormat());
            flares=createFlares(created,navigator.gpu.getPreferredCanvasFormat(),images.texture);
            bloom=createBloom(created,navigator.gpu.getPreferredCanvasFormat());
            particleQuery=createParticleQuery(created,navigator.gpu.getPreferredCanvasFormat());
            Promise.all([pipelines.ready,ui.ready,flares.ready,thunder.ready,geometry.ready,particleQuery.ready,bloom.ready]).then(() => { if (generation === epoch && phase === "starting") {
                sky = { pipeline: pipelines.sky(), binding: created.createBindGroup({ layout: pipelines.sky().getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: environmentBuffer! } }] }) };
                phase = "running";
                geometry!.textureOptions(textureFiltered,textureDetail);
            } }).catch(fail);
        }).catch(fail);
    return {
        bloom(width,height,enabled){if(phase!=='running'||!bloom)throw Error('Bloom device is not ready');return bloom.prepare(width,height,enabled);},
        particleQuery(points,matrix,color,depth){if(phase!=='running'||!particleQuery)throw Error('Stale particle query capability');return particleQuery.query(points,matrix,color,depth);},
        textureOptions(filtered,detail){textureFiltered=filtered;textureDetail=detail;if(phase==="running")geometry?.textureOptions(filtered,detail);},
        portraitTarget(id?:string,width?:number,height?:number){if(!ui)throw Error('UI device is not ready');return ui.portraitTarget(id,width,height);},
        uiTexture:(id,image)=>ui?.texture(id,image),ui:scene=>ui?.prepare(scene)??[],
        sky: () => sky,
        thunder(color){if(phase!=='running'||!thunder)throw Error('Stale thunder capability');return thunder.prepare(color);},
        flares(input,depth){if(phase!=='running'||!flares)throw new Error('Stale flare capability');return flares.prepare(input,depth);},
        worldView(transform, environment) { if (phase === "running") {
            geometry?.worldView(transform);
            device!.queue.writeBuffer(environmentBuffer!, 0, environment.buffer as ArrayBuffer, environment.byteOffset, environment.byteLength);
        } },
        geometry: () => geometry?.commands ?? null, images: () => images?.commands ?? null,
        recoverable: () => phase === "failed" && recoverable, phase: () => phase, error: () => failure,
        gpuTiming:()=>timing?.stats()??null,
        commands: () => commands, surfaceCommands: () => surface, format: () => navigator.gpu.getPreferredCanvasFormat(),
        dispose() {
            if (phase === "disposed")
                return;
            epoch++;
            phase = "disposed";
            for (const texture of depthTextures)
                texture.destroy();
            depthTextures.clear();
            environmentBuffer?.destroy();
            environmentBuffer = null;
            sky = null;
            ui?.dispose();ui=null;
            thunder?.dispose();thunder=null;
            flares?.dispose();flares=null;
            bloom?.dispose();bloom=null;
            particleQuery?.dispose();particleQuery=null;
            geometry?.dispose();
            geometry = null;
            images?.dispose();
            images = null;
            commands = null;
            surface = null;
            timing?.dispose();timing=null;
            device?.destroy();
            device = null;
        }
    };
}
