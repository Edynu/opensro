"""Read-only v1.150 PK2 directory and extracted-EFP verification.

No basename guessing: complete chained directory walk, range/cycle/duplicate
guards, archive and entry hashes, and byte comparison with every extracted EFP.
Requires pycryptodome; never executes the original client or modifies its PK2.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path
from Crypto.Cipher import Blowfish

ROOT = Path(__file__).resolve().parents[2]

def digest(data):
    return hashlib.sha256(data).hexdigest()

def inventory(data):
    if not data.startswith(b'JoyMax File Manager!\n'):
        raise ValueError('Invalid PK2 signature')
    cipher = Blowfish.new(bytes.fromhex('32cedd7cbca8'), Blowfish.MODE_ECB)
    def swap(value):
        return b''.join(value[i:i+4][::-1] for i in range(0, len(value), 4))
    seen, files, blocks = set(), {}, []
    def walk(offset, prefix):
        while offset:
            if offset in seen or not 256 <= offset <= len(data)-2560:
                raise ValueError(f'Invalid or cyclic directory block {offset}')
            seen.add(offset)
            raw = data[offset:offset+2560]
            block = swap(cipher.decrypt(swap(raw)))
            blocks.append({'offset': offset, 'sha256': digest(raw)})
            following = 0
            for i in range(20):
                row = block[i*128:(i+1)*128]
                kind = row[0]
                # Latin-1 preserves all filename bytes, including Korean names.
                name = row[1:82].split(b'\0')[0].decode('latin1')
                start, size, chain = struct.unpack_from('<QIQ', row, 106)
                if kind not in (0, 1, 2):
                    raise ValueError(f'Invalid entry type {kind}')
                if i == 19:
                    following = chain
                if not kind or name in ('.', '..'):
                    continue
                if not name or '/' in name or '\\' in name:
                    raise ValueError('Invalid archive filename')
                key = (prefix+name).lower()
                if kind == 1:
                    walk(start, key+'/')
                else:
                    if start+size > len(data) or key in files:
                        raise ValueError('Invalid or duplicate archive file '+key)
                    files[key] = {'offset': start, 'size': size, 'sha256': digest(data[start:start+size])}
            offset = following
    walk(256, '')
    return files, blocks

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    archive = ROOT.parent/'Particles.pk2'
    data = archive.read_bytes()
    files, blocks = inventory(data)
    extracted = ROOT.parent/'extracted/Particles_extracted'
    mismatches = []
    for name, row in files.items():
        if not name.endswith('.efp'):
            continue
        target = extracted/name
        if not target.exists() or digest(target.read_bytes()) != row['sha256']:
            mismatches.append(name)
    if mismatches:
        raise ValueError('Extraction differs from archive: '+repr(mismatches))
    programs = json.loads((ROOT/'.generated/client-public/assets/effects/programs.json').read_text())
    referenced = {r['effectPath'] for r in programs['reachability']['entityParticleReferences']}
    absent = sorted(name for name in referenced if name not in files)
    certificate = {'format': 'sro-particle-archive-v1', 'archive': archive.name,
        'sha256': digest(data), 'bytes': len(data), 'directoryBlocks': len(blocks),
        'directoryHash': digest(json.dumps(blocks, sort_keys=True).encode()),
        'files': len(files), 'verifiedExtractedEfp': sum(name.endswith('.efp') for name in files),
        'absent': absent}
    target = ROOT/'scripts/build/reference/particle-archive.json'
    if args.write:
        target.write_text(json.dumps(certificate, indent=2)+'\n')
    elif json.loads(target.read_text()) != certificate:
        raise ValueError('Archive certificate drift; investigate before regenerating')
    print(json.dumps(certificate, indent=2))

if __name__ == '__main__':
    main()
