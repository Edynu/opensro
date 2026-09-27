import type {Geometry} from '@/engine/contracts/geometry';

// Geometry has already passed admission. Do not allocate five typed-array views
// per vertex while constructing the retained GPU vertex stream.
export function packGeometryVertices(data: Geometry): Float32Array {
    const {positions, normals, uvs, colors, maskUVs} = data;
    const count = positions.length / 3, packed = new Float32Array(count * 14);
    for (let i = 0; i < count; i++) {
        const out = i * 14, p = i * 3, uv = i * 2, color = i * 4;
        packed[out] = positions[p]!;
        packed[out + 1] = positions[p + 1]!;
        packed[out + 2] = positions[p + 2]!;
        packed[out + 3] = normals ? normals[p]! : 0;
        packed[out + 4] = normals ? normals[p + 1]! : 1;
        packed[out + 5] = normals ? normals[p + 2]! : 0;
        packed[out + 6] = uvs ? uvs[uv]! : 0;
        packed[out + 7] = uvs ? uvs[uv + 1]! : 0;
        packed[out + 8] = colors ? colors[color]! : 1;
        packed[out + 9] = colors ? colors[color + 1]! : 1;
        packed[out + 10] = colors ? colors[color + 2]! : 1;
        packed[out + 11] = colors ? colors[color + 3]! : 1;
        packed[out + 12] = maskUVs ? maskUVs[uv]! : 0;
        packed[out + 13] = maskUVs ? maskUVs[uv + 1]! : 0;
    }
    return packed;
}
