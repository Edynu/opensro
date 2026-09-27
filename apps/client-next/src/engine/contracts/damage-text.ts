import type {Pose} from './gameplay';
export interface DamageText {
 readonly anchor:Omit<Pose,'angle'>;
 readonly started:number;
 readonly targetGid:number;
 readonly rise?:{readonly at:number;readonly from:number;readonly to:number};
 readonly kind:0|1|2|3;
 readonly damage:number;
 readonly color:readonly [number,number,number];
}
