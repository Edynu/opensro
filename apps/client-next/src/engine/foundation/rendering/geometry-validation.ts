// Admission still inspects every element. IEEE-754 float32 is finite exactly
// when its exponent is not all ones. Inspecting the stored bits avoids widening
// every scalar to a JS number and calling Number.isFinite on large cold arrays.
export function finiteGeometryValues(values: Float32Array): boolean {
    const bits = new Uint32Array(values.buffer, values.byteOffset, values.length);
    for (let i = 0; i < bits.length; i++)
        if ((bits[i]! & 0x7f800000) === 0x7f800000) return false;
    return true;
}

export function geometryIndicesInRange(values: Uint32Array, limit: number): boolean {
    for (let i = 0; i < values.length; i++)
        if (values[i]! >= limit) return false;
    return true;
}
