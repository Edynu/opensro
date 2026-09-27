export const DECODED_IMAGE_BYTES = 67108864;
export function imageBytes(width: number, height: number): number {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096)
        throw new Error('Image exceeds decoded image budget');
    return width * height * 4;
}
export function pngBytes(bytes: Uint8Array): number {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 24 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452)
        throw new Error('Invalid PNG header');
    return imageBytes(view.getUint32(16), view.getUint32(20));
}
