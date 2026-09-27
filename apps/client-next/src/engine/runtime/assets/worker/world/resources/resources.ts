import type {Bundle} from '../internal/resource-contract';

type Region = Bundle & {sharedRenderResourcesPublicPath?:string;objects:Bundle['objects'] & {resourceIndexPublicPath?:string}};
type ResourceIndex = Omit<Bundle['objects']['resources'],'meshes'> & {meshFiles:{sourcePath:string;publicPath:string}[]};
export function createWorldResources(){return {
 async resolve(bytes:Uint8Array,read:(path:string)=>Promise<Uint8Array>):Promise<Bundle>{
  const parse=<T>(bytes:Uint8Array)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as T;
  const center=parse<Region>(bytes);
  if(center.objects?.resources)return center;
  if(!center.objects?.resourceIndexPublicPath||!center.sharedRenderResourcesPublicPath)throw new Error('World resource references are missing');
  const catalog=parse<{regionsById:Record<string,{area:string;bundlePublicPath:string}[]>}>(await read('/assets/world/world-region-catalog.json'));
  const regions:Region[]=[center];
  for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)if(dx||dz){
   const x=center.source.sectorX+dx,z=center.source.sectorY+dz;
   if(x<0||x>255||z<0||z>255)continue;
   const path=catalog.regionsById[`0x${(x|(z<<8)).toString(16).padStart(4,'0')}`]?.find(row=>row.area==='outdoor')?.bundlePublicPath;
   if(path)regions.push(parse<Region>(await read(path)));
  }
  const index=parse<ResourceIndex>(await read(center.objects.resourceIndexPublicPath));
  const shared=parse<Pick<Bundle,'sky'|'water'>>(await read(center.sharedRenderResourcesPublicPath));
  const placements=regions.flatMap(region=>region.objects.placements),ids=new Set(placements.map(p=>p.objectId));
  const bsr=index.bsr.filter(row=>ids.has(row.objectId));
  const materialPaths=new Set(bsr.flatMap(row=>row.materialPaths.map(path=>path.toLowerCase())));
  const paths=new Set(bsr.flatMap(row=>(row.renderMeshSection?.paths??row.meshPaths).map(path=>path.toLowerCase())));
  const files=index.meshFiles.filter(row=>paths.has(row.sourcePath.toLowerCase()));
  const meshes:Bundle['objects']['resources']['meshes']=[];
  let next=0;
  await Promise.all(Array.from({length:Math.min(3,files.length)},async()=>{
   while(next<files.length){const file=files[next++]!;meshes.push(parse<{mesh:Bundle['objects']['resources']['meshes'][number]}>(await read(file.publicPath)).mesh);}
  }));
  meshes.sort((a,b)=>a.sourcePath.localeCompare(b.sourcePath));
  const tiles=new Map(regions.flatMap(region=>region.terrainTextures.tileCatalog.referencedTiles).map(tile=>[tile.textureId,tile]));
  return {...center,...shared,terrain:{...center.terrain,sectors:regions.map(region=>({...region.source,blocks:region.terrain.blocks,lightmapPublicPath:region.terrainTextures.lightmapPublicPath}))},
   terrainTextures:{...center.terrainTextures,tileCatalog:{referencedTiles:[...tiles.values()]}},
   objects:{...center.objects,placements,resources:{bsr,meshes,materialSets:index.materialSets.filter(row=>materialPaths.has(row.sourcePath.toLowerCase()))}}};
 }
};}
