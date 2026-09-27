/** World-owned decal, sampled from an actual animated toe socket. */
export interface Footprint {
 readonly id:number;
 readonly pose:{readonly regionId:number;readonly x:number;readonly y:number;readonly z:number};
 readonly yaw:number;readonly right:boolean;readonly surface:'SAND'|'SNOW';readonly started:number;
}
