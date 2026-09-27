import * as zlib from "node:zlib";

export const DEFAULT_BROTLI_QUALITY = 11;
export const DEFAULT_GZIP_LEVEL = 9;
export const DEFAULT_ZSTD_LEVEL = 19;
// 8 MiB: RFC 9659 maximum for HTTP Content-Encoding: zstd.
export const DEFAULT_ZSTD_WINDOW_LOG = 23;
export const PRECOMPRESSED_ASSET_SUFFIXES = [".br", ".gz", ".zst"];

export function compressionAvailable(encoding) {
  if (encoding === "br") return typeof zlib.brotliCompressSync === "function";
  if (encoding === "gzip") return typeof zlib.gzipSync === "function";
  if (encoding === "zstd") return typeof zlib.zstdCompressSync === "function";
  return false;
}

export function compressBrotliSync(bytes, { quality = DEFAULT_BROTLI_QUALITY } = {}) {
  return zlib.brotliCompressSync(bytes, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: quality,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength
    }
  });
}

export function compressGzipSync(bytes, { level = DEFAULT_GZIP_LEVEL } = {}) {
  return zlib.gzipSync(bytes, { level });
}

export function compressZstdSync(
  bytes,
  { level = DEFAULT_ZSTD_LEVEL, windowLog = DEFAULT_ZSTD_WINDOW_LOG } = {}
) {
  if (typeof zlib.zstdCompressSync !== "function") {
    throw new Error("Zstandard compression requires Node.js zlib Zstandard support.");
  }
  return zlib.zstdCompressSync(bytes, {
    params: {
      [zlib.constants.ZSTD_c_compressionLevel]: level,
      [zlib.constants.ZSTD_c_windowLog]: windowLog
    }
  });
}

export function compressZstd(
  bytes,
  { level = DEFAULT_ZSTD_LEVEL, windowLog = DEFAULT_ZSTD_WINDOW_LOG } = {}
) {
  if (typeof zlib.zstdCompress !== "function") {
    return Promise.reject(new Error("Zstandard compression requires Node.js zlib Zstandard support."));
  }
  return new Promise((resolve, reject) => {
    zlib.zstdCompress(
      bytes,
      {
        params: {
          [zlib.constants.ZSTD_c_compressionLevel]: level,
          [zlib.constants.ZSTD_c_windowLog]: windowLog
        }
      },
      (error, compressed) => (error ? reject(error) : resolve(compressed))
    );
  });
}
