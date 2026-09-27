// Stateless stream operation. The caller owns cancellation and the returned bytes.
export async function readBytes(stream: ReadableStream<Uint8Array>, limit: number, received?:(bytes:number)=>void): Promise<Uint8Array<ArrayBuffer>> {
    if (!Number.isSafeInteger(limit) || limit < 1)
        throw new Error("Invalid byte limit");
    const reader = stream.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const part = await reader.read();
            if (part.done)
                break;
            size += part.value.byteLength;
            if (size > limit)
                throw new Error("Response exceeds byte limit");
            chunks.push(part.value);
            received?.(part.value.byteLength);
        }
    }
    catch (error) {
        await reader.cancel().catch(() => { });
        throw error;
    }
    finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    return bytes;
}
