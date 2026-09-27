"""Run complete retail contact functions, without instruction/call substitution.

Usage: py tools/native-contact-reference.py EXE OUTPUT_JSON
This is bounded machine-execution evidence, not full navigation acceptance.
"""
import hashlib
import json
import struct
import sys
from pathlib import Path
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import UC_X86_REG_EAX, UC_X86_REG_ECX, UC_X86_REG_EDI, UC_X86_REG_ESP, UC_X86_REG_EIP

raw = Path(sys.argv[1]).read_bytes()
binary_hash = hashlib.sha256(raw).hexdigest()
if binary_hash != '375e868234437e815af8ce9289ddea7ec9144430f4ea24e32988a6d6c9dd108a':
    raise RuntimeError('Unexpected retail executable')
pe = pefile.PE(data=raw)
image = pe.get_memory_mapped_image()
base = pe.OPTIONAL_HEADER.ImageBase
scratch = 0x20000000
stop = scratch + 0xf000

def machine():
    uc = Uc(UC_ARCH_X86, UC_MODE_32)
    uc.mem_map(base, (len(image) + 4095) & ~4095)
    uc.mem_write(base, image)
    uc.mem_map(scratch, 0x10000)
    return uc

def words(uc, address, *values):
    uc.mem_write(address, struct.pack('<' + 'I' * len(values), *values))

def floats(uc, address, *values):
    uc.mem_write(address, struct.pack('<' + 'f' * len(values), *values))

def execute(uc, entry, *args):
    stack = scratch + 0x8000
    words(uc, stack, stop, *args)
    uc.reg_write(UC_X86_REG_ESP, stack)
    uc.emu_start(entry, stop, count=100000)
    if uc.reg_read(UC_X86_REG_EIP) != stop:
        raise RuntimeError('Native contact function exceeded instruction budget')

# Policy/cases are fixed independently of observed native outputs.
snap_cases = [([0, 0], [0, 0]), ([0, 0], [.1, 0]), ([0, 0], [.2, 0]),
              ([0, 0], [.200001, 0]), ([0, 0], [3, 4]),
              ([33.333332, 33.333332], [50, 50]),
              ([-1900, 1900], [1900, -1900])]
rows = []
for center, point in snap_cases:
    uc = machine()
    cell, target = scratch + 0x100, scratch + 0x500
    floats(uc, cell + 0x18, *center)
    floats(uc, target, *point)
    uc.reg_write(UC_X86_REG_EAX, cell)
    uc.reg_write(UC_X86_REG_EDI, target)
    execute(uc, 0x45c1b0)
    rows.append({'center': center, 'point': point,
                 'result': list(struct.unpack('<2f', uc.mem_read(target, 8))),
                 'resultBits': list(struct.unpack('<2I', uc.mem_read(target, 8)))})

walks = []
for flags in [0, 2, 8, 0x12]:
    for block in [0, 1]:
        for budget in [0, 1, 3]:
            uc = machine()
            host, cell, edges, verts = scratch + 0x100, scratch + 0x200, scratch + 0x400, scratch + 0x600
            start, target, status, ctx = scratch + 0x700, scratch + 0x720, scratch + 0x740, scratch + 0x800
            floats(uc, cell + 0x18, 100 / 3, 100 / 3)
            vertices = [(0, 0, 0), (100, 0, 0), (0, 0, 100)]
            for i, vertex in enumerate(vertices):
                floats(uc, verts + i * 16, *vertex)
                edge = edges + i * 0x40
                words(uc, cell + 0x28 + i * 4, edge)
                words(uc, edge, flags, verts + i * 16, verts + ((i + 1) % 3) * 16, cell, 0)
            floats(uc, start, 10, 10)
            floats(uc, target, 80, 80)
            words(uc, ctx + 4, budget)
            uc.reg_write(UC_X86_REG_ECX, host)
            execute(uc, 0x428930, cell, start, target, status, block, ctx, 0)
            result_cell = uc.reg_read(UC_X86_REG_EAX)
            walks.append({'flags': flags, 'blockThrough': bool(block), 'budget': budget,
                          'start': [10, 10], 'requested': [80, 80],
                          'point': list(struct.unpack('<2f', uc.mem_read(target, 8))),
                          'pointBits': list(struct.unpack('<2I', uc.mem_read(target, 8))),
                          'status': struct.unpack('<I', uc.mem_read(status, 4))[0],
                          'remainingBudget': struct.unpack('<I', uc.mem_read(ctx + 4, 4))[0],
                          'cell': 'original' if result_cell == cell else 'none' if result_cell == 0 else 'unexpected'})

slides = []
for placement in [[0, 0, 0], [128, 7, -64]]:
 for enabled in [False, True]:
     for requested in [[80, 0, 80], [90, 0, 40], [40, 0, 90]]:
         uc = machine()
         host, cell, edges, verts = scratch + 0x100, scratch + 0x200, scratch + 0x400, scratch + 0x600
         start, target, ctx, block, vtable = scratch + 0x700, scratch + 0x720, scratch + 0x800, scratch + 0xa00, scratch + 0xd00
         words(uc, host, vtable)
         words(uc, vtable + 8, 0x428f40)
         words(uc, cell + 4, host)
         floats(uc, cell + 0x18, 100 / 3, 100 / 3)
         for i, vertex in enumerate([(0, 0, 0), (0, 0, 100), (100, 0, 0)]):
             floats(uc, verts + i * 16, *vertex)
             words(uc, cell + 0xc + i * 4, verts + i * 16)
             edge = edges + i * 0x40
             words(uc, cell + 0x28 + i * 4, edge)
             words(uc, edge, 2, verts + i * 16, verts + ((i + 1) % 3) * 16, cell, 0)
         identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
         identity[12:15] = placement
         floats(uc, block + 0x68, *identity)
         identity[12:15] = [-n for n in placement]
         floats(uc, block + 0xa8, *identity)
         words(uc, block + 0xf0, host)
         words(uc, start, cell, block, 0x8001)
         world_start = [10 + placement[0], placement[1], 10 + placement[2]]
         world_requested = [requested[i] + placement[i] for i in range(3)]
         floats(uc, start + 12, *world_start)
         words(uc, target, cell, block, 0x8001)
         floats(uc, target + 12, *world_requested)
         words(uc, ctx + 4, 3)
         words(uc, 0xf582fc, int(enabled))
         uc.reg_write(UC_X86_REG_ECX, scratch + 0xe00)
         execute(uc, 0x453fa0, 1, start, target, ctx)
         slides.append({'enabled': enabled, 'placement': placement, 'start': world_start, 'requested': world_requested,
                        'point': list(struct.unpack('<3f', uc.mem_read(target + 12, 12))),
                        'normal': list(struct.unpack('<3f', uc.mem_read(ctx + 8, 12))),
                        'status': uc.reg_read(UC_X86_REG_EAX)})
 
Path(sys.argv[2]).write_text(json.dumps({
    'binarySha256': binary_hash,
    'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'scope': 'Complete 45c1b0, 428930 and 453fa0 execution on finite synthetic contact cases; synthetic vtable dispatches to original 428f40; no call substitution; no full-world equivalence',
    'snap': rows, 'walk': walks, 'slide': slides
}, indent=2) + '\n', encoding='utf8')
