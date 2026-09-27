import type {PickAlpha} from '@/engine/foundation/rendering/picking';
// Invoked by the image owner on demand; the owner retains/releases the mask.
export function readPickAlpha(image:ImageBitmap):PickAlpha{
 const canvas=new OffscreenCanvas(image.width,image.height),context=canvas.getContext('2d',{willReadFrequently:true});
 if(!context)throw new Error('Picking alpha readback unavailable');
 context.drawImage(image,0,0);const rgba=context.getImageData(0,0,image.width,image.height).data;
 const pixels=new Uint8Array(image.width*image.height);for(let i=0;i<pixels.length;i++)pixels[i]=rgba[i*4+3]!;
 return {width:image.width,height:image.height,pixels};
}
