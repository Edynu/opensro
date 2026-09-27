"""Bounded 412230 caller comparison with an explicitly scripted stepper.

The retail manager interval is unmodified. The stepper is a fixture, not
evidence that terrain/object dispatch or event callbacks are equivalent.
"""
import hashlib
import json
import struct
import sys
from pathlib import Path
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import UC_X86_REG_ECX, UC_X86_REG_ESP, UC_X86_REG_EAX, UC_X86_REG_EIP

raw = Path(sys.argv[1]).read_bytes()
binary_hash = hashlib.sha256(raw).hexdigest()
assert binary_hash == '375e868234437e815af8ce9289ddea7ec9144430f4ea24e32988a6d6c9dd108a'
pe = pefile.PE(data=raw)
image = pe.get_memory_mapped_image()
base, scratch = pe.OPTIONAL_HEADER.ImageBase, 0x20000000

def pose(x, region=257):
    return dict(regionId=region, x=x, y=0, z=10, angle=0)

# Fixed before execution: threshold, status mask, limit and sector cases.
cases = [
    dict(name='reflection', start=pose(10), target=pose(100), steps=[(16, pose(50.2)), (1, pose(75))]),
    dict(name='near', start=pose(10), target=pose(14.99), steps=[(16, pose(14.8))]),
    dict(name='five-exact', start=pose(10), target=pose(15), steps=[(16, pose(14.9)), (0, pose(15))]),
    dict(name='sixth-terminal', start=pose(10), target=pose(100), steps=[(16, pose(10))]*5+[(1, pose(75))]),
    dict(name='sixth-continuation', start=pose(10), target=pose(100), steps=[(4, pose(10))]*6),
    dict(name='non-continuation', start=pose(10), target=pose(100), steps=[(32, pose(80))]),
    dict(name='sector', start=pose(1900), target=pose(50,258), steps=[(16, pose(.1,258)), (0, pose(50,258))]),
    dict(name='positive-limit', start=pose(0), target=pose(1921), steps=[]),
    dict(name='identical', start=pose(10), target=pose(10), steps=[]),
]
rows = []
for case in cases:
    uc=Uc(UC_ARCH_X86, UC_MODE_32)
    uc.mem_map(base,(len(image)+4095)&~4095);uc.mem_write(base,image)
    uc.mem_map(scratch,0x10000)
    manager,cell,host,vtable,code=scratch+0x100,scratch+0x300,scratch+0x400,scratch+0x600,scratch+0x1000
    start,target,stack,stop=scratch+0x700,scratch+0x720,scratch+0x8000,scratch+0xf000
    def words(at,*values):uc.mem_write(at,struct.pack('<'+'I'*len(values),*values))
    def position(at,p):
        words(at,cell,0,p['regionId']);uc.mem_write(at+12,struct.pack('<3f',p['x'],p['y'],p['z']))
    words(cell+4,host);words(host,vtable,0,0,0);words(vtable+8,code)
    # ecx=host; copy scripted six-word result, return scripted status, ret16.
    stub=bytearray.fromhex('53 8b410c 6bc020 8d5920 01c3 ff410c 8b542410')
    for offset in range(0,24,4):stub+=bytes([0x8b,0x43,offset+4,0x89,0x42,offset])
    stub+=bytes.fromhex('8b03 5b c21000');uc.mem_write(code,bytes(stub))
    for i,(status,p) in enumerate(case['steps']):
        words(host+0x20+i*32,status);position(host+0x24+i*32,p)
    position(start,case['start']);position(target,case['target'])
    words(stack,stop,1,start,target,0,0)
    uc.reg_write(UC_X86_REG_ECX,manager);uc.reg_write(UC_X86_REG_ESP,stack)
    uc.emu_start(0x412230,stop,count=100000)
    assert uc.reg_read(UC_X86_REG_EIP)==stop
    status=uc.reg_read(UC_X86_REG_EAX)
    region=struct.unpack('<H',uc.mem_read(target+8,2))[0]
    x,y,z=struct.unpack('<3f',uc.mem_read(target+12,12))
    calls=struct.unpack('<I',uc.mem_read(host+12,4))[0]
    rows.append(dict(**case,status=status,calls=calls,point=None if status&0x10000000 else dict(regionId=region,x=x,y=y,z=z,angle=0)))
Path(sys.argv[2]).write_text(json.dumps(dict(binarySha256=binary_hash,generatorSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),scope='retail region manager with scripted dependency, not whole navigation parity',rows=rows),indent=2)+'\n',encoding='utf-8')
