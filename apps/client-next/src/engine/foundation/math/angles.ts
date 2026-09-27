// Wire Position.Heading is a full-circle uint16, divided by 65535.
export type Radians = number & { readonly radians: unique symbol };
export function headingRadians(heading: number): Radians {
    if (!Number.isInteger(heading) || heading < 0 || heading > 65535)
        throw new Error('Invalid native heading');
    return (heading / 65535 * 2 * Math.PI) as Radians;
}
export function radians(value: number): Radians {
    if (!Number.isFinite(value)) throw new Error('Invalid radians');
    return value as Radians;
}
// Native UI previews and the published character resource use opposite forward
// axes. Keep this conversion shared by creation and the mini-info portrait.
export function previewYaw(value:number):Radians{return radians(Math.PI-value);}
// 852F80 decodes the wire word, then 8535A0 adds pi/2 before
// 8536C0 applies model yaw. Preview inputs already are model yaw.
export function nativeHeadingYaw(heading:number):Radians{return radians((headingRadians(heading)+Math.PI/2)%(2*Math.PI));}
export function characterHeadingYaw(heading:number):Radians{return previewYaw(nativeHeadingYaw(heading));}
