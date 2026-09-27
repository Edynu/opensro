import {crtRandomRange} from '../math/crt-random';
type Vector = [number,number,number];
export interface ProjectileCurve {
    position:Vector;
    velocity:Vector;
    destination:Vector;
    phase:0|1|2|3;
    elapsedMs:number;
    readonly pauseMs:number;
    readonly acceleration:number;
}
function f(n:number):number {return Math.fround(n);}
function length(v:Vector):number {return f(Math.sqrt(f(v[1]*v[1]+v[0]*v[0]+v[2]*v[2])));}
function scale(v:Vector,s:number):Vector {return [f(v[0]*s),f(v[1]*s),f(v[2]*s)];}
function add(a:Vector,b:Vector):Vector {return [f(a[0]+b[0]),f(a[1]+b[1]),f(a[2]+b[2])];}
function dot(a:Vector,b:Vector):number {return f(a[1]*b[1]+a[0]*b[0]+a[2]*b[2]);}
function normalize(v:Vector):Vector {const n=length(v);return scale(v,n>0?f(1/n):0);}
// 8d8e30 -> 876bb0. Five CRT draws precede the ordinary speed draw.
// The second horizontal component deliberately uses the already-stored X.
// This is a stateful velocity integrator, not a spline interpolation.
export function createProjectileCurve(start:Vector,end:Vector,state:number):{curve:ProjectileCurve;state:number} {
    if([...start,...end].some(n=>!Number.isFinite(n)))throw Error('Invalid curve endpoint');
    const random=(limit:number)=>{const next=crtRandomRange(state,0,limit);state=next.state;return next.value;};
    const angle=f(f(random(120)-60)*0.01745329238474369),sin=f(Math.sin(angle)),cos=f(Math.cos(angle));
    let x=f(start[0]-end[0]),z=f(start[2]-end[2]);
    x=f(z*sin+x*cos);z=f(-sin*x+cos*z);
    let direction=normalize([x,0,z]);
    direction[1]=f(random(400)/1000+0.10000000149011612);
    direction=normalize(direction);
    const velocity=scale(direction,f(random(25)+50));
    const pauseMs=random(800),acceleration=f(random(400)/1000+0.8999999761581421);
    return {state,curve:{position:start.map(f) as Vector,destination:end.map(f) as Vector,velocity,phase:1,elapsedMs:0,pauseMs,acceleration}};
}
// 876d60 consumes an integer frame delta. The terminal update returns true;
// the following update returns false, allowing one final endpoint render.
// State is supplied by the effects owner; no clock or population lives here.
export function advanceProjectileCurve(curve:ProjectileCurve,deltaMs:number):boolean {
    if(!Number.isInteger(deltaMs)||deltaMs<0||deltaMs>0xffffffff)throw Error('Invalid curve delta');
    if(curve.phase===0)return false;
    if(deltaMs===0)return true;
    curve.elapsedMs=(curve.elapsedMs+deltaMs)>>>0;
    const difference:Vector=[f(curve.destination[0]-curve.position[0]),f(curve.destination[1]-curve.position[1]),f(curve.destination[2]-curve.position[2])];
    const distance=length(difference);
    if(distance===0){curve.phase=0;return false;}
    // The native target direction divides each component by distance; its
    // vector-normalize helper instead stores a reciprocal before multiplying.
    const direction=difference.map(n=>f(n/distance)) as Vector;
    const forced=curve.elapsedMs>curve.pauseMs+2200;
    if(forced){curve.velocity=scale(direction,length(curve.velocity));curve.phase=3;}
    if(curve.elapsedMs>curve.pauseMs+3500){curve.position=[...curve.destination];curve.phase=0;return true;}
    const dt=f(deltaMs/1000);
    if(curve.phase===1){if(curve.elapsedMs>=curve.pauseMs)curve.phase=2;return true;}
    if(curve.phase===2){
        if(curve.acceleration*0.5<dot(normalize(curve.velocity),direction))curve.phase=3;
        curve.velocity=add(curve.velocity,scale(direction,f(curve.acceleration*78.4000015258789*dt)));
        curve.position=add(curve.position,scale(curve.velocity,dt));
        return true;
    }
    curve.velocity=add(curve.velocity,scale(direction,f(curve.acceleration*392*dt)));
    const speed=length(curve.velocity);
    const velocityDirection=curve.velocity.map(n=>f(n/speed)) as Vector;
    let heading=normalize(add(scale(velocityDirection,0.5),scale(direction,0.5)));
    if(forced||dot(heading,direction)>0.9300000071525574){
        if(!forced)heading=direction;
        if(speed*dt>=distance){curve.position=[...curve.destination];curve.phase=0;return true;}
    }
    curve.velocity=scale(heading,speed);
    curve.position=add(curve.position,scale(curve.velocity,dt));
    return true;
}
