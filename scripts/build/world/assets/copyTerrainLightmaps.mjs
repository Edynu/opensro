import { writePublicFile } from "../io.mjs";

export function terrainLightmapPublicPath(area, sectorX, sectorY) {
  return `/assets/world/${area}/terrain-lightmaps/${sectorY}-${sectorX}.dds`;
}

export async function copyTerrainLightmap(publicPath, bytes) {
  await writePublicFile(publicPath, bytes);
}
