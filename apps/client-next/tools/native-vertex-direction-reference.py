"""Frozen bounded native table and outside-block arithmetic reference.
Original executable only; no substituted calls/instructions. Not full navigation.
Usage: python SCRIPT EXE OUTPUT
"""
import hashlib, json, struct, sys
from pathlib import Path
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ESP, UC_X86_REG_FPCW, UC_X86_REG_EIP

raw=Path(sys.argv[1]).read_bytes()
digest=hashlib.sha256(raw).hexdigest()
assert digest=='375e868234437e815af8ce9289ddea7ec9144430f4ea24e32988a6d6c9dd108a'
pe=pefile.PE(data=raw); image=pe.get_memory_mapped_image(); base=pe.OPTIONAL_HEADER.ImageBase
scratch=0x20000000
def machine():
    uc=Uc(UC_ARCH_X86,UC_MODE_32)
    uc.mem_map(base,(len(image)+4095)&~4095);uc.mem_write(base,image)
    uc.mem_map(scratch,0x10000);uc.reg_write(UC_X86_REG_FPCW,0x037f)
    return uc
def words(uc,at,*v):uc.mem_write(at,struct.pack('<'+'I'*len(v),*v))
def floats(uc,at,*v):uc.mem_write(at,struct.pack('<'+'f'*len(v),*v))
uc=machine(); host=scratch; stack=scratch+0x8000; stop=scratch+0xf000
words(uc,stack,stop);uc.reg_write(UC_X86_REG_ESP,stack);uc.reg_write(UC_X86_REG_EAX,host)
uc.emu_start(0x43ec10,stop,count=1000000)
assert uc.reg_read(UC_X86_REG_EIP)==stop
table=struct.unpack('<512f',uc.mem_read(host+0x20c0,2048))
# Fixed cases chosen from ASM: endpoint 0/1, exact tie, signed directions,
# long source-to-hit distance and large float coordinates.
cases=[([-10,20],[0,20],0,64),([-10,80],[0,80],0,64),([-10,50],[0,50],0,64),
       ([-100,20],[0,20],128,192),([-100,80],[0,80],128,192),
       ([-.01,50],[0,50],37,219),([100000,50],[0,50],37,219)]
rows=[]
for source,hit,ia,ib in cases:
    uc=machine(); edge=scratch+0x100; va=scratch+0x200; vb=scratch+0x220; src=scratch+0x300; status=scratch+0x400
    words(uc,edge,1,va,vb,0,0)
    floats(uc,va,0,0,0,*table[ia*2:ia*2+2]);floats(uc,vb,0,0,100,*table[ib*2:ib*2+2])
    floats(uc,src,source[0],7,source[1]); words(uc,stack+0x1c,edge)
    floats(uc,stack+0x34,*hit);words(uc,stack+0x6c,src,status,1)
    uc.reg_write(UC_X86_REG_ESP,stack)
    uc.emu_start(0x428749,0x4288a6,count=10000)
    assert uc.reg_read(UC_X86_REG_EIP)==0x4288a6
    x,y,z=struct.unpack('<3f',uc.mem_read(src,12));assert y==7
    rows.append({'source':source,'hit':hit,'directions':[ia,ib],'result':[x,z]})
Path(sys.argv[2]).write_text(json.dumps({'binarySha256':digest,'generatorSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
 'scope':'Original 43EC10 including native CRT trigonometry and 428749..4288A6 blocked-outline branch; FPCW=037F; PE initial CRT dispatch state; finite cases only',
 'table':list(table),'rows':rows},indent=2)+'\n',encoding='utf8')
