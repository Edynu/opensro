import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { root } from "../../tools/project.mjs";
import { verifyOwnership } from "../../tools/verify-ownership.mjs";
import { verifyCapabilities } from "../../tools/verify-capabilities.mjs";
function mutate(file, addition, check) { const temp = fs.mkdtempSync(path.join(os.tmpdir(), "sro-next-policy-")); try {
    fs.cpSync(path.join(root, "src"), path.join(temp, "src"), { recursive: true }); fs.copyFileSync(path.join(root,"execution-contract.json"),path.join(temp,"execution-contract.json"));
    fs.appendFileSync(path.join(temp, file), addition);
    assert.ok(check(temp).length > 0);
}
finally {
    fs.rmSync(temp, { recursive: true, force: true });
} }
test("current ownership and capabilities pass", () => { assert.deepEqual(verifyOwnership(), []); assert.deepEqual(verifyCapabilities(), []); });
for (const [name, code, check] of [
    ['sibling type import', '\nimport type { createSimulationHost } from "../simulation/host";', verifyOwnership],
    ['legacy import', '\nimport "../../../../../../client/src/main";', verifyOwnership],
    ['computed import', '\nconst target="x"; import(target);', verifyOwnership],
    ['frame loop alias', '\nconst raf=requestAnimationFrame; raf(()=>{});', verifyCapabilities],
    ['submission alias', '\nconst q:any={};const submit=q.submit; submit([]);', verifyCapabilities],
    ['second frame loop', '\nrequestAnimationFrame(()=>{});', verifyCapabilities],
    ['submission bypass', '\nconst q:any={};q["submit"]([]);', verifyCapabilities],
    ['bundle creation outside owner', '\nconst encoder:any={};encoder.createRenderBundleEncoder({});', verifyCapabilities],
    ['bundle execution outside frame', '\nconst pass:any={};pass.executeBundles([]);', verifyCapabilities],
    ['extra socket', '\nconst socket = new WebSocket("ws://localhost");', verifyCapabilities],
    ['computed global socket', '\nconst socket = globalThis["Web"+"Socket"];', verifyCapabilities],
    ['GPU allocator', '\nconst gpu:any={};gpu.createBuffer({size:4,usage:1});', verifyCapabilities],
    ['GPU entry point', '\nconst stolen=navigator.gpu;', verifyCapabilities],
    ['extra timer', '\nsetTimeout(()=>{},0);', verifyCapabilities],
    ['raw device', '\nlet stolen:GPUDevice;', verifyCapabilities],
    ['async frame helper', '\nasync function hidden(){await Promise.resolve();}', verifyCapabilities]
])
    test(`reject ${name}`, () => mutate('src/engine/runtime/platform/platform.ts', code, check));

test("reject shared mutable session cache",()=>mutate("src/engine/contracts/session.ts","\nconst sessionCache = new Map();",verifyOwnership));
test("reject shared top-level mutable counter",()=>mutate("src/engine/contracts/session.ts","\nlet epoch = 0;",verifyOwnership));
test("reject browser font rasterizer returning to UI text",()=>mutate("src/engine/runtime/ui/text/text.ts","\nconst canvas = new OffscreenCanvas(2048,1024);",base=>verifyCapabilities(base).filter(issue=>issue.includes('ui/text/text.ts'))));
test("reject browser text context returning to UI text",()=>mutate("src/engine/runtime/ui/text/text.ts","\nconst canvas:any={}; canvas.getContext('2d');",base=>verifyCapabilities(base).filter(issue=>issue.includes('ui/text/text.ts'))));
test("ordinary object methods do not crash capability checking",()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),"sro-next-policy-"));
 try {fs.cpSync(path.join(root,"src"),path.join(temp,"src"),{recursive:true});fs.copyFileSync(path.join(root,"execution-contract.json"),path.join(temp,"execution-contract.json"));fs.appendFileSync(path.join(temp,"src/engine/runtime/platform/platform.ts"),"\nconst text = ({}).toString();");assert.deepEqual(verifyCapabilities(temp),[]);}
 finally {fs.rmSync(temp,{recursive:true,force:true});}
});
