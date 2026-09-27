import type { CharacterModel } from '@/engine/contracts/character';
// ||M||2 <= sqrt(||transpose(M) M||infinity). Unlike the Frobenius
// bound, an identity/rotation does not spuriously enlarge every skeleton level
// by sqrt(3). Absolute Gram row sums also enclose shear and nonuniform scale.
function stretch(m:ArrayLike<number>):number{
    let maximum=0;
    for(let i=0;i<3;i++){let sum=0;for(let j=0;j<3;j++)sum+=Math.abs(m[i*4]!*m[j*4]!+m[i*4+1]!*m[j*4+1]!+m[i*4+2]!*m[j*4+2]!);maximum=Math.max(maximum,sum);}
    // Include headroom for float32 matrix/palette products, not just the
    // double-precision bound calculation (unit rotations are the tight case).
    return Math.sqrt(maximum)*(1+8*2**-23);
}
// Conservative envelope over every admitted clip, including cubic tangent bounds.
// Rotations preserve norms; parent scales and translations compose the envelope.
export function characterRadius(model: CharacterModel): number {
    const local = model.nodes.map(node => Math.hypot(...node.translation)), scale = model.nodes.map(node => Math.max(...node.scale.map(Math.abs)));
    for (const clip of model.clips)
        for (const channel of clip.channels)
            if (channel.path !== 'rotation') {
                let maximum = 0;
                for (const value of channel.values)
                    maximum = Math.max(maximum, Math.abs(value));
                if (channel.interpolation === 'CUBICSPLINE')
                    maximum *= 4 + 2 * clip.duration;
                if (channel.path === 'translation')
                    local[channel.node] = Math.max(local[channel.node]!, maximum * Math.sqrt(3));
                else
                    scale[channel.node] = Math.max(scale[channel.node]!, maximum);
            }
    const translation: number[] = [], globalScale: number[] = [], visiting = new Set<number>();
    function resolve(index: number) {
        if (translation[index] !== undefined)
            return;
        if (visiting.has(index))
            throw new Error('Cyclic character bounds');
        visiting.add(index);
        const node = model.nodes[index]!;
        if (node.matrix) {
            local[index] = Math.hypot(node.matrix[12]!, node.matrix[13]!, node.matrix[14]!);
            scale[index] = stretch(node.matrix);
        }
        if (node.parent >= 0) {
            resolve(node.parent);
            translation[index] = translation[node.parent]! + globalScale[node.parent]! * local[index]!;
            globalScale[index] = globalScale[node.parent]! * scale[index]!;
        }
        else {
            translation[index] = local[index]!;
            globalScale[index] = scale[index]!;
        }
        visiting.delete(index);
    }
    for (let n = 0; n < model.nodes.length; n++)
        resolve(n);
    let radius = Math.max(0, ...translation);
    for (const primitive of model.primitives) {
        const geometry=primitive.geometry;
        if(geometry.joints&&geometry.weights&&!primitive.emission){
            // Bind-space distance must be measured from each influencing joint,
            // not from the model origin plus the inverse-bind translation.
            // The latter counts a limb's offset twice and admits hidden rigs.
            const distances=new Float64Array(primitive.joints.length).fill(-1);
            for(let v=0;v<geometry.positions.length/3;v++){
                const x=geometry.positions[v*3]!,y=geometry.positions[v*3+1]!,z=geometry.positions[v*3+2]!;
                for(let influence=0;influence<4;influence++){
                    if(geometry.weights[v*4+influence]===0)continue;
                    const joint=geometry.joints[v*4+influence]!,offset=joint*16,m=primitive.inverseBind;
                    const a=m[offset]!*x+m[offset+4]!*y+m[offset+8]!*z+m[offset+12]!,b=m[offset+1]!*x+m[offset+5]!*y+m[offset+9]!*z+m[offset+13]!,c=m[offset+2]!*x+m[offset+6]!*y+m[offset+10]!*z+m[offset+14]!;
                    let magnitude=1;for(let row=0;row<3;row++)magnitude+=Math.abs(m[offset+row]!*x)+Math.abs(m[offset+4+row]!*y)+Math.abs(m[offset+8+row]!*z)+Math.abs(m[offset+12+row]!);
                    distances[joint]=Math.max(distances[joint]!,Math.hypot(a,b,c)+magnitude*16*2**-23);
                }
            }
            // Skin weights are admitted nonnegative and normalized. Every
            // output is in the convex hull of these all-clip joint envelopes.
            for(let i=0;i<distances.length;i++)if(distances[i]!>=0){const joint=primitive.joints[i]!;radius=Math.max(radius,translation[joint]!+globalScale[joint]!*distances[i]!);}
            continue;
        }
        let vertex = 0;
        const positions = primitive.geometry.positions;
        for (let i = 0; i < positions.length; i += 3)
            vertex = Math.max(vertex, Math.hypot(positions[i]!, positions[i + 1]!, positions[i + 2]!));
        for (let i = 0; i < primitive.joints.length; i++) {
            const joint = primitive.joints[i]!, m = primitive.inverseBind.subarray(i * 16, i * 16 + 16);
            radius = Math.max(radius, translation[joint]! + globalScale[joint]! * (stretch(m) * vertex + Math.hypot(m[12]!, m[13]!, m[14]!)));
        }
    }
    if (!Number.isFinite(radius))
        throw new Error('Invalid character bounds');
    // Include palette composition and normalized float32 weight roundoff.
    return radius*(1+16*2**-23)+16*2**-23;
}
