import type {UiScene} from '@/engine/contracts/ui';

// Preloading is CPU/cache readiness, not GPU residency. Derive GPU demand
// from the committed draw product (including masks), never all known assets.
// Renderer owns uploads/releases and clears its resident set on device loss.
export function uiTextureResidency(scene:UiScene|null,available:ReadonlySet<string>,resident:ReadonlySet<string>,dirty:ReadonlySet<string>){
 const needed=new Set<string>();
 for(const quad of scene?.quads??[])for(const id of [quad.texture,quad.mask?.texture])if(id&&available.has(id))needed.add(id);
 return {release:[...resident].filter(id=>!needed.has(id)),upload:[...needed].filter(id=>!resident.has(id)||dirty.has(id)),needed};
}
