import type {Pose} from '@/engine/contracts/gameplay';

export interface SoundTerrain {
    readonly regionId: number;
    readonly types: Uint8Array;
}
interface TerrainSoundBundle {
    source: {sectorX: number; sectorY: number};
    navmesh?: {regions: {dx: number; dz: number; tileTextureIds?: string}[]};
    terrainTextures: {tileCatalog: {referencedTiles: {textureId: number; flags?: number}[]}};
}
const TILE_COUNT = 9216;

// 8F99A0 indexes this table with the terrain query's high word.
export function terrainSoundName(index: number): string | undefined {
    return ['DIRT', 'SAND', 'ASHFIELD', 'STONE', 'METAL', 'WOOD', 'MUD',
        'WATER', 'DEEPWATER', 'SNOW', 'GRASS', 'LONGGRASS', 'FOREST', 'CLOUD'][index];
}
export function decodeSoundTerrain(bundle: TerrainSoundBundle): readonly SoundTerrain[] {
    const flags = new Map<number, number>();
    for (const tile of bundle.terrainTextures.tileCatalog.referencedTiles) {
        if (tile.flags === undefined) continue;
        if (!Number.isInteger(tile.flags) || !terrainSoundName(tile.flags)) throw Error('Invalid terrain sound type');
        flags.set(tile.textureId, tile.flags);
    }
    const seen = new Set<number>();
    return (bundle.navmesh?.regions ?? []).filter(row => row.tileTextureIds !== undefined).map(row => {
        const x = bundle.source.sectorX + row.dx, z = bundle.source.sectorY + row.dz;
        if (![x, z].every(n => Number.isInteger(n) && n >= 0 && n <= 255)) throw Error('Invalid sound terrain region');
        const regionId = z * 256 + x;
        if (seen.has(regionId)) throw Error('Duplicate sound terrain region');
        seen.add(regionId);
        if (row.tileTextureIds!.length !== TILE_COUNT * 2 / 3 * 4) throw Error('Invalid terrain sound tiles');
        const bytes = Uint8Array.from(atob(row.tileTextureIds!), c => c.charCodeAt(0));
        if (bytes.length !== TILE_COUNT * 2) throw Error('Invalid terrain sound tiles');
        const view = new DataView(bytes.buffer), types = new Uint8Array(TILE_COUNT);
        for (let i = 0; i < types.length; i++) types[i] = flags.get(view.getUint16(i * 2, true)) ?? 0;
        return {regionId, types};
    });
}
export function sampleSoundTerrain(rows: readonly SoundTerrain[], pose: Pose): string | undefined {
    const row = rows.find(row => row.regionId === pose.regionId);
    const x = Math.floor(pose.x / 20), z = Math.floor(pose.z / 20);
    return row && x >= 0 && x < 96 && z >= 0 && z < 96 ? terrainSoundName(row.types[z * 96 + x]!) : undefined;
}
