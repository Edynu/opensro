import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {buildTitleSectorObjectResources} from '../objects/buildTitleSectorObjectResources.mjs';
import {resolveWaterTextures,copyReferencedWaterImages} from './copyWaterImages.mjs';
import {extractedRoot,gameRoot,publicRoot,normalizeAssetPath} from '../paths.mjs';
import {publishBytesAtomically} from '../../shared/atomicPublish.mjs';

// The native dungeoninfo entries remain the admission authority. Discovering
// another DOF on disk must not silently add it to the playable world catalog.
export async function buildDungeonWorlds(manifest){
 if(manifest.format!=='sro-dungeon-resources'||manifest.version!==3)throw Error('Invalid dungeon publication');
 const water=resolveWaterTextures(),files=[],textures=new Set();
 await copyReferencedWaterImages(water);
 for(const frame of water.normalFramePublicPaths)textures.add(frame);
 const built=new Map();
 for(const entry of manifest.entries){
  const resource=manifest.resources.find(row=>normalizeAssetPath(row.normalizedName)===normalizeAssetPath(entry.normalizedName));
  if(!resource?.presentation||!resource.waterSurfaces)throw Error('Rebuild dungeon provider publication first');
  let objects=built.get(resource.normalizedName);
  const blocks=resource.presentation.blocks;
  if(!objects){
   const definitions=blocks.map(block=>({objectId:block.index,flags:0,sourcePath:block.path}));
   objects=await buildTitleSectorObjectResources({extractedRoot,gameRoot,area:'dungeon',objectDefinitions:definitions});
   if(objects.missingCount)throw Error('Incomplete dungeon render resources: '+JSON.stringify(objects.missing));
   built.set(resource.normalizedName,objects);
   for(const image of objects.textures)textures.add(image.imagePublicPath);
  }
  const region=entry.sectorId;
  const bundle={source:{sectorX:region&255,sectorY:region>>>8},terrain:{blocks:[]},terrainTextures:{tileCatalog:{referencedTiles:[]}},water,
   dungeonBlocks:blocks.map(({index,visibleBlocks,fog})=>({index,visibleBlocks,fog})),dungeonWater:resource.waterSurfaces,
   objects:{resources:objects,placements:blocks.map(block=>({dungeonBlock:block.index,objectId:block.index,uid:block.index,regionId:String(region),position:{x:block.position[0],y:block.position[1],z:block.position[2]},yaw:block.yaw}))}};
  const file=path.join(publicRoot,`assets/world/dungeon/regions/0x${region.toString(16).padStart(4,'0')}.json`);
  await mkdir(path.dirname(file),{recursive:true});
  await publishBytesAtomically(file,Buffer.from(JSON.stringify(bundle)));files.push(file);
 }
 return {files,textures:[...textures]};
}
