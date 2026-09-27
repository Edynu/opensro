import {pickNavigationGround} from '@/engine/foundation/navigation/ground-pick';
import {navigationEvents,navigationEventStop,type NavigationEvent} from '@/engine/foundation/navigation/navigation-events';
import {dungeonOwnerPath as walkDungeon,terrainOwnerPath as walkTerrain,type NavOwner} from '@/engine/foundation/navigation/dungeon-ownership';
import {createNavigationIndex,type NavigationIndex} from '@/engine/foundation/navigation/spatial-index';
import {regionMoveAllowed,regionMoveDestination,regionMoveContinuation} from '@/engine/foundation/navigation/region-move';
import {validateLinks,linkPassages} from '@/engine/foundation/navigation/topology';
import {navHeight,navLocal,navContactDetail,navObstacleContact} from '@/engine/foundation/navigation/object-navigation';
import {ownedPlacementStart} from '@/engine/foundation/navigation/owned-start';
import type {NavMesh,NavPlacement,NavigationProduct} from '@/engine/contracts/navigation';
import type { Pose } from "@/engine/contracts/gameplay";
// Published region navmesh, same z-major 96*96 tile/cell gate as the server's
// water_assets_schema.go. No fetch, mesh building or per-entity graph scan.
export function createNavigation() {
    let revision=0,index:NavigationIndex|undefined;
    const dungeonOwnerPath=(rows:readonly NavPlacement[],a:readonly number[],b:readonly number[],owner?:NavOwner)=>walkDungeon(rows,a,b,owner,index);
    const terrainOwnerPath=(rows:readonly NavPlacement[],a:readonly number[],b:readonly number[],owner?:NavOwner)=>walkTerrain(rows,a,b,owner,index);
    let objects:readonly NavPlacement[]=[],origin=0,complete=false;
    let blockKey="",blockValue:number|undefined;
    const floors=new Map<string,number|undefined>();
    const eventHandlers=new Map<string,Readonly<{enter:number;exit:number}>>();
    const regions = new Map<number, {
        blocked: Uint8Array;
        cells: DataView;
        count: number;
        objects: boolean;
        heights?:DataView;
        planeTypes?:Uint8Array;
        planeHeights?:DataView;
    }>();
    function bytes(value: unknown, length: number) {
        if (typeof value !== "string" || value.length > length * 2 + 8)
            throw new Error("Invalid navigation column");
        const raw = atob(value);
        if (raw.length !== length)
            throw new Error("Navigation column length mismatch");
        return Uint8Array.from(raw, c => c.charCodeAt(0));
    }
    function cell(region: number, x: number, z: number): "open" | "blocked" | "unknown" {
        if (region & 0x8000)
            return "unknown";
        const dx = Math.floor(x / 1920), dz = Math.floor(z / 1920), rx = (region & 255) + dx, rz = (region >>> 8) + dz;
        if (rx < 0 || rx > 255 || rz < 0 || rz > 127)
            return "unknown";
        const grid = regions.get(rx | (rz << 8));
        if (!grid || grid.objects&&!complete)
            return "unknown";
        const index = Math.floor((z - dz * 1920) / 20) * 96 + Math.floor((x - dx * 1920) / 20);
        return grid.blocked[index] || grid.cells.getUint32(index * 4, true) >= grid.count ? "blocked" : "open";
    }
    function surfaceHeight(pose:Pose,preferred?:import('@/engine/foundation/navigation/dungeon-ownership').NavOwner,initialize=true):number|null{
        const {x,y,z}=pose,from=pose,dungeon=!!(pose.regionId&0x8000);
        if(dungeon&&(!complete||origin!==pose.regionId))return null;
        const ox=dungeon?0:((pose.regionId&255)-(origin&255))*1920,oz=dungeon?0:((pose.regionId>>>8)-(origin>>>8))*1920;
        if(preferred){const p=objects[preferred.placement];if(p){const q=navLocal(p,x+ox,y,z+oz),h=navHeight(p.mesh,q[0],q[2],q[1],preferred.cell);if(h!==null)return h+p.y;}}
                let h:number|null=null,delta=Infinity;
                if(!dungeon){const dx=Math.floor(x/1920),dz=Math.floor(z/1920),rx=(from.regionId&255)+dx,rz=(from.regionId>>>8)+dz;const grid=rx>=0&&rx<=255&&rz>=0&&rz<=127?regions.get(rx|(rz<<8)):undefined;if(grid?.heights){const fx=(x-dx*1920)/20,fz=(z-dz*1920)/20,ix=Math.floor(fx),iz=Math.floor(fz);if(ix>=0&&iz>=0&&ix<96&&iz<96){const read=(dx:number,dz:number)=>grid.heights!.getFloat32(((iz+dz)*97+ix+dx)*4,true);h=(read(0,0)*(1-fx+ix)+read(1,0)*(fx-ix))*(1-fz+iz)+(read(0,1)*(1-fx+ix)+read(1,1)*(fx-ix))*(fz-iz);// Client 404EE9 / server 9A12B9: the solid NVM plane raises the ground.
                    const block=Math.floor(iz/16)*6+Math.floor(ix/16);
                    if(grid.planeTypes&&grid.planeHeights&&(grid.planeTypes[block]!&2))h=Math.max(h,grid.planeHeights.getFloat32(block*4,true));
                    delta=Math.abs(h-y);}}}
                if(initialize||dungeon)for(const p of objects){const q=navLocal(p,x+ox,y,z+oz),local=navHeight(p.mesh,q[0],q[2],q[1]);if(local!==null&&Math.abs(local+p.y-y)<delta){h=local+p.y;delta=Math.abs(h-y);}}
                return h;
            }
    // A NavOwner indexes the installed product, and each install clones its
    // placements, so the same placed object gets a new index/mesh identity when
    // the product re-centres on another region. The native cell pointer survives
    // region borders; carry the owner across installs by the placement's world
    // geometry instead of dropping it and re-guessing the surface from height.
    function worldX(p:NavPlacement,o:number){return o&0x8000?p.x:p.x+(o&255)*1920;}
    function worldZ(p:NavPlacement,o:number){return o&0x8000?p.z:p.z+(o>>>8)*1920;}
    function sameMesh(a:NavMesh,b:NavMesh){
        if(a.passThrough!==b.passThrough)return false;
        for(const key of ['vertices','vertexDirections','cells','edges','bounds','cellWords','cellEvents','edgeEvents','eventNames'] as const){const x=a[key],y=b[key];if(!x||!y){if(x!==y)return false;continue;}if(x.length!==y.length)return false;for(let i=0;i<x.length;i++)if(x[i]!==y[i])return false;}
        return true;
    }
    return {
        anchor(owner:NavOwner|undefined){const p=owner&&objects[owner.placement];return owner&&p?{region:origin&0x8000?origin:0,x:worldX(p,origin),y:p.y,z:worldZ(p,origin),yaw:p.yaw,mesh:p.mesh,cell:owner.cell}:undefined;},
        relocate(anchor:{region:number;x:number;y:number;z:number;yaw:number;mesh:NavMesh;cell:number}|undefined):NavOwner|undefined{
            if(!anchor||(origin&0x8000?origin:0)!==anchor.region)return undefined;
            const same=(a:number,b:number)=>Math.abs(a-b)<1e-3;
            // Array lengths alone do not identify a cell. A replacement mesh
            // may have the same counts but different geometry or topology.
            const matches=objects.flatMap((p,i)=>same(worldX(p,origin),anchor.x)&&same(worldZ(p,origin),anchor.z)&&same(p.y,anchor.y)&&Math.abs(p.yaw-anchor.yaw)<1e-6&&sameMesh(p.mesh,anchor.mesh)?[i]:[]);
            return matches.length!==1||anchor.cell<0||anchor.cell>=anchor.mesh.cells.length/3?undefined:{placement:matches[0]!,cell:anchor.cell};
        },
        stats:()=>index?.stats()??{queries:0,visited:0,candidates:0,bytes:0},
        pick(query:import("@/engine/contracts/navigation").GroundPickQuery){return complete?pickNavigationGround(objects,origin,query):null;},
        // 403E80 resolves height during terrain stepping; 403D20 arbitrates
        // the terrain/object layer. Never substitute a render-mesh intersection.
        surface(pose:Pose,reference=pose,owner?:import('@/engine/foundation/navigation/dungeon-ownership').NavOwner,cursor?:import('@/engine/contracts/navigation').SurfaceCursor):Pose{
            if(cursor){
                const same=cursor.revision===revision,preferred=same?cursor.owner:undefined;cursor.revision=revision;cursor.owner=undefined;
                if(complete&&!(((pose.regionId|reference.regionId|origin)&0x8000)&&(pose.regionId!==origin||reference.regionId!==origin))){
                    const point=(p:Pose)=>[p.x+((p.regionId&255)-(origin&255))*1920,p.y,p.z+((p.regionId>>>8)-(origin>>>8))*1920];
                    const path=(pose.regionId&0x8000?dungeonOwnerPath:terrainOwnerPath)(objects,point(reference),point(pose),preferred);
                    if(path.stop===1&&path.owner)owner=cursor.owner=path.owner;
                }
            }
            // Only initialization uses 403D20's nearest-height arbitration.
            // Ordinary terrain stepping uses 403E80 until an outline admits an owner.
            const h=surfaceHeight({...pose,y:reference.y},owner,!cursor);
            return h===null?pose:{...pose,y:h};
        },
        block(pose:Pose|null,owner?:import('@/engine/foundation/navigation/dungeon-ownership').NavOwner){
            if(!pose||!(pose.regionId&0x8000)||pose.regionId!==origin||!complete)return undefined;
            if(owner)return objects[owner.placement]?.block;
            const key=[origin,pose.x,pose.y,pose.z].join(":");if(key===blockKey)return blockValue;blockKey=key;
            const point=[pose.x,pose.y,pose.z],resolved=dungeonOwnerPath(objects,point,point,owner).owner;
            return blockValue=resolved?objects[resolved.placement]?.block:undefined;
        },
        floor(pose:Pose|null,owner?:NavOwner){
            if(!pose||!(pose.regionId&0x8000)||pose.regionId!==origin||!complete)return undefined;
            const key=[revision,pose.regionId,pose.x,pose.y,pose.z,owner?.placement,owner?.cell].join(':');if(floors.has(key))return floors.get(key);
            const point=[pose.x,pose.y,pose.z],resolved=owner??dungeonOwnerPath(objects,point,point).owner;
            const floor=resolved?objects[resolved.placement]?.floor:undefined,value=floor===0xffffffff?undefined:floor;
            if(floors.size>=4096)floors.clear();floors.set(key,value);return value;
        },
        registerEvent(name:string,response:Readonly<{enter:number;exit:number}>){
            if(!name||name.length>65536||!response||![response.enter,response.exit].every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff))throw new Error('Invalid navigation event registration');
            if(!eventHandlers.has(name)&&eventHandlers.size>=65536)throw new Error('Navigation event registration budget');
            eventHandlers.set(name,Object.freeze({...response}));
        },
        unregisterEvent(name:string){eventHandlers.delete(name);},
        install(regionId: number, value: unknown) {floors.clear();blockKey="";blockValue=undefined;
            if(!value||typeof value!=='object'||!Number.isInteger(regionId)||regionId<=0||regionId>65535)throw new Error('Invalid navigation admission');
            const product=value as NavigationProduct;let residencyBytes=0;
            if(product.complete===true){
                if(product.regionId!==regionId||!Array.isArray(product.objects)||product.objects.length>32768)throw new Error('Invalid navigation product');
                const seen=new Set<NavPlacement['mesh']>(),seenObstacles=new Set<NavPlacement['obstacles']>(),seenTerrainCells=new Set<NavPlacement['terrainCells']>();let bytes=product.objects.length*40;
                const placements:readonly NavPlacement[]=product.objects;validateLinks(placements);
                for(const p of placements){
                    if(!p)throw new Error('Invalid collision placement');
                    if(p.terrainCells!==undefined&&!seenTerrainCells.has(p.terrainCells)){
                        if(!Array.isArray(p.terrainCells)||p.terrainCells.length>65536||p.terrainCells.some(r=>!Array.isArray(r)||r.length!==4||!r.every(Number.isFinite)||r[0]>r[2]||r[1]>r[3]))throw Error('Invalid terrain object cells');
                        seenTerrainCells.add(p.terrainCells);bytes+=p.terrainCells.length*32;
                    }
                    if(!p||![p.x,p.y,p.z,p.yaw].every(Number.isFinite)||!p.mesh||p.floor!==undefined&&(!Number.isInteger(p.floor)||p.floor<0||p.floor>0xffffffff))throw new Error('Invalid collision placement');
                    if(p.obstacles&&(!Array.isArray(p.obstacles)||p.obstacles.length>65536||p.obstacles.some(o=>![o.x,o.y,o.z,o.radiusSquared].every(Number.isFinite)||o.radiusSquared<0)))throw new Error('Invalid navigation obstacle');
                    bytes+=(p.links?.length??0)*12;if(p.obstacles&&!seenObstacles.has(p.obstacles)){bytes+=p.obstacles.length*32;seenObstacles.add(p.obstacles);}if(bytes>64*1024*1024)throw new Error('Navigation residency budget');
                    const m=p.mesh;if(seen.has(m))continue;seen.add(m);
                    if(!(m.vertices instanceof Float32Array)||!(m.cells instanceof Uint16Array)||!(m.edges instanceof Uint32Array)||m.vertices.length%3||m.cells.length%3||m.edges.length%6||!m.vertices.every(Number.isFinite)||m.bounds.length!==6||!m.bounds.every(Number.isFinite)||m.cells.some(i=>i>=m.vertices.length/3))throw new Error('Invalid collision mesh');
                    if(m.vertexDirections&&(!(m.vertexDirections instanceof Uint8Array)||m.vertexDirections.length!==m.vertices.length/3))throw Error('Invalid navigation vertex directions');
                    if(m.cellWords&&(!(m.cellWords instanceof Uint16Array)||m.cellWords.length!==m.cells.length/3)||m.cellEvents&&(!(m.cellEvents instanceof Uint8Array)||m.cellEvents.length!==m.cells.length/3)||m.edgeEvents&&(!(m.edgeEvents instanceof Uint8Array)||m.edgeEvents.length!==m.edges.length/6)||m.eventNames&&(!Array.isArray(m.eventNames)||m.eventNames.length>65536||m.eventNames.some(name=>typeof name!=='string'||name.length>65536)))throw new Error('Invalid navigation events');
                    if(m.outlineGrid){const g=m.outlineGrid;if(![g.x,g.z].every(Number.isFinite)||![g.nx,g.nz].every(n=>Number.isInteger(n)&&n>=0&&n<=65536)||g.nx*g.nz>1048576||!(g.offsets instanceof Uint32Array)||!(g.edgeIds instanceof Uint16Array)||g.offsets.length!==g.nx*g.nz+1||g.offsets[0]!==0||g.offsets.at(-1)!==g.edgeIds.length||g.edgeIds.length>8*1024*1024)throw Error('Invalid navigation outline grid');for(let i=1;i<g.offsets.length;i++)if(g.offsets[i]!<g.offsets[i-1]!)throw Error('Invalid navigation grid offsets');for(const id of g.edgeIds)if(id>=m.edges.length/6||m.edges[id*6+5]!==0)throw Error('Invalid navigation grid edge');bytes+=g.offsets.byteLength+g.edgeIds.byteLength;}
                    bytes+=(m.vertexDirections?.byteLength??0)+(m.cellWords?.byteLength??0)+(m.cellEvents?.byteLength??0)+(m.edgeEvents?.byteLength??0)+(m.eventNames?.reduce((n,name)=>n+name.length*2,0)??0);
                    bytes+=m.vertices.byteLength+m.cells.byteLength+m.edges.byteLength;if(bytes>64*1024*1024)throw new Error('Navigation residency budget');
                    for(let i=0;i<m.edges.length;i+=6)if(m.edges[i]!>=m.vertices.length/3||m.edges[i+1]!>=m.vertices.length/3||m.edges[i+2]!>=m.cells.length/3||m.edges[i+3]!==65535&&m.edges[i+3]!>=m.cells.length/3||m.edges[i+4]!>255||m.edges[i+5]!>1)throw new Error('Invalid collision edge');
                }
                residencyBytes=bytes;
            }
            if(regionId&0x8000){if(!product.complete)throw new Error('Dungeon coverage is missing');const copy=structuredClone(product.objects),nextIndex=createNavigationIndex(copy);if(residencyBytes+nextIndex.bytes>64*1024*1024)throw Error('Navigation residency budget');index=nextIndex;revision++;regions.clear();objects=copy;origin=regionId;complete=true;return;}

            if (!Number.isInteger(regionId) || regionId <= 0 || regionId >= 0x8000)
                throw new Error("Outdoor navigation region required");
            const b = value as {
                navmesh?: {
                    regionSize?: number;
                    tileSize?: number;
                    tilesPerAxis?: number;
                    regions?: {
                        dx: number;
                        dz: number;
                        heightMap?:string;planeType?:string;planeHeight?:string;blockedTiles: string;
                        tileCellIds: string;
                        cells: {
                            count: number;
                        };
                        objects?: unknown[];
                    }[];
                };
            };
            const nav = b?.navmesh;
            if (!nav || nav.regionSize !== 1920 || nav.tileSize !== 20 || nav.tilesPerAxis !== 96 || !Array.isArray(nav.regions) || nav.regions.length > 9)
                throw new Error("Unsupported published navigation schema");
            const admitted = [];
            for (const row of nav.regions) {
                if (!Number.isInteger(row.dx) || !Number.isInteger(row.dz) || Math.abs(row.dx) > 1 || Math.abs(row.dz) > 1 || !Number.isInteger(row.cells?.count) || row.cells.count < 0 || row.cells.count > 65536)
                    throw new Error("Invalid navigation region");
                const blocked = bytes(row.blockedTiles, 9216), ids = bytes(row.tileCellIds, 36864);
                const rx = (regionId & 255) + row.dx, rz = (regionId >>> 8) + row.dz;
                if (rx < 0 || rx > 255 || rz < 0 || rz > 127)
                    throw new Error("Invalid navigation sector");
                if((row.planeType===undefined)!==(row.planeHeight===undefined))throw Error('Incomplete navigation plane');
                const planeTypes=row.planeType===undefined?undefined:bytes(row.planeType,36);
                const planeHeights=row.planeHeight===undefined?undefined:new DataView(bytes(row.planeHeight,36*4).buffer);
                if(planeHeights)for(let i=0;i<36;i++)if(!Number.isFinite(planeHeights.getFloat32(i*4,true)))throw Error('Invalid navigation plane height');
                admitted.push({ id: rx | (rz << 8), grid: { blocked, planeTypes,planeHeights,cells: new DataView(ids.buffer), count: row.cells.count, objects: !!row.objects?.length,heights:row.heightMap?new DataView(bytes(row.heightMap,97*97*4).buffer):undefined } });
            }
            if(new Set(admitted.map(row=>row.id)).size!==admitted.length)throw new Error('Duplicate navigation region');
            for(const {grid} of admitted)if(grid.heights)for(let i=0;i<97*97;i++)if(!Number.isFinite(grid.heights.getFloat32(i*4,true)))throw new Error('Invalid terrain height');
            if (regions.size + admitted.filter(row => !regions.has(row.id)).length > 64)
                throw new Error("Navigation residency limit exceeded");
            const copy=product.complete?structuredClone(product.objects):[];
            const nextIndex=createNavigationIndex(copy);if(residencyBytes+nextIndex.bytes>64*1024*1024)throw Error('Navigation residency budget');
            index=nextIndex;revision++;regions.clear();objects=copy;origin=regionId;complete=product.complete===true;
            for (const row of admitted)
                regions.set(row.id, row.grid);
        },
        clip(from: Pose, to: Pose, output?: { sourceOwner?:import('@/engine/foundation/navigation/dungeon-ownership').NavOwner;owners?:readonly import('@/engine/foundation/navigation/dungeon-ownership').NavOwnerSpan[];context?:number;events?:readonly NavigationEvent[];owner?:{placement:number;cell:number}; slide: boolean; normal?: readonly number[]; cell?: number; edge?: number }): Pose | null {
            if(output){output.owners=[];output.events=[];output.owner=undefined;output.normal=undefined;output.cell=undefined;output.edge=undefined;}
            let status=0,sourceOwner=output?.sourceOwner,firstLeg=true;
            let reachedOwner:NavOwner|undefined;
            const segment=(from:Pose,to:Pose):Pose|null=>{
            status=0;reachedOwner=undefined;
            if(((from.regionId|to.regionId)&0x8000)&&from.regionId!==to.regionId)return null;
            if(!(from.regionId&0x8000))to={...to,regionId:from.regionId,x:to.x+((to.regionId&255)-(from.regionId&255))*1920,z:to.z+((to.regionId>>>8)-(from.regionId>>>8))*1920};
            function canonicalPose(p:Pose):Pose|null{
                if(p.regionId&0x8000)return p;
                const dx=Math.floor(p.x/1920),dz=Math.floor(p.z/1920),rx=(p.regionId&255)+dx,rz=(p.regionId>>>8)+dz;
                if(rx<0||rx>255||rz<0||rz>127)return null;
                return {...p,regionId:rx|(rz<<8),x:p.x-dx*1920,z:p.z-dz*1920};
            }
            const dungeon=!!(from.regionId&0x8000);
            if(dungeon&&(!complete||origin!==from.regionId))return null;
            const ox=dungeon?0:((from.regionId&255)-(origin&255))*1920,oz=dungeon?0:((from.regionId>>>8)-(origin>>>8))*1920;
            if(firstLeg&&!sourceOwner)sourceOwner=dungeonOwnerPath(objects,[from.x+ox,from.y,from.z+oz],[from.x+ox,from.y,from.z+oz]).owner??undefined;
            firstLeg=false;
            const retained=sourceOwner,placement=retained&&objects[retained.placement];
            if(retained&&placement){const start=ownedPlacementStart(placement,retained.cell,[from.x+ox,from.y,from.z+oz]);from={...from,x:start[0]!-ox,z:start[2]!-oz};}
            const height=(x:number,z:number,y:number)=>surfaceHeight({...from,x,y,z});
            const startHeight=height(from.x,from.z,from.y);
            if(dungeon&&startHeight===null)return null;
            const deck=(x:number,z:number,y:number)=>objects.some(p=>{const q=navLocal(p,x+ox,y,z+oz),h=navHeight(p.mesh,q[0],q[2],q[1]);return h!==null&&Math.abs(h-q[1])<=2;});
            // Native 453fa0 delegates to the cell stepper before resolving the
            // endpoint. An outside destination can still produce a valid wall
            // contact. The chord coverage pass below rejects unlinked gaps.

            const requestedSpan=Math.max(Math.abs(to.x-from.x),Math.abs(to.z-from.z),.01);
            const candidatePath=(dungeon?dungeonOwnerPath:terrainOwnerPath)(objects,[from.x+ox,from.y,from.z+oz],[to.x+ox,to.y,to.z+oz],sourceOwner);
            const ownerPath=candidatePath.owner?candidatePath:null;
            if(!dungeon&&cell(from.regionId,from.x,from.z)!=='open'&&!ownerPath?.spans.some(span=>span.from===0)&&!deck(from.x,from.z,from.y))return null;
            if(dungeon&&!ownerPath)return null;
            const passages=linkPassages(objects,[from.x+ox,from.y,from.z+oz],[to.x+ox,to.y,to.z+oz],!!ownerPath);
            let contact=Infinity,retainedFraction=1;
            let response:ReturnType<typeof navContactDetail>=null;
            for(const p of objects){
                const edge=navContactDetail(p,[from.x+ox,from.y,from.z+oz],[to.x+ox,to.y,to.z+oz],objects,passages,output?.slide===true,!dungeon,ownerPath?.spans.filter(span=>objects[span.placement]===p));
                const owned=!ownerPath||ownerPath.spans.some(span=>objects[span.placement]===p&&edge&&edge.fraction>=span.from-1e-8&&edge.fraction<=span.to+1e-8);
                if(edge&&owned&&edge.fraction<contact){contact=edge.fraction;response=edge;}
                const obstacle=navObstacleContact(p,[from.x+ox,from.y,from.z+oz],[to.x+ox,to.y,to.z+oz],ownerPath?.spans.filter(span=>objects[span.placement]===p));
                if(obstacle<contact){contact=obstacle;response=null;}
            }
            if(dungeon&&output?.context&&ownerPath){
                const events=navigationEvents(objects,ownerPath.spans,output.context).filter(e=>e.fraction<=contact+1e-8);
                for(let i=0;i<events.length;i++){
                    const event=events[i]!,handler=eventHandlers.get(event.name);if(!handler)continue;
                    const result=event.entering?handler.enter:handler.exit;if(!(result&0x10000001))continue;
                    output.events=events.slice(0,i+1);status=result;
                    if(result&0x10000000)return null;
                    const stopped=navigationEventStop(objects,ownerPath.spans,event,[from.x,from.y,from.z],[to.x,to.y,to.z]);
                    reachedOwner=stopped.owner;output.owner=stopped.owner;
                    output.owners=event.edge===null&&!event.entering
                        ?ownerPath.spans.filter(s=>s.from<event.fraction).map((s,i,all)=>i===all.length-1?{...s,to:1}:s)
                        :dungeonOwnerPath(objects,[from.x,from.y,from.z],stopped.point,sourceOwner).spans;
                    return canonicalPose({...to,x:stopped.point[0],y:stopped.point[1],z:stopped.point[2]});
                }
            }
            if(response?.point){status=response.status;if(output&&status===1){output.cell=response.cell;output.edge=response.edge;if(output.slide)output.normal=response.normal??undefined;}retainedFraction=contact;to={...to,x:response.point[0]-ox,y:response.point[1],z:response.point[2]-oz};}
            else if(contact<=1){const t=Math.max(0,contact-.01/Math.max(Math.abs(to.x-from.x),Math.abs(to.z-from.z),.01));retainedFraction=t;to={...to,x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t,z:from.z+(to.z-from.z)*t};}
            if(!dungeon){
                const resolved=ownerPath?terrainOwnerPath(objects,[from.x+ox,from.y,from.z+oz],[to.x+ox,to.y,to.z+oz],sourceOwner):null;
                reachedOwner=status&0x10?undefined:resolved?.stop===1?resolved.owner??undefined:undefined;
                if(output&&resolved){output.owners=resolved.spans;output.owner=reachedOwner;}
                to={...to,y:surfaceHeight(to,status&0x10?undefined:resolved?.stop===1?resolved.owner??undefined:undefined,false)??to.y};
            }
            if(dungeon){
                if(ownerPath!.stop<retainedFraction){
                    const fraction=Math.max(0,ownerPath!.stop-.01/requestedSpan);
                    const ratio=fraction/Math.max(retainedFraction,1e-12);
                    to={...from,x:from.x+(to.x-from.x)*ratio,y:from.y+(to.y-from.y)*ratio,z:from.z+(to.z-from.z)*ratio};
                }
                const resolved=dungeonOwnerPath(objects,[from.x,from.y,from.z],[to.x,to.y,to.z],sourceOwner);
                reachedOwner=resolved.owner??undefined;
                if(output){output.owners=resolved.spans;output.owner=reachedOwner;output.events=navigationEvents(objects,resolved.spans,output.context??0);}
                const endpoint=resolved.owner;
                if(endpoint){const p=objects[endpoint.placement]!,q=navLocal(p,to.x,to.y,to.z),h=navHeight(p.mesh,q[0],q[2],q[1],endpoint.cell);if(h!==null)to={...to,y:h+p.y};}
                return canonicalPose(to);
            }
            const dx = to.x - from.x, dz = to.z - from.z;
            let x = Math.floor(from.x / 20), z = Math.floor(from.z / 20);
            const sx = Math.sign(dx), sz = Math.sign(dz), tx = dx ? 20 / Math.abs(dx) : Infinity, tz = dz ? 20 / Math.abs(dz) : Infinity;
            let mx = dx ? ((sx > 0 ? (x + 1) * 20 : x * 20) - from.x) / dx : Infinity, mz = dz ? ((sz > 0 ? (z + 1) * 20 : z * 20) - from.z) / dz : Infinity;
            for (let n = 0; n < 256; n++) {
                const t = Math.min(mx, mz);
                if (t > 1)
                    return canonicalPose(to);
                const crossX = mx <= mz, crossZ = mz <= mx;
                // Supercover checks both side cells at exact corners; no diagonal squeeze.
                const a = crossX ? cell(from.regionId, (x + sx + .5) * 20, (z + .5) * 20) : "open";
                const b = crossZ ? cell(from.regionId, (x + .5) * 20, (z + sz + .5) * 20) : "open";
                const c = crossX && crossZ ? cell(from.regionId, (x + sx + .5) * 20, (z + sz + .5) * 20) : "open";
                if (a === "unknown" || b === "unknown" || c === "unknown")
                    return null;
                if ((a === "blocked" || b === "blocked" || c === "blocked")&&!ownerPath?.spans.some(span=>t>=span.from&&t<=span.to)&&!deck(from.x+dx*Math.min(1,t+.000001),from.z+dz*Math.min(1,t+.000001),from.y+(to.y-from.y)*t)) {
                    const rest = Math.max(0, t - .01 / Math.max(Math.abs(dx), Math.abs(dz)));
                    const point={...from,x:from.x+dx*rest,y:from.y+(to.y-from.y)*rest,z:from.z+dz*rest};
                    // The endpoint changed at the terrain boundary. Its old
                    // chord Y belongs to the rejected destination, not this
                    // terrain stand (403E80). Publish matching height/owner.
                    if(output){
                        output.owner=undefined;
                        output.owners=ownerPath?terrainOwnerPath(objects,[from.x+ox,from.y,from.z+oz],[point.x+ox,point.y,point.z+oz],sourceOwner).spans:[];
                    }
                    return canonicalPose({...point,y:surfaceHeight(point,undefined,false)??point.y});
                }
                if (crossX) {
                    x += sx;
                    mx += tx;
                }
                if (crossZ) {
                    z += sz;
                    mz += tz;
                }
            }
            return null;
            };
            if(from.regionId===to.regionId&&from.x===to.x&&from.y===to.y&&from.z===to.z)return {...from};
            if(!regionMoveAllowed(from,to))return null;
            let start=from;
            for(let calls=1;calls<=6;calls++){
                const target=regionMoveDestination(to,start.regionId),point=segment(start,target);
                const decision=regionMoveContinuation(start,target,{point,status:point?status:0x10000000},calls);
                if(decision==='stop'){
                    return point;
                }
                if(decision==='reject')return null;
                // Continue from the reached cell, never the original source cell.
                sourceOwner=reachedOwner;
                start=point!;
            }
            return null;
        },
        clear() {floors.clear();index=undefined;revision++;blockKey="";blockValue=undefined; eventHandlers.clear();regions.clear();objects=[];origin=0;complete=false; }
    };
}
