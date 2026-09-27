import { BinaryReader } from '../../shared/jmxBinaryReader.mjs';
import { normalizeAssetPath } from '../paths.mjs';

export const CPD_SIGNATURE = 'JMXVCPD 0101';

// Retail CResObj compound loader 0xa9b280, vtable 0xc3a4cc + 0x12c:
// seek header[0x0c], read a string; seek header[0x10], read i32 count,
// then counted BSR paths in order. There are no child transforms in this list.
export function parseCompound(buffer, sourcePath = '<compound>') {
  const r = new BinaryReader(buffer, sourcePath);
  if (r.text(12) !== CPD_SIGNATURE) throw new Error(`${sourcePath}: unsupported compound signature`);
  const nameOffset = r.u32(), branchOffset = r.u32();
  r.ensure(20, 'compound header');
  if (nameOffset < 40 || branchOffset < nameOffset + 4) throw new Error(`${sourcePath}: invalid compound offsets`);
  r.seek(nameOffset);
  const string = () => {
    const length = r.u32();
    if (length > 4096) throw new Error(`${sourcePath}: compound string budget exceeded`);
    return r.text(length);
  };
  const name = string();
  r.seek(branchOffset);
  const count = r.u32();
  if (count > 512) throw new Error(`${sourcePath}: compound branch budget exceeded`);
  const branches = [];
  for (let i = 0; i < count; i++) {
    const raw = string();
    // Native branches resolve BSR resources, not recursive CPD graphs.
    if (!/^res[\\/]/i.test(raw) || !/\.bsr$/i.test(raw) || /[:\x00-\x1f]/.test(raw) || raw.split(/[\\/]/).some(part => !part || part === '.' || part === '..'))
      throw new Error(`${sourcePath}: invalid compound branch path`);
    branches.push(normalizeAssetPath(raw));
  }
  if (r.offset !== buffer.length) throw new Error(`${sourcePath}: unsupported compound trailing section`);
  return { signature: CPD_SIGNATURE, byteLength: buffer.length, name, branches };
}
