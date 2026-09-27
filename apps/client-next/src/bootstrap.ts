import { startRuntime } from "./engine/runtime/runtime";

const canvas = document.querySelector("canvas");
const status = document.querySelector("output");
if (!(canvas instanceof HTMLCanvasElement) || !status)
    throw new Error("Missing runtime surface");
const query=new URLSearchParams(location.search);
const diagnostics=import.meta.env.MODE==='beta'?{gpuAnimation:true,stages:false,gpuTiming:false,hoverPicking:true}:{gpuAnimation:query.get('gpu-animation')!=='0',stages:query.get('frame-stages')==='1',gpuTiming:query.get('gpu-timing')==='1',hoverPicking:query.get('hover-picking')!=='0'};
export const runtime = startRuntime(canvas, status, undefined, diagnostics);
