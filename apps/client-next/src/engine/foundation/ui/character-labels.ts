import type {UiScene} from '@/engine/contracts/ui';
// UI owns native glyph extents; renderer owns current-frame model/camera anchors.
// Missing models and retired actors remove the entire anchored product.
export function projectCharacterLabels(scene:UiScene,anchors:ReadonlyMap<number,readonly[number,number,number]>,world?:{origin:number;matrix:Float32Array}):UiScene{
 return {...scene,quads:scene.quads.flatMap(q=>{
  if(q.worldAnchor){
   if(!world)return [];
   const a=q.worldAnchor,m=world.matrix,x=a.x+((a.regionId&255)-(world.origin&255))*1920,y=a.y,z=a.z+((a.regionId>>>8)-(world.origin>>>8))*1920;
   const w=m[3]!*x+m[7]!*y+m[11]!*z+m[15]!;if(w<=0)return [];
   const px=(1+(m[0]!*x+m[4]!*y+m[8]!*z+m[12]!)/w)*scene.width/2,py=(1-(m[1]!*x+m[5]!*y+m[9]!*z+m[13]!)/w)*scene.height/2;
   const depth=(m[2]!*x+m[6]!*y+m[10]!*z+m[14]!)/w;if(depth<0||depth>1)return [];
   const {worldAnchor,...quad}=q;
   return [{...quad,depth,rect:[px+q.rect[0],py+q.rect[1],q.rect[2],q.rect[3]] as const}];
  }
  if(q.characterAnchor===undefined)return [q];
  const anchor=anchors.get(q.characterAnchor);if(!anchor)return [];
  const {characterAnchor,...quad}=q;
  return [{...quad,depth:anchor[2],rect:[Math.trunc(anchor[0])+q.rect[0],Math.trunc(anchor[1])+q.rect[1],q.rect[2],q.rect[3]] as const}];
 })};
}
