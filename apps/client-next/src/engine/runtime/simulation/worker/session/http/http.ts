import { readBytes } from "@/engine/foundation/assets/read-bytes";
export function createSessionHttp() {
    async function request(base: string, route: string, signal: AbortSignal, body?: unknown, token?: string, limit = 65536): Promise<{
        httpOk: boolean;
        body: unknown;
    }> {
        const headers: Record<string, string> = {};
        if (body !== undefined)
            headers["Content-Type"] = "application/json";
        if (token)
            headers.Authorization = `Bearer ${token}`;
        const browserAuth=route==='/title/login'||route==='/title/session'||route==='/title/logout'||route==='/title/character-select'||route==='/auth/enterworld-token';
        const response = await fetch(`${base}${route}`, { method: body === undefined ? "GET" : "POST", headers, credentials: browserAuth?"include":"omit", redirect: "error", cache: "no-store", ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal });
        if (!response.body)
            throw new Error("Session response has no body");
        const bytes = await readBytes(response.body, limit);
        return {
         httpOk: response.ok, body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown };
    }
    return {
        references:loadWorldReferences,
        restore(base:string,signal:AbortSignal){return request(base,'/title/session',signal,{});},
        logout(base:string,signal:AbortSignal){return request(base,'/title/logout',signal,{});},
        returnToDock(base:string,signal:AbortSignal){return request(base,'/title/character-select',signal,{});},
        character(base:string,token:string,route:string,body:unknown,signal:AbortSignal){return request(base,route,signal,body,token);},
        mint(base: string, token: string, kind: "transport" | "enterworld", characterName: string, divisionId: string, signal: AbortSignal) {
            return request(base, `/auth/${kind}-token`, signal, kind === "transport" ? {} : {characterName,divisionId}, token);
        },
        login(base: string, body: {
            id: string;
            password: string;
            serverId: string;
            divisionId?: string;
        }, signal: AbortSignal) { return request(base, "/title/login", signal, body); },
        servers(base: string, signal: AbortSignal) { return request(base, "/title/servers", signal, undefined, undefined, 1 << 20); },
        roster(base: string, token: string, signal: AbortSignal) { return request(base, "/character/list", signal, undefined, token, 1 << 20); }
    };
}
// HTTP cache owns bytes across reloads; the current world admission owns the
// fetch and abort signal. No module-global promise may outlive its session.
async function loadWorldReferences(value:unknown,base:string,signal:AbortSignal):Promise<{refSkillSnapshot:unknown[];itemCommandReferences?:unknown[]}> {
 const ref=value as {path?:unknown;sha256?:unknown;bytes?:unknown};
 if(!ref||typeof ref.sha256!=='string'||! /^[a-f0-9]{64}$/.test(ref.sha256)||ref.path!==`/transport/references/${ref.sha256}.json`||typeof ref.bytes!=='number'||!Number.isInteger(ref.bytes)||ref.bytes<1||ref.bytes>32*1024*1024)throw Error('Invalid world reference identity');
 // References sit beside the socket under the transport base, including any edge route prefix.
 const url=new URL(base);if(url.protocol!=='https:'&&url.protocol!=='http:')throw Error('Invalid transport base');
 url.pathname=url.pathname.replace(/\/$/,'')+ref.path;url.search='';url.hash='';
 const response=await fetch(url,{signal,cache:'force-cache',credentials:'omit',redirect:'error'});
 if(!response.ok||!response.body)throw Error(`World references unavailable (${response.status})`);
 // Bound the decoded stream too: Content-Length describes compressed bytes.
 const bytes=await readBytes(response.body,ref.bytes);
 if(bytes.length!==ref.bytes)throw Error('World references size mismatch');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
 if(digest!==ref.sha256)throw Error('World references digest mismatch');
 signal.throwIfAborted();
 const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as {skillLifecycleVersion?:unknown;refSkillSnapshot?:unknown;itemCommandReferences?:unknown};
 if(!parsed||Object.keys(parsed).some(key=>key!=='refSkillSnapshot'&&key!=='itemCommandReferences'&&key!=='skillLifecycleVersion')||!Array.isArray(parsed.refSkillSnapshot)||parsed.refSkillSnapshot.length>65536)throw Error('Invalid world references');
 if(parsed.skillLifecycleVersion!==1)throw Error('World references lack native skill lifecycle metadata; rebuild the server/reference exporter');
 if(parsed.itemCommandReferences!==undefined&&(!Array.isArray(parsed.itemCommandReferences)||parsed.itemCommandReferences.length>65536))throw Error('Invalid item command references');
 return {refSkillSnapshot:parsed.refSkillSnapshot,...(parsed.itemCommandReferences===undefined?{}:{itemCommandReferences:parsed.itemCommandReferences as unknown[]})};
}

