// CRTDunBlock::AD5730 -> ACFBE0/ACFBF0 -> SWorld::8AE2D0.
// The resource's face order, not its bounding rectangle, determines the fan.
export function dungeonWaterVertices(mesh, position) {
  if (mesh.positions.length !== 12 || mesh.indices.length !== 6 ||
      !mesh.positions.every(Number.isFinite) || position.length !== 3 ||
      !position.every(Number.isFinite) ||
      mesh.indices.some(i => !Number.isInteger(i) || i < 0 || i >= 4)) {
    throw new Error('Dungeon water requires four vertices and two triangles');
  }
  const first = mesh.indices.slice(0, 3), second = mesh.indices.slice(3);
  if (new Set(first).size !== 3 || new Set(second).size !== 3) {
    throw new Error('Dungeon water has a degenerate face');
  }
  const firstOnly = first.filter(i => !second.includes(i));
  const secondOnly = second.filter(i => !first.includes(i));
  if (firstOnly.length !== 1 || secondOnly.length !== 1) {
    throw new Error('Dungeon water triangles must share exactly one edge');
  }
  const order = [];
  for (const i of first) if (i !== firstOnly[0]) {
    order.push(i);
    if (order.length === 1) order.push(firstOnly[0]);
  }
  order.push(secondOnly[0]);
  // AD5730 adds the authored object translation to source vertices. It does
  // not use the scale/rotation matrix installed for that object's normal draw.
  return order.flatMap(i => position.map((v, axis) => Math.fround(v + mesh.positions[i * 3 + axis])));
}

export async function resolveDungeonWater(presentation, readResource, readMesh) {
  const surfaces = [];
  for (const block of presentation.blocks) {
    const vertices = [];
    let tint = 0;
    const sources = [];
    for (const object of block.waterObjects) {
      tint = object.color >>> 0;
      const resource = await readResource(object.path);
      // The supplied water resources have one mesh. Multiple material batches
      // require the native resource-map traversal order before admission.
      const paths = resource.renderMeshSection?.paths ?? resource.meshPaths;
      if (paths?.length !== 1) throw new Error('Dungeon water requires a single verified render mesh: ' + object.path);
      for (const path of paths) {
        const mesh = await readMesh(path);
        vertices.push(...dungeonWaterVertices(mesh, object.position));
        sources.push({objectIndex: object.index, resourcePath: object.path, meshPath: path});
      }
    }
    if (vertices.length) {
      // 8AE2D0 reads the first four entries, while AD5730 retains the last tint.
      // Preserve the complete provider vector as evidence of that distinction.
      surfaces.push({blockIndex:block.index, vertices, color:((tint & 0xffffff) | 0xb4000000) >>> 0, fog:{...block.fog}, sources});
    }
  }
  return surfaces;
}
