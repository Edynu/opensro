"""Verify extracted sound evidence against the pinned PE; exhaust the pure TID selector.

No original process is launched. Unicorn runs only 8ED490 and its closed scalar
predicate callees. Source is frozen before this independent validation; outcomes
are not a source of lifting rules. Other audio producers remain evidence, not proof.
"""
import argparse, hashlib, json, struct
from pathlib import Path
import pefile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_32
from unicorn.x86_const import UC_X86_REG_ESP, UC_X86_REG_EAX

ROOT=Path(__file__).resolve().parents[1]
SHA='375e868234437e815af8ce9289ddea7ec9144430f4ea24e32988a6d6c9dd108a'

def verify(binary, output):
 raw=binary.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=SHA: raise ValueError('Wrong retail version')
 pe=pefile.PE(data=raw);base=pe.OPTIONAL_HEADER.ImageBase
 def read(va,n): return pe.get_data(va-base,n)
 evidence=json.loads((ROOT/'tests/fixtures/native/item-sound-native.json').read_text())
 surface=json.loads((ROOT/'../../scripts/build/reference/native-audio-surface.json').read_text())
 if evidence['binarySha256']!=SHA or surface['binarySha256']!=SHA: raise ValueError('Mismatched evidence lineage')
 for string in surface['strings']:
  va=int(string['va'],16)
  encodings=[string['value'].encode('utf-8')+b'\0',string['value'].encode('utf-16-le')+b'\0\0']
  if not any(read(va,len(encoded))==encoded for encoded in encodings): raise ValueError(f'Changed native string {va:x}')
 checked=0
 for f in evidence['functions']:
  for b in f['blocks']:
   lo,hi=int(b['start'],16),int(b['end'],16)
   if read(lo,hi-lo).hex()!=b['bytes']: raise ValueError(f'Changed native block {lo:x}')
   checked+=1
 for ref in surface['ownerReferences']+[r for s in surface['strings'] for r in s['codeReferences']]:
  if read(int(ref['va'],16),len(ref['bytes'])//2).hex()!=ref['bytes']: raise ValueError('Changed reference bytes')
 for e in [evidence['vtableEntry'],*surface['vtableEntries']]:
  offset=int(e['slotOffset'],0) if isinstance(e['slotOffset'],str) else e['slotOffset']
  if offset!=e['slotIndex']*4: raise ValueError('Invalid vtable slot offset')
  if int(e['entryVa'],16)!=int(e['tableVa'],16)+e['slotIndex']*4: raise ValueError('Invalid vtable provenance')
  if struct.unpack('<I',read(int(e['entryVa'],16),4))[0]!=int(e['targetVa'],16): raise ValueError('Changed vtable')
 # Independent conservative census: search every byte offset in executable
 # sections, not just disassembler-recognized instructions. Embedded tables and
 # coincidental constants remain explicit candidates, never false "producers".
 unlisted=[]
 targets=[(int(s['va'],16),s['value'],s['codeReferences']) for s in surface['strings']]
 targets.append((0xf08efc,'sound-manager',surface['ownerReferences']))
 for target,label,refs in targets:
  needle=struct.pack('<I',target)
  for section in pe.sections:
   if not section.Characteristics&0x20000000: continue
   data=section.get_data();start=0
   while True:
    found=data.find(needle,start)
    if found<0: break
    start=found+1;va=base+section.VirtualAddress+found
    if not any(int(ref['va'],16)<=va and va+4<=int(ref['va'],16)+len(ref['bytes'])//2 for ref in refs):
     unlisted.append({'operandVa':hex(va),'targetVa':hex(target),'label':label,'status':'unclassified-executable-reference'})
 # Capture the candidate hash before differential evaluation.
 source_sha=hashlib.sha256((ROOT/'src/engine/foundation/audio/item-sounds.ts').read_bytes()).hexdigest()
 machine=Uc(UC_ARCH_X86,UC_MODE_32)
 size=(pe.OPTIONAL_HEADER.SizeOfImage+4095)&~4095
 machine.mem_map(base,size);machine.mem_write(base,pe.get_memory_mapped_image())
 stack=0x10000000;machine.mem_map(stack,0x10000);sp=stack+0x8000;stop=stack+0xf000
 categories={};cache={}
 for tid in range(65536):
  machine.mem_write(sp,struct.pack('<II',stop,tid));machine.reg_write(UC_X86_REG_ESP,sp)
  machine.emu_start(0x8ed490,stop,count=1000)
  if machine.reg_read(UC_X86_REG_ESP)!=sp+4: raise ValueError('Unclosed selector ABI')
  address=machine.reg_read(UC_X86_REG_EAX)
  if address not in cache:
   data=bytes(machine.mem_read(address,128));end=0
   while data[end:end+2]!=b'\0\0': end+=2
   cache[address]=data[:end].decode('utf-16-le')
  label=cache[address]
  if label: categories.setdefault(label,[]).append(tid)
 result={'schema':'sro-item-sound-differential-v1','binarySha256':SHA,'candidateSha256':source_sha,'entryVa':'0x8ed490','cases':65536,'default':'','categories':categories,'verifiedBlocks':checked,'unlistedExecutableReferences':unlisted}
 output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({'cases':65536,'categories':len(categories),'nonemptyCases':sum(map(len,categories.values())),'verifiedBlocks':checked,'unlistedExecutableReferences':len(unlisted),'output':str(output)}))

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--binary',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();verify(a.binary,a.output)
