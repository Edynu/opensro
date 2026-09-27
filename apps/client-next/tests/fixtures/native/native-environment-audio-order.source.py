"""Bounded original-client frame/rand trace using revtool hardware breakpoints.

No executable bytes or RNG state are changed. Debug pauses affect frame timing;
this is ordering evidence, never a performance capture or a whole-scene image.
"""
import argparse
import ctypes as ct
import hashlib
import importlib.util
import json
import struct
import pefile
from pathlib import Path

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--pid',type=int,required=True)
p.add_argument('--binary',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
p.add_argument('--frames',type=int,default=2)
a=p.parse_args()
if not 1<=a.frames<=8: raise ValueError('Frames must be 1..8')
digest=hashlib.sha256(a.binary.read_bytes()).hexdigest()
if digest!='375e868234437e815af8ce9289ddea7ec9144430f4ea24e32988a6d6c9dd108a': raise ValueError('Unexpected executable')
source=Path(__file__).resolve().parents[3]/'reconstruct/tools/revtool.py'
spec=importlib.util.spec_from_file_location('frame_revtool',source)
rev=importlib.util.module_from_spec(spec);spec.loader.exec_module(rev)
points=(0xa0f430,0xa0f573,0xa0f593,0x9c477b)
active_points=points
policy=dict(binarySha256=digest,debuggerSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
            harnessSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            points=[hex(v) for v in points],frames=a.frames,maxHits=20000,timeoutSeconds=45,
            phasePoints={'timers':['0xa00ce0','0x8f7590'],'update':['0x8ce9c0'],'render':['0x8cb380','0x8cf730']},
            scope='CRT rand and application/weather/sky boundaries in the captured interval; not every application callback')
a.output.parent.mkdir(parents=True,exist_ok=True)
a.output.with_suffix('.policy.json').write_text(json.dumps(policy,indent=2)+'\n')
a.output.with_suffix('.source.py').write_bytes(Path(__file__).read_bytes())

class FrameDebugger(rev.Debugger):
    def __init__(self,pid):
        super().__init__(pid);self.saved={};self.thread=0
        self.k.GetThreadId.argtypes=[ct.c_void_p];self.k.GetThreadId.restype=ct.c_ulong
    def _get_ctx(self,tid):
        self.thread=tid;return super()._get_ctx(tid)
    def _set_dr_handle(self,handle,addr,kind):
        ctx=self.t.CONTEXT86();ctx.ContextFlags=rev._CONTEXT_DEBUG_REGISTERS
        if not self._get(handle,ct.byref(ctx)): return False
        tid=self.k.GetThreadId(handle)
        if tid not in self.saved:
            if ctx.Dr7&255: raise RuntimeError('Thread already owns hardware breakpoints')
            self.saved[tid]=(ctx.Dr0,ctx.Dr1,ctx.Dr2,ctx.Dr3,ctx.Dr6,ctx.Dr7)
        if addr is None:
            ctx.Dr0,ctx.Dr1,ctx.Dr2,ctx.Dr3,ctx.Dr6,ctx.Dr7=self.saved[tid]
        else:
            ctx.Dr0,ctx.Dr1,ctx.Dr2,ctx.Dr3=active_points;ctx.Dr6=0;ctx.Dr7=0x55
        return bool(self._set(handle,ct.byref(ctx)))

d=FrameDebugger(a.pid)
d.k.OpenProcess.argtypes=[ct.c_ulong,ct.c_int,ct.c_ulong];d.k.OpenProcess.restype=ct.c_void_p
h=d.k.OpenProcess(0x1010,False,a.pid)
if not h: raise ct.WinError(ct.get_last_error())
def read(va,fmt):
    n=struct.calcsize(fmt);b=ct.create_string_buffer(n);got=ct.c_size_t()
    if not d.k.ReadProcessMemory(h,va,b,n,ct.byref(got)) or got.value!=n: raise ct.WinError(ct.get_last_error())
    return list(struct.unpack(fmt,b.raw))
rows=[];frame=-1;complete=False;error=None
def hit(debugger,ctx,addr,kind):
    global frame,complete,error,active_points
    try:
        if debugger.modbase!=0x400000: raise ValueError('Unexpected live module base')
        pc=ctx.Eip;row=dict(index=len(rows),thread=debugger.thread,pc=hex(pc),frame=frame)
        if pc==points[0]:
            frame+=1
            if frame==a.frames: complete=True;return None
            active_points=(points[0],points[3],0xa00ce0,points[1])
            row.update(kind='frame-begin',frame=frame,application=hex(ctx.Ecx))
        elif pc==points[1]:
            row.update(kind='update-dispatch',target=hex(ctx.Eax))
            active_points=(points[0],points[3],0x8ce9c0,points[2])
        elif pc==points[2]:
            row.update(kind='render-dispatch',target=hex(ctx.Eax))
            active_points=(points[0],points[3],0x8cb380,0x8cf730)
        elif pc==0xa00ce0:
            row.update(kind='timers-dispatch')
            active_points=(points[0],points[3],0x8f7590,points[1])
        elif pc==0x8f7590:
            row.update(kind='environment-audio-timer',owner=hex(ctx.Ecx),timerId=read(ctx.Esp+4,'<I')[0])
        elif pc in (0x8ce9c0,0x8cb380,0x8cf730):
            row.update(kind={0x8ce9c0:'weather-update',0x8cb380:'sky-render',0x8cf730:'weather-render'}[pc],owner=hex(ctx.Ecx))
        elif pc==points[3]:
            state=read(ctx.Eax+0x14,'<I')[0];next_state=(state*214013+2531011)&0xffffffff
            row.update(kind='rand',caller=hex(read(ctx.Esp,'<I')[0]),stateBefore=state,stateAfter=next_state,value=(next_state>>16)&32767)
            if row['caller']=='0x8f79f8':
                row.update(consumer='CGEffSoundBody.environment-countdown',owner=hex(ctx.Ebx),layer=hex(ctx.Esi),countdown=read(ctx.Esi,'<III'))
        else: raise ValueError('Unexpected breakpoint')
        row['clock']=read(0xf0c910,'<IfI')
        if pc!=points[3]:
            row['nativeFrame']=read(0xeffe90+0x6720,'<I')[0]
            row['region']=read(0xeffe90+0x237e,'<H')[0]
            row['timeOfDay']=read(0xeffe90+0x26a3,'<f')[0]
            row['fpuControlWord']=ctx.FloatSave.ControlWord
        rows.append(row)
        if len(rows)>=policy['maxHits']: raise RuntimeError('Trace hit limit')
        return points[0],'exec'
    except Exception as e:
        error=str(e);return None
try:
    # Bind the attached process, not merely the executable supplied by the caller.
    d.k.QueryFullProcessImageNameW.argtypes=[ct.c_void_p,ct.c_ulong,ct.c_wchar_p,ct.POINTER(ct.c_ulong)]
    d.k.QueryFullProcessImageNameW.restype=ct.c_int
    path=ct.create_unicode_buffer(32768);size=ct.c_ulong(32768)
    if not d.k.QueryFullProcessImageNameW(h,0,path,ct.byref(size)):raise ct.WinError(ct.get_last_error())
    raw=Path(path.value).read_bytes()
    if hashlib.sha256(raw).hexdigest()!=digest:raise ValueError('Unexpected live executable')
    pe=pefile.PE(data=raw)
    for va in (*points,0xa00ce0,0x8f7590,0x8ce9c0,0x8cb380,0x8cf730):
        if bytes(read(va,'<16B'))!=pe.get_data(va-0x400000,16):raise ValueError('Live instructions disagree with original executable')
    hits=d.run(points[0],'exec',policy['timeoutSeconds'],hit)
except Exception as e:
    error=str(e);hits=len(rows)
finally:
    d.k.CloseHandle(h)
result=dict(schema='sro-native-frame-order-v1',policy=policy,pid=a.pid,complete=complete,error=error,hits=hits,events=rows)
a.output.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(dict(complete=complete,error=error,hits=hits,frames=frame,randCalls=sum(r['kind']=='rand' for r in rows))))
raise SystemExit(0 if complete and not error else 1)
