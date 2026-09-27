import type { SurfaceCommands, SurfaceOwner, DepthTarget, ColorTarget } from "@/engine/runtime/renderer/internal/gpu-contract";
export function createSurface(canvas: HTMLCanvasElement, commands: SurfaceCommands, format: GPUTextureFormat): SurfaceOwner {
    const context = canvas.getContext("webgpu");
    if (!context)
        throw new Error("WebGPU canvas unavailable");
    let depth:DepthTarget|null=null,color:ColorTarget|null=null,offscreen=false;
    let width = 0, height = 0, disposed = false;
    return {
        depth(){if(disposed||!depth)throw new Error("No active depth surface");return depth.view;},
        present(){if(disposed)throw Error("Disposed surface");if(offscreen){color!.present(context.getCurrentTexture());offscreen=false;}},
        acquire(viewport,retain=false) {
            if (disposed)
                throw new Error("Disposed surface");
            if (width !== viewport.width || height !== viewport.height) {
                color?.dispose();color=null;
                width = viewport.width;
                height = viewport.height;
                canvas.width = width;
                canvas.height = height;
                commands.configure(context, format);
                const replacement=commands.createDepth(width,height);depth?.dispose();depth=replacement;
            }
            offscreen=retain;if(retain){if(!color){const replacement=commands.createColor(width,height);color=replacement;}return color.view;}
            return context.getCurrentTexture().createView();
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            depth?.dispose();depth=null;color?.dispose();color=null;
            context.unconfigure();
        }
    };
}
