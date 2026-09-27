import type {AssetOwner} from "@/engine/contracts/assets";

// Retry history belongs to current demand and disappears when a screen releases it.
export function createUiAssets(
    assets: Pick<AssetOwner, "available" | "request" | "take" | "cancel">,
    publish: (id: string, image: ImageBitmap | null) => void,
    base: string,
    report: (event: {kind:'failed'|'recovered'|'released';path:string;attempts:number;message:string}) => void = event => {
        if(event.kind==='failed')console.warn('[ui-assets]',event);
        else console.info('[ui-assets]',event);
    },
) {
    const pending = new Map<string, number>();
    const loaded = new Map<string,readonly[number,number]>();
    const failures = new Map<string, {attempts: number; retryAt: number; message: string}>();
    const missingCrests=new Set<string>();
    const crest=(path:string)=>/\/marks\/[GA][0-9]{1,10}_[0-9]{1,10}_[0-9]{1,10}\.crb$/.test(path);
    let disposed = false;
    let wanted=new Set<string>();
    let previousPaths:readonly string[]=[],settled=false;

    // UI lifetime owns decoded readiness. Keep recent inactive images below
    // 48 MiB / 480 entries, evicting LRU
    // inactive entries before publication. Paths are immutable for this owner;
    // disposal releases everything and a new owner reconstructs from assets.
    // Renderer derives GPU residency from committed quads; prewarming a hidden
    // window must not allocate one GPU descriptor per downloaded sprite.
    function trim(incomingBytes=0,incomingCount=0) {
        let bytes=incomingBytes;
        for(const size of loaded.values())bytes+=size[0]*size[1]*4;
        for(const [path,size] of loaded){
            if(bytes<=48*1024*1024&&loaded.size+incomingCount<=480)break;
            if(wanted.has(path))continue;
            publish(path,null);loaded.delete(path);bytes-=size[0]*size[1]*4;
        }
    }

    function fail(path: string, message: string, now: number) {
        const previous=failures.get(path);
        const attempts = Math.min(6, (previous?.attempts ?? 0) + 1);
        failures.set(path, {attempts, retryAt: now + Math.min(30_000, 1000 * 2 ** (attempts - 1)), message});
        // Report each distinct failure, not every frame or repeated retry.
        if(!previous||previous.message!==message)report({kind:'failed',path,attempts,message});
    }

    function clearFailure(path:string,kind:'recovered'|'released') {
        const failure=failures.get(path);if(!failure)return false;
        failures.delete(path);report({kind,path,attempts:failure.attempts,message:failure.message});return true;
    }

    return {
        step(paths: readonly string[], now: number) {
            if (disposed) return false;
            let demandChanged=paths.length!==previousPaths.length;
            if(!demandChanged)for(let i=0;i<paths.length;i++)if(paths[i]!==previousPaths[i]){demandChanged=true;break;}
            if(!demandChanged&&settled)return false;
            if(demandChanged){previousPaths=[...paths];wanted=new Set(paths);settled=false;}
            for (const [path, id] of pending) if (!wanted.has(path)) {
                assets.cancel(id);
                pending.delete(path);
            }
            let changed = false;
            for (const path of wanted) {const size=loaded.get(path);if(size){loaded.delete(path);loaded.set(path,size);}}
            trim();
            for(const path of missingCrests)if(!wanted.has(path)&&missingCrests.size>480)missingCrests.delete(path);
            for (const path of failures.keys()) if (!wanted.has(path)) {clearFailure(path,'released');changed=true;}
            for (const [path, id] of pending) {
                const result = assets.take(id);
                if (!result) continue;
                pending.delete(path);
                if (result.kind === "image") {
                    const size= [result.image.width,result.image.height] as const;
                    trim(size[0]*size[1]*4,1);
                    publish(path, result.image);
                    loaded.set(path,size);
                    clearFailure(path,'recovered');
                    changed = true;
                } else if(crest(path)){missingCrests.add(path);changed=true;} else { fail(path, result.kind === "error" ? result.error : "Expected UI image", now); changed=true; }
            }
            for (const path of wanted) {
                if (missingCrests.has(path)||loaded.has(path) || pending.has(path) || (failures.get(path)?.retryAt ?? -Infinity) > now) continue;
                if (assets.available() === 0) break;
                try {
                    pending.set(path, assets.request(new URL(path, base).href, crest(path)?256:4 * 1024 * 1024, crest(path)?"crest":"png"));
                } catch (error) {
                    fail(path, String(error), now);
                    changed=true;
                }
            }
            settled=pending.size===0&&failures.size===0;
            if(settled)for(const path of wanted)if(!loaded.has(path)&&!missingCrests.has(path)){settled=false;break;}
            return changed;
        },
        stats:()=>({pending:[...wanted].filter(path=>!loaded.has(path)&&!failures.has(path)&&!missingCrests.has(path)).length,failed:[...failures.keys()]}),
        has: (path: string) => loaded.has(path),
        size: (path: string) => loaded.get(path),
        error: () => {const failure=failures.entries().next().value;return failure?`UI image unavailable; retrying: ${failure[0]}: ${failure[1].message}`:null;},
        dispose() {
            if (disposed) return;
            disposed = true;previousPaths=[];settled=false;
            const errors:unknown[]=[];
            for (const id of pending.values())try{assets.cancel(id);}catch(error){errors.push(error);}
            for (const path of loaded.keys())try{publish(path, null);}catch(error){errors.push(error);}
            pending.clear();
            loaded.clear();
            failures.clear();missingCrests.clear();
            wanted.clear();
            if(errors.length)throw new AggregateError(errors,'UI image cleanup failed');
        },
    };
}
