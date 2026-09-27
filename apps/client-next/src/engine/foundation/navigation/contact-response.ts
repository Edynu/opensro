// Original 45c1b0 / 40efd0, 428930 and 453fa0. Explicit f32 stores are
// observable at contacts; tests/fixtures/native/native-contact-reference.json
// pins the resulting values.
function f(n: number) { return Math.fround(n); }
type Point2 = readonly [number, number];
type Point3 = readonly [number, number, number];
export function cellEntry(center: Point2, hit: Point2): [number, number] {
    let x = f(f(center[0]) - f(hit[0])), z = f(f(center[1]) - f(hit[1]));
    const length = f(Math.sqrt(f(x * x + z * z)));
    const limit = 0.19999998807907104;
    if (length > limit) {
        const inverse = f(1 / length);
        x = f(f(x * inverse) * limit);
        z = f(f(z * inverse) * limit);
    }
    return [f(f(hit[0]) + x), f(f(hit[1]) + z)];
}
export function edgeResponse(center: Point2, hit: Point2, requested: Point2, flags: number, blockThrough: boolean, budget: number) {
    if (flags & 4) throw new Error('Outline response requires an outline edge');
    if (budget === 0) return { point: [...requested] as [number, number], status: 0x20, cell: 'original' as const, remainingBudget: 0 };
    const inside = cellEntry(center, hit), portal = flags & 8 ? 2 : 0;
    if (blockThrough && (flags & 0x12))
        return { point: inside, status: portal | 1, cell: 'original' as const, remainingBudget: budget - 1 };
    return { point: [f(2 * f(hit[0]) - inside[0]), f(2 * f(hit[1]) - inside[1])] as [number, number], status: portal | 0x10, cell: 'none' as const, remainingBudget: budget - 1 };
}
function normalize(v: Point3): [number, number, number] {
    const length = f(Math.sqrt(f(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])));
    const inverse = length > 0 ? f(1 / length) : 0;
    return [f(v[0] * inverse), f(v[1] * inverse), f(v[2] * inverse)];
}
export function slideNormal(a: Point3, b: Point3, originalStart: Point3, requested: Point3): [number, number, number] {
    const edge = normalize([f(b[0] - a[0]), f(b[1] - a[1]), f(b[2] - a[2])]);
    const remaining = normalize([f(requested[0] - originalStart[0]), f(requested[1] - originalStart[1]), f(requested[2] - originalStart[2])]);
    const sign = remaining[0] * edge[0] + remaining[1] * edge[1] + remaining[2] * edge[2] < 0 ? -1 : 1;
    // 410910: edge cross signed-up; no extra normalization or movement.
    return [f(-edge[2] * sign), 0, f(edge[0] * sign)];
}
