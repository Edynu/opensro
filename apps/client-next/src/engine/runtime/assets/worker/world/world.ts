import {decodeSoundTerrain} from '@/engine/foundation/audio/terrain-sounds';
import {dungeonWaterGroup} from '@/engine/foundation/rendering/dungeon-water';
import {createCharacterPose} from "@/engine/foundation/animation/animation-pose";
import {characterRadius} from "@/engine/foundation/animation/character-bounds";
import {skyGroups} from "@/engine/foundation/rendering/sky-geometry";
import {radians} from '@/engine/foundation/math/angles';
import {createWorldResources} from "./resources/resources";
import {FRONTEND_SCENE_BYTES,FRONTEND_DECODE_BYTES,WORLD_SCENE_BYTES,WORLD_DECODE_BYTES,worldSceneBytes} from "@/engine/foundation/rendering/world-scene";
import type {WorldScene,WorldGroup,WorldMaterial,TerrainRange} from "@/engine/contracts/scene";
import {identity,mapPlacement} from "@/engine/foundation/rendering/world-math";
import type {Bundle,Mesh} from "./internal/resource-contract";
import {sceneryMaterial} from '@/engine/foundation/rendering/scenery-modifiers';
import {sceneryParticles} from '@/engine/foundation/rendering/scenery-particles';
import {worldObjectMaterial} from '@/engine/foundation/rendering/world-material';

// Native association ordering/claim/fringe algorithm (sub_8b3aa0). Unlike a
// dominant-texture shortcut, every surviving association has a corner mask.
function passes(words:readonly number[],step:number){
 const n=16/step,axis=n+1,pad=n+2,keys=new Set<number>();const sampled=[];
 for(let z=0;z<=n;z++)for(let x=0;x<=n;x++){const w=words[z*step*17+x*step]!;const key=((w&1023)<<6)|((w>>>13)&7);sampled.push(w);keys.add(key);}
 const claimed=new Uint8Array(n*n),result:{x:number;z:number;key:number;mask:number}[]=[];
 for(const key of [...keys].sort((a,b)=>a-b).slice(0,49)){
  const mask=new Uint8Array(axis*axis),cells=new Uint8Array(pad*pad);
  for(let z=0;z<=n;z++)for(let x=0;x<=n;x++)if(sampled[z*axis+x]===((key>>>6)|((key&7)<<13))){mask[z*axis+x]=1;const t=z*pad+x;cells[t]=cells[t+1]=cells[t+pad]=cells[t+pad+1]=2;}
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){const i=z*n+x,t=(z+1)*pad+x+1;if(!(cells[t]!&254)||claimed[i])continue;const v=z*axis+x;mask[v]=mask[v+1]=mask[v+axis]=mask[v+axis+1]=1;claimed[i]=1;for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)if(dx||dz)cells[t+dz*pad+dx]!|=1;}
  for(let z=0;z<n;z++)for(let x=0;x<n;x++)if(cells[(z+1)*pad+x+1]){const i=z*axis+x,m=mask[i]!|(mask[i+1]!<<1)|(mask[i+axis]!<<2)|(mask[i+axis+1]!<<3);if(m)result.push({x:x*step,z:z*step,key,mask:m});}
 }
 const last=new Map<number,number>();for(let i=0;i<result.length;i++){const p=result[i]!;if(p.mask===15)last.set(p.z*17+p.x,i);}
 return result.filter((p,i)=>i>=(last.get(p.z*17+p.x)??0));
}

export function createWorldDecoder(budget=WORLD_DECODE_BYTES){const resources=createWorldResources();return {
 resolve:resources.resolve,
 decode(bytes:Uint8Array|Bundle,frontend=false):WorldScene {
  let reserved=0;const reserve=(bytes:number)=>{reserved+=bytes;if(!Number.isSafeInteger(reserved)||reserved>(frontend?FRONTEND_DECODE_BYTES:budget))throw new Error(`World decode scratch budget exceeded: ${reserved} bytes > ${frontend?FRONTEND_DECODE_BYTES:budget} bytes`);};
  const b=bytes instanceof Uint8Array?JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)) as Bundle:bytes;
  if(!b.source||!Number.isInteger(b.source.sectorX)||!Number.isInteger(b.source.sectorY)||!b.terrain||!b.objects?.resources)throw new Error("Unsupported world bundle");
  const origin=b.source.sectorX|(b.source.sectorY<<8),groups:WorldGroup[]=[],warnings:string[]=[];
  if(b.dungeonBlocks&&(!(origin&0x8000)||!Array.isArray(b.dungeonBlocks)||b.dungeonBlocks.length>4096||b.dungeonBlocks.some((block,index)=>block.index!==index||!Array.isArray(block.visibleBlocks))))throw Error('Invalid dungeon block publication');
  const refs=new Map(b.objects.resources.bsr.map(row=>[row.objectId,row])),meshes=new Map(b.objects.resources.meshes.map(row=>[row.sourcePath.toLowerCase(),row])),sets=new Map(b.objects.resources.materialSets.map(row=>[row.sourcePath.toLowerCase(),row.materials]));
  const instances=new Map<string,{mesh:Mesh;collision:NonNullable<WorldGroup["collision"]>[number][];block?:number;material:WorldMaterial;materialOrder:NonNullable<WorldGroup["materialOrder"]>;matrices:number[];visibility:NonNullable<WorldGroup["visibility"]>[number][];center:number[];radius:number}>(),seen=new Set<string>();
  const animatedByPath=new Map((b.animated??[]).map(entry=>[entry.sourcePath.toLowerCase(),entry])),animatedPlacements=new Map<string,{orders:{object:string;branch:number;paths:string[]}[];matrices:number[];visibility:NonNullable<WorldGroup["visibility"]>[number][]}>();
  const placementCells=new Map<string,[number,number][]>();
  for(const p of b.objects.placements){
   const key=[Number(p.regionId),p.objectId,p.uid,p.position.x,p.position.y,p.position.z].join(":"),source=Number(p.sourceSector?.sectorId??p.regionId);
   const cell:[number,number]=[((source&255)-(origin&255))*6+(p.blockX??Math.floor(p.position.x/320)),((source>>>8)-(origin>>>8))*6+(p.blockZ??Math.floor(p.position.z/320))];
   const cells=placementCells.get(key)??[];if(!cells.some(c=>c[0]===cell[0]&&c[1]===cell[1])){reserve(32);cells.push(cell);}placementCells.set(key,cells);
  }
  const models:Record<string,import('@/engine/contracts/character').CharacterModel>={},scenery:import('@/engine/contracts/scenery').SceneryEmitter[]=[];
  for(const p of b.objects.placements){
   const region=Number(p.regionId),key=`${region}:${p.objectId}:${p.uid}:${p.position.x}:${p.position.y}:${p.position.z}`;if(seen.has(key))continue;seen.add(key);
   const rootRef=refs.get(p.objectId);if(!rootRef){warnings.push(`Object resource absent: ${p.objectId}`);continue;}
   const branches=rootRef.branches??[rootRef];
   if(branches.length>512)throw new Error("Compound branch budget exceeded");
   if(rootRef.branches&&branches.some(branch=>branch.meshPaths.some(path=>!meshes.has(path.toLowerCase()))||branch.materialPaths.some(path=>!sets.has(path.toLowerCase())))){warnings.push(`Compound dependencies absent: ${p.objectId}`);continue;}
   const resourceMeshes=(rootRef.renderMeshSection?.paths??rootRef.meshPaths).map(path=>meshes.get(path.toLowerCase())).filter((mesh):mesh is Mesh=>!!mesh);
   const low=[0,2].map(axis=>Math.min(...resourceMeshes.map(mesh=>mesh.bounds.min[axis]!))),high=[0,2].map(axis=>Math.max(...resourceMeshes.map(mesh=>mesh.bounds.max[axis]!)));
   const fadeRadius=resourceMeshes.length?Math.hypot(high[0]!-low[0]!,high[1]!-low[1]!)/2:0;
   const visibility={id:key,radius:fadeRadius,range:p.lodGroupIndex===2?2020:480,sceneryRange:p.lodGroupIndex===2,cellRadius:p.lodGroupIndex===2?15:7,cells:placementCells.get(key)!};
   for(const [branchIndex,ref] of branches.entries()){
   const materials=ref.materialPaths.flatMap(path=>sets.get(path.toLowerCase())??[]),matrix=mapPlacement(region,origin,p.position.x,p.position.y,p.position.z,radians(p.yaw));
   const animation=animatedByPath.get(ref.sourcePath?.toLowerCase()??'');
   const emitters=sceneryParticles(ref.modifiers?.particleModifiers,key,branchIndex,origin,matrix,message=>warnings.push(`${ref.sourcePath}: ${message}`));reserve(emitters.length*512);scenery.push(...emitters);
   if(animation?.model){reserve(256);let placements=animatedPlacements.get(animation.glbPublicPath);if(!placements){placements={orders:[],matrices:[],visibility:[]};animatedPlacements.set(animation.glbPublicPath,placements);models[animation.glbPublicPath]=animation.model;}const m=matrix.slice();for(let i=8;i<12;i++)m[i]=-m[i]!;placements.matrices.push(...m);placements.visibility.push(visibility);placements.orders.push({object:key,branch:branchIndex,paths:ref.renderMeshSection?.paths??ref.meshPaths});}
   for(const [meshIndex,path] of (ref.renderMeshSection?.paths??ref.meshPaths).entries()){if(animation?.model&&animation.skinnedMeshPaths.some(p=>p.toLowerCase()===path.toLowerCase()))continue;const mesh=meshes.get(path.toLowerCase());if(!mesh){warnings.push(`Mesh absent: ${path}`);continue;}
    if(!mesh.positions.length||mesh.positions.length%3||mesh.normals.length!==mesh.positions.length||mesh.uvs.length!==mesh.positions.length/3*2||!mesh.positions.every(Number.isFinite)||!mesh.normals.every(Number.isFinite)||!mesh.uvs.every(Number.isFinite)||mesh.indices.length%3||mesh.indices.some(i=>!Number.isInteger(i)||i<0||i>=mesh.positions.length/3)){warnings.push(`Invalid mesh omitted: ${path}`);continue;}
    const mat=materials.find(m=>m.name.toLowerCase()===mesh.metadata.materialName.toLowerCase());if(!mat){warnings.push(`Material absent: ${mesh.metadata.materialName}`);continue;}
    const material:WorldMaterial={...sceneryMaterial(worldObjectMaterial(mat),ref.modifiers,materials.indexOf(mat),message=>warnings.push(`${ref.sourcePath}: ${message}`)),fog:p.dungeonBlock===undefined?undefined:b.dungeonBlocks?.[p.dungeonBlock]?.fog,objectFade:p.dungeonBlock===undefined};
    const id=`${path}:${ref.materialPaths.join(";")}:${ref.modifiers&&(ref.modifiers.materialModifiers.length||ref.modifiers.textureModifiers.length)?ref.sourcePath:""}:${p.dungeonBlock??"outdoor"}`,center=[matrix[12]!,matrix[13]!,matrix[14]!],radius=Math.max(...mesh.bounds.min.map(Math.abs),...mesh.bounds.max.map(Math.abs))*Math.sqrt(3);
    let group=instances.get(id);if(!group){reserve(mesh.positions.length/3*224+mesh.indices.length*16);group={mesh,block:p.dungeonBlock,collision:[],material,materialOrder:{set:ref.materialPaths.join(";"),index:materials.indexOf(mat)},matrices:[],visibility:[],center:Array.from(matrix.slice(12,15)),radius};instances.set(id,group);}else group.radius=Math.max(group.radius,Math.hypot(...center.map((v,i)=>v-group!.center[i]!))+radius);
    // Native A40044 skips parts without the loaded BMS object-nav payload.
    // Keep their draw instances, but never admit them as camera obstacles.
    reserve(256);if((mesh.headerOffsets?.[7]??0)!==0)group.collision.push({instance:group.matrices.length/16,object:key,order:branchIndex*65536+meshIndex,indexStart:0,indexCount:mesh.indices.length});group.matrices.push(...matrix);group.visibility.push(visibility);
   }
  }
  }
  for(const [id,g] of instances)groups.push({id:`object:${id}`,dungeonBlock:g.block,collision:g.collision,visibility:g.block===undefined?g.visibility:undefined,materialOrder:g.materialOrder,instanceRadius:Math.max(...g.mesh.bounds.min.map(Math.abs),...g.mesh.bounds.max.map(Math.abs))*Math.sqrt(3),geometry:{world:true,positions:new Float32Array(g.mesh.positions),normals:new Float32Array(g.mesh.normals),uvs:new Float32Array(g.mesh.uvs),indices:new Uint32Array(g.mesh.indices),instances:new Float32Array(g.matrices),transform:identity()},material:g.material,center:[g.center[0]!,g.center[1]!,g.center[2]!],radius:g.radius});
  for(const entry of b.animated??[]){const placements=animatedPlacements.get(entry.glbPublicPath);if(!entry.model||!placements)continue;const {matrices,visibility}=placements;const model=entry.model,pose=createCharacterPose(model),radius=characterRadius(model);pose.evaluate(entry.clipName,0);
   const ref=b.objects.resources.bsr.flatMap(row=>row.branches??[row]).find(row=>row.sourcePath?.toLowerCase()===entry.sourcePath.toLowerCase());
   if(!ref)throw Error('Animated world material provenance is absent');
   const materials=ref.materialPaths.flatMap(path=>sets.get(path.toLowerCase())??[]);
   for(let i=0;i<model.primitives.length;i++){const p=model.primitives[i]!,mat=materials.find(row=>row.name===p.name);if(!mat)throw Error('Animated world material is absent: '+p.name);reserve(p.geometry.positions.length/3*224+p.geometry.indices.length*16+matrices.length*8+p.joints.length*128);const bones=new Float32Array(p.joints.length*16);pose.palette(p,bones);const material={...sceneryMaterial(worldObjectMaterial(mat),ref.modifiers,materials.indexOf(mat),message=>warnings.push(`${ref.sourcePath}: ${message}`)),sharedPose:true};
    const collision:NonNullable<WorldGroup['collision']>[number][]=[];
    // Animated GLBs merge equal-material BMS parts in input order. Recover their
    // index intervals from the source mesh census, without duplicating skin poses.
    const sources=entry.skinnedMeshPaths.map(path=>({path,mesh:meshes.get(path.toLowerCase())})).filter(row=>row.mesh?.metadata.materialName===p.name);
    if(sources.reduce((n,row)=>n+row.mesh!.indices.length,0)!==p.geometry.indices.length)throw new Error('Animated collision part provenance is absent');
    for(const [instance,placement] of placements.orders.entries()){let indexStart=0;for(const row of sources){const part=placement.paths.findIndex(path=>path.toLowerCase()===row.path.toLowerCase());if(part<0)throw new Error('Animated collision part is outside its BSR');if((row.mesh!.headerOffsets?.[7]??0)!==0)collision.push({instance,object:placement.object,order:placement.branch*65536+part,indexStart,indexCount:row.mesh!.indices.length});indexStart+=row.mesh!.indices.length;}}
    groups.push({id:`animated:${entry.glbPublicPath}:${i}`,collision,visibility,animation:{model:entry.glbPublicPath,primitive:i,clip:entry.clipName},instanceRadius:radius,center:[0,0,0],radius:100000,material,geometry:{...p.geometry,world:true,instances:new Float32Array(matrices),bones,material}});
   }
  }
  const sectors=(b.terrain.sectors??[{...b.source,blocks:b.terrain.blocks}]).map(sector=>({...sector,lightmapPublicPath:sector.lightmapPublicPath??b.terrainTextures.sectors?.find(t=>t.sectorX===sector.sectorX&&t.sectorY===sector.sectorY)?.lightmapPublicPath??(sector.sectorX===b.source.sectorX&&sector.sectorY===b.source.sectorY?b.terrainTextures.lightmapPublicPath:undefined)}));
  const tiles=new Map(b.terrainTextures.tileCatalog.referencedTiles.map(row=>[row.textureId,row.imagePublicPath]));
  for(const sector of sectors)for(const block of sector.blocks){
   if(block.heights.length!==289||block.textureData.length!==289||!block.heights.every(Number.isFinite)||!block.textureData.every(v=>Number.isSafeInteger(v)&&v>=0&&v<=65535))throw new Error("Malformed native terrain block");
   const cx=(sector.sectorX-b.source.sectorX)*6+block.blockX,cz=(sector.sectorY-b.source.sectorY)*6+block.blockZ;
   const cellBounds=[cx*320,Math.min(...block.heights),cz*320,(cx+1)*320,Math.max(...block.heights),(cz+1)*320] as const;
   for(let lod=0;lod<4;lod++){
    const builders=new Map<number,{positions:number[];normals:number[];uvs:number[];colors:number[];indices:number[];maskUVs:number[]}>(),step=1<<lod;
    for(const p of passes(block.textureData,step)){
     reserve(4*224+6*16);
     const id=p.key*2+(p.mask===15?0:1);let g=builders.get(id);if(!g){reserve(289*8+256);g={positions:[],normals:[],uvs:[],colors:[],indices:[],maskUVs:[]};builders.set(id,g);}const base=g.positions.length/3;
     const uv=.25*[1,.5,.25,2,4,0,0,0][p.key&7]!;
     for(const [dx,dz] of [[0,0],[step,0],[0,step],[step,step]]){const x=p.x+dx!,z=p.z+dz!,h=block.heights[z*17+x]!;g.positions.push(cx*320+x*20,h,cz*320+z*20);g.normals.push(0,1,0);g.uvs.push((block.blockX*16+x)*uv,(block.blockZ*16+z)*uv);g.colors.push(p.mask&1,(p.mask>>>1)&1,(p.mask>>>2)&1,(p.mask>>>3)&1);g.maskUVs.push(dx!/step,dz!/step);}
     if(((p.x/step)&1)===((p.z/step)&1))g.indices.push(base,base+2,base+3,base,base+3,base+1);else g.indices.push(base+1,base,base+2,base+1,base+2,base+3);
    }
    if(sector.lightmapPublicPath){
     const positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices:number[]=[];
     for(let z=0;z<=16;z+=step)for(let x=0;x<=16;x+=step){positions.push(cx*320+x*20,block.heights[z*17+x]!,cz*320+z*20);normals.push(0,1,0);uvs.push((block.blockX*16+x)/96,(block.blockZ*16+z)/96);}
     const axis=16/step+1;for(let z=0;z<axis-1;z++)for(let x=0;x<axis-1;x++){const a=z*axis+x;if((x&1)===(z&1))indices.push(a,a+axis,a+axis+1,a,a+axis+1,a+1);else indices.push(a+1,a,a+axis,a+1,a+axis,a+axis+1);}
     reserve(positions.length/3*224+indices.length*16+289*8);
     const min=Math.min(...block.heights),max=Math.max(...block.heights),center=[cx*320+160,(min+max)/2,cz*320+160] as const,radius=Math.hypot(160,(max-min)/2,160);
     groups.push({id:`lightmap:${cx}:${cz}:${lod}`,center,radius,ranges:[{bounds:cellBounds,cell:[cx,cz],lod,indexStart:0,indexCount:indices.length,vertexStart:0,vertexCount:positions.length/3,center,radius,heights:block.heights,water:block.water?{...block.water}:undefined}],material:{texture:sector.lightmapPublicPath,color:[1,1,1,1],alphaCutoff:0,blend:true,doubleSided:true,unlit:true,lightmap:true},geometry:{world:true,positions:new Float32Array(positions),normals:new Float32Array(normals),uvs:new Float32Array(uvs),indices:new Uint32Array(indices),instances:identity(),transform:identity()}});
    }
    for(const [id,g] of builders){const key=Math.floor(id/2),texture=tiles.get(key>>>6);if(!texture){warnings.push(`Terrain texture absent: ${key>>>6}`);continue;}const min=Math.min(...block.heights),max=Math.max(...block.heights);
     groups.push({id:`terrain:${cx}:${cz}:${lod}:${id}`,cell:[cx,cz],lod,center:[cx*320+160,(min+max)/2,cz*320+160],radius:Math.hypot(160,(max-min)/2,160),ranges:[{bounds:cellBounds,cell:[cx,cz],lod,indexStart:0,indexCount:g.indices.length,vertexStart:0,vertexCount:g.positions.length/3,center:[cx*320+160,(min+max)/2,cz*320+160],radius:Math.hypot(160,(max-min)/2,160),heights:block.heights,water:block.water?{...block.water}:undefined}],material:{color:[1,1,1,1],texture,alphaCutoff:0,blend:!!(id&1),doubleSided:true,unlit:true,terrain:true,order:key},geometry:{world:true,positions:new Float32Array(g.positions),normals:new Float32Array(g.normals),uvs:new Float32Array(g.uvs),colors:new Float32Array(g.colors),maskUVs:new Float32Array(g.maskUVs),indices:new Uint32Array(g.indices),instances:identity(),transform:identity()}});
    }
   }
   if(block.water?.type===1&&block.water.waveType!==0&&!b.water?.specialTexturePublicPath)throw new Error('Special water texture absent');
   if(!(origin&0x8000)&&b.water?.normalFramePublicPaths[0]&&(block.water?.type===0||block.water?.type===1&&block.water.waveType!==0)){
    const axis=block.water.type===0?17:2,positions:number[]=[],uvs:number[]=[],colors:number[]=[],normals:number[]=[],indices:number[]=[];
    let wet=false;const y=Math.fround(block.water.height);
    for(let z=0;z<axis;z++)for(let x=0;x<axis;x++){
     const depth=Math.fround((y-Math.fround(block.heights[z*17+x]!))*0.5),alpha=axis===2?1:Math.max(0,Math.min(15,Math.trunc(depth)))/15;wet ||= alpha>0;
     positions.push(cx*320+x/(axis-1)*320,y,cz*320+z/(axis-1)*320);uvs.push(x/(axis-1)*4,z/(axis-1)*4);colors.push(1,1,1,alpha);normals.push(0,1,0);
    }
    if(wet){for(let z=0;z<axis-1;z++)for(let x=0;x<axis-1;x++){const a=z*axis+x;indices.push(a,a+axis,a+1,a+1,a+axis,a+axis+1);}
     reserve(positions.length*32+indices.length*16);
     groups.push({id:`water:${cx}:${cz}`,center:[cx*320+160,y,cz*320+160],radius:227,material:{color:[1,1,1,1],water:block.water.type===0,texture:block.water.type===1?b.water.specialTexturePublicPath:b.water.normalFramePublicPaths[0],frames:block.water.type===1?undefined:b.water.normalFramePublicPaths,alphaCutoff:0,blend:true,doubleSided:true,unlit:true},geometry:{world:true,positions:new Float32Array(positions),normals:new Float32Array(normals),uvs:new Float32Array(uvs),colors:new Float32Array(colors),indices:new Uint32Array(indices),instances:identity(),transform:identity()}});
    }
   }
  }
  // Association identity, not cell identity, owns the draw resource. All LOD
  // ranges stay resident; selection compacts indices into one persistent span.
  const terrain=new Map<string,WorldGroup[]>(),merged=groups.filter(g=>!g.material.terrain&&!g.material.lightmap);
  for(const group of groups)if(group.material.terrain||group.material.lightmap){const key=`${group.material.texture}:${group.material.blend}:${group.material.order}`;let list=terrain.get(key);if(!list){list=[];terrain.set(key,list);}list.push(group);}
  for(const [key,list] of terrain){
   const vertices=list.reduce((n,g)=>n+g.geometry.positions.length/3,0),count=list.reduce((n,g)=>n+g.geometry.indices.length,0);
   const positions=new Float32Array(vertices*3),normals=new Float32Array(vertices*3),uvs=new Float32Array(vertices*2),colors=list.some(g=>g.geometry.colors)?new Float32Array(vertices*4):undefined,maskUVs=list.some(g=>g.geometry.maskUVs)?new Float32Array(vertices*2):undefined,indices=new Uint32Array(count),ranges:TerrainRange[]=[];
   let v=0,i=0;for(const group of list){const g=group.geometry;positions.set(g.positions,v*3);normals.set(g.normals!,v*3);uvs.set(g.uvs!,v*2);if(colors){if(g.colors)colors.set(g.colors,v*4);else colors.fill(1,v*4,(v+g.positions.length/3)*4);}if(g.maskUVs)maskUVs!.set(g.maskUVs,v*2);for(let n=0;n<g.indices.length;n++)indices[i+n]=g.indices[n]!+v;ranges.push({...group.ranges![0]!,vertexStart:v,indexStart:i});v+=g.positions.length/3;i+=g.indices.length;}
   merged.push({id:`terrain-batch:${key}`,center:[960,0,960],radius:10000,material:list[0]!.material,ranges,geometry:{world:true,positions,normals,uvs,colors,maskUVs,indices,instances:identity(),transform:identity()}});
  }
  if(b.dungeonWater?.length){if(!(origin&0x8000))throw Error("Dungeon water in outdoor bundle");for(const surface of b.dungeonWater)merged.push(dungeonWaterGroup(surface,b.water?.normalFramePublicPaths??[]));}
  if(b.sky&&!(origin&0x8000))merged.unshift(...skyGroups(b.sky));
  const scene:WorldScene={scenery,soundTerrain:decodeSoundTerrain(b),dungeonVisibility:b.dungeonBlocks?.map(block=>[block.index,...block.visibleBlocks]),flareTextures:origin&0x8000?undefined:b.sky?.flareTexturePublicPaths,starRandomState:b.sky?.starPrimitive?.nativeRand?.stateAfterConstruction,residency:frontend?"frontend":undefined,models,environment:b.sky?.environment,id:`region:${origin}`,originRegion:origin,groups:merged,warnings:[...new Set(warnings)]};const residentBytes=worldSceneBytes(scene),residentLimit=frontend?FRONTEND_SCENE_BYTES:Math.min(budget,WORLD_SCENE_BYTES);if(residentBytes>residentLimit)throw new Error(`World scene residency budget exceeded: ${residentBytes} bytes > ${residentLimit} bytes (${merged.length} groups, ${sectors.length} sectors)`);return scene;
 }
};}
