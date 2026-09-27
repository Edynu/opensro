// b153a0 selects the camera basis for ViewBillboard and preserves the element
// position. The admitted plate lane has translation/scale only. Convert that
// basis back through its instance so the shared skinning draw applies it once.
export function faceEffectMesh(palette:Float32Array,offset:number,instance:Float32Array,view:Float32Array,mode:'camera'|'y'|'v'='camera'):void {
    const a=[instance[0]!,instance[1]!,instance[2]!],b=[instance[4]!,instance[5]!,instance[6]!],c=[instance[8]!,instance[9]!,instance[10]!];
    const cross=(u:number[],v:number[])=>[u[1]!*v[2]!-u[2]!*v[1]!,u[2]!*v[0]!-u[0]!*v[2]!,u[0]!*v[1]!-u[1]!*v[0]!];
    const dot=(u:number[],v:number[])=>u[0]!*v[0]!+u[1]!*v[1]!+u[2]!*v[2]!;
    const rows=[cross(b,c),cross(c,a),cross(a,b)],det=dot(a,rows[0]!);
    if(Math.abs(det)<1e-12)return; // A zero-sized actor is already invisible.
    let axes:number[][];
    if(mode==='y'){
        const fwdX=view[3]!,fwdZ=view[11]!,fwdLen=Math.hypot(fwdX,fwdZ);
        if(fwdLen<1e-12){
            const cam=[[view[0]!,view[4]!,view[8]!],[view[1]!,view[5]!,view[9]!],[view[3]!,view[7]!,view[11]!]];
            axes=cam.every(a=>Math.hypot(...a)>1e-12)?cam:[[1,0,0],[0,1,0],[0,0,1]];
        }else{
            const fwd=[fwdX/fwdLen,0,fwdZ/fwdLen],up=[0,1,0],right=[fwd[2]!,0,-fwd[0]!];axes=[right,up,fwd];
        }
    }else if(mode==='v'){
        const camUp=[view[1]!,view[5]!,view[9]!],upLen=Math.hypot(...camUp);
        const normUp=upLen>1e-12?[camUp[0]!/upLen,camUp[1]!/upLen,camUp[2]!/upLen]:[0,1,0];
        const camFwd=[view[3]!,view[7]!,view[11]!],fwdLen=Math.hypot(...camFwd);
        const normFwd=fwdLen>1e-12?[camFwd[0]!/fwdLen,camFwd[1]!/fwdLen,camFwd[2]!/fwdLen]:[0,0,1];
        const right=[normUp[1]!*normFwd[2]!-normUp[2]!*normFwd[1]!,normUp[2]!*normFwd[0]!-normUp[0]!*normFwd[2]!,normUp[0]!*normFwd[1]!-normUp[1]!*normFwd[0]!];
        axes=[right,normUp,normFwd];
    }else{
        axes=[[view[0]!,view[4]!,view[8]!],[view[1]!,view[5]!,view[9]!],[view[3]!,view[7]!,view[11]!]];
    }
    const col0=[palette[offset]!,palette[offset+1]!,palette[offset+2]!];
    const col1=[palette[offset+4]!,palette[offset+5]!,palette[offset+6]!];
    const col2=[palette[offset+8]!,palette[offset+9]!,palette[offset+10]!];
    const s0=col0[1]===0&&col0[2]===0?col0[0]!:Math.hypot(...col0);
    const s1=col1[0]===0&&col1[2]===0?col1[1]!:Math.hypot(...col1);
    const s2=col2[0]===0&&col2[1]===0?col2[2]!:Math.hypot(...col2);
    const scale=[Math.hypot(...a)*s0,Math.hypot(...b)*s1,Math.hypot(...c)*s2];
    for(let col=0;col<3;col++){
        const axis=axes[col]!,length=Math.hypot(...axis);
        if(!Number.isFinite(length)||length<1e-12)throw new Error('Invalid effect camera basis');
        for(let row=0;row<3;row++)palette[offset+col*4+row]=dot(rows[row]!,axis)/det/length*scale[col]!;
    }
}
export function faceEffectPlate(palette:Float32Array,offset:number,instance:Float32Array,view:Float32Array,mode:'camera'|'y'|'v'='camera'):void {
    faceEffectMesh(palette,offset,instance,view,mode);
}
