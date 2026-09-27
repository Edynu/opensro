// BMS vertex byte -> CMapLoader's 256-entry table (43EC10/43EC80).
// The native angle step is an authored double, not 2*Math.PI/256.
export function vertexDirection(index:number):readonly [number,number]{
 const angle=Math.fround(index*0.024543600156903267);
 return [Math.fround(Math.cos(angle)),-Math.fround(Math.sin(angle))];
}

// 4287A8..4288A6: nearest endpoint (ties select endpoint 1), then bias
// ORIGINAL source by its decoded normal. This branch does not use the hit
// as the destination and does not acquire an object cell.
export function outsideEdgeStart(source:readonly number[],hit:readonly number[],a:readonly number[],b:readonly number[],directionA:number,directionB:number):readonly [number,number]{
 const f=Math.fround;
 const distance=(v:readonly number[])=>{const x=f(v[0]!-hit[0]!),z=f(v[1]!-hit[1]!);return f(x*x+z*z);};
 const n=vertexDirection(distance(a)<distance(b)?directionA:directionB),scale=0.009999999776482582;
 return [f(f(source[0]!)+f(n[0]*scale)),f(f(source[1]!)+f(n[1]*scale))];
}
