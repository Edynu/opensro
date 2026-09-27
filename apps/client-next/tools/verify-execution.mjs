import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { root, main } from './project.mjs';
import { executionFlow } from './execution-flow.mjs';
import { rules } from './verify-capabilities.mjs';

export function verifyExecution(base=root, graph=executionFlow(base)) {
    const manifest=JSON.parse(fs.readFileSync(path.join(base,'src/engine/ownership.json'),'utf8'));
    const contract=JSON.parse(fs.readFileSync(path.join(base,'execution-contract.json'),'utf8'));
    const defs=new Map(graph.functions.map(f=>[f.id,f]));
    const issues=[];
    const barriers=contract.frameBarriers??[];
    for(const barrier of barriers){
        const source=path.join(base,barrier.file),evidence=path.join(base,barrier.evidence);
        if(!barrier.reason||!fs.existsSync(source)||createHash('sha256').update(fs.readFileSync(source)).digest('hex')!==barrier.sourceSha256||!fs.existsSync(evidence)||!barrier.tests?.length||barrier.tests.some(test=>!fs.existsSync(path.join(base,test))))issues.push(`Unverified native frame barrier: ${barrier.file}#${barrier.function}`);
        else if(!JSON.parse(fs.readFileSync(evidence,'utf8')).functions.some(fn=>fn.va===barrier.nativeFunction))issues.push(`Missing native frame barrier evidence: ${barrier.file}#${barrier.function}`);
    }
    const invoked=new Set(graph.calls.flatMap(c=>c.targets));
    for(const call of graph.calls) {
        const fn=defs.get(call.caller);
        if(!call.targets.length&&!call.external) {
            const boundary=contract.boundaries.find(b=>b.file===call.file&&b.expression===call.expression&&b.function===(fn?.name??null));
            if(!boundary || boundary.kind==='unwired'&&invoked.has(call.caller))issues.push(`${call.file}:${call.line}: unresolved execution ${call.expression}`);
        }
        const externalName=call.external?.split(':').at(-1);
        if(Object.hasOwn(rules,externalName)&&!rules[externalName].includes(call.file))issues.push(`${call.file}:${call.line}: resolved external ${externalName} escapes its owner`);
        for(const target of [...call.targets,...(call.external?call.callbacks.map(c=>c.target):[])]) {
            const to=defs.get(target);
            if(to.file===call.file || manifest.modules[to.file]===call.file || manifest.internals[to.file]===call.file ||
                manifest.internals[call.file] && (manifest.internals[call.file]===to.file || manifest.internals[call.file]===manifest.internals[to.file]) ||
                to.file.startsWith('src/engine/contracts/') || to.file.startsWith('src/engine/foundation/'))continue;
            if(!contract.capabilities.some(g=>g.consumer===call.file&&g.provider===to.file&&g.functions.includes(to.name)))issues.push(`${call.file}:${call.line}: undeclared capability to ${to.file}#${to.name}`);
        }
    }
    for(const sequence of contract.sequences) {
        const owner=graph.functions.find(f=>f.file===sequence.file&&f.name===sequence.function);
        const calls=graph.calls.filter(c=>c.caller===owner?.id);
        let previous=-1;
        for(const entry of sequence.calls) {
            // Generic owner registration conservatively unions same-named
            // methods. A call-site selector narrows the sequence check while
            // STILL requiring the declared resolved provider; spelling alone
            // cannot satisfy a target or grant a capability.
            const target=typeof entry==='string'?entry:entry.target;
            const expression=typeof entry==='string'?undefined:entry.expression;
            const index=calls.findIndex(c=>(expression===undefined||c.expression===expression)&&(target.startsWith('external:') ? c.external?.endsWith(':'+target.slice(9)) : c.targets.some(id=>{const f=defs.get(id);return `${f.file}#${f.name}`===target;})));
            if(index<=previous||index<0)issues.push(`${sequence.file}#${sequence.function}: required order ${sequence.calls.map(c=>typeof c==='string'?c:`${c.expression} (${c.target})`).join(' -> ')}`);
            previous=index;
        }
    }
    const frame=graph.functions.find(f=>f.file==='src/engine/runtime/runtime.ts'&&f.name==='frame');
    const reachable=new Set(frame?[frame.id]:[]), pending=[...reachable];
    if(!frame)issues.push('Missing runtime frame entry');
    while(pending.length) {
        const id=pending.pop();
        if(defs.get(id).async&&!barriers.some(b=>b.file===defs.get(id).file&&b.function===defs.get(id).name))issues.push(`Async function in frame closure: ${id}`);
        for(const call of graph.calls.filter(c=>c.caller===id)) {
            const synchronousCallbacks=/:(?:map|forEach|filter|some|every|sort|reduce|find)$/.test(call.external??'')?call.callbacks.map(c=>c.target):[];
            for(const target of [...call.targets,...synchronousCallbacks])if(!reachable.has(target)){reachable.add(target);pending.push(target);}
        }
    }
    return issues;
}
if(process.argv[1]===import.meta.filename)main(()=>verifyExecution());
