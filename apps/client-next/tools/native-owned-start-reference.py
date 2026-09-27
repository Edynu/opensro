"""Bounded original 428F40 start-correction prefix; no instruction substitution.
Stops at 429079, before the cell-walk call. Not whole-navigation equivalence.
Usage: py tools/native-owned-start-reference.py EXE OUTPUT
"""
import hashlib
import json
import struct
import sys
from pathlib import Path
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import UC_X86_REG_ECX, UC_X86_REG_ESP, UC_X86_REG_EIP, UC_X86_REG_FPCW

raw = Path(sys.argv[1]).read_bytes()
digest = hashlib.sha256(raw).hexdigest()
assert digest == '375e868234437e815af8ce9289ddea7ec9144430f4ea24e32988a6d6c9dd108a'
pe = pefile.PE(data=raw)
image = pe.get_memory_mapped_image()
base, scratch = pe.OPTIONAL_HEADER.ImageBase, 0x20000000
# Fixed boundary matrix, chosen before native execution.
cases = [[10,10], [0,20], [50,50], [0,0], [-.01,20], [-10,20],
         [50,50.1], [80,80], [-1,-1], [100,0], [99.999,0]]
rows = []
for point in cases:
    uc = Uc(UC_ARCH_X86, UC_MODE_32)
    # Explicit arithmetic environment. Unicorn's zero default selects 24-bit
    # intermediates; do not accidentally treat that as the process FPU state.
    uc.reg_write(UC_X86_REG_FPCW,0x037f)
    uc.mem_map(base, (len(image)+4095)&~4095)
    uc.mem_write(base, image)
    uc.mem_map(scratch, 0x10000)
    def words(at, *v): uc.mem_write(at, struct.pack('<'+'I'*len(v), *v))
    def floats(at, *v): uc.mem_write(at, struct.pack('<'+'f'*len(v), *v))
    host, cell, edges, verts = [scratch+n for n in [0x100,0x200,0x400,0x600]]
    source, target, ctx, stack = [scratch+n for n in [0x700,0x720,0x800,0x8000]]
    words(cell+4, host)
    floats(cell+0x18,100/3,100/3)
    vertices = [(0,0,0),(0,0,100),(100,0,0)]
    for i,v in enumerate(vertices):
        floats(verts+i*16,*v)
        words(cell+0xc+i*4,verts+i*16)
        edge=edges+i*0x40
        words(cell+0x28+i*4,edge)
        words(edge,2,verts+i*16,verts+((i+1)%3)*16,cell,0)
    words(source,cell,0,0x8001);floats(source+12,point[0],0,point[1])
    words(target,cell,0,0x8001);floats(target+12,20,0,20)
    words(stack,scratch+0xf000,0,source,target,ctx)
    uc.reg_write(UC_X86_REG_ECX,host);uc.reg_write(UC_X86_REG_ESP,stack)
    uc.emu_start(0x428f40,0x429079,count=100000)
    assert uc.reg_read(UC_X86_REG_EIP)==0x429079
    result=list(struct.unpack('<2f',uc.mem_read(uc.reg_read(UC_X86_REG_ESP)+0x18,8)))
    rows.append({'point':point,'result':result})
Path(sys.argv[2]).write_text(json.dumps({'binarySha256':digest,
 'generatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
 'scope':'Original 428F40 prefix through 429079 including original classifier, segment intersection, nudge and callees; x87 control word 0x037f; finite synthetic retained-cell starts only',
 'vertices':vertices,'rows':rows},indent=2)+'\n',encoding='utf8')
