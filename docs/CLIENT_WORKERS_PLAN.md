# Client worker threads: plan

Status: step 1 and step 2 (parts 1, 2a, 2b, 2c, 3a) done (2026-10-22). Scope: the browser client's
per-actor frame work (players, monsters, NPCs and pets, their poses, cloth,
particles and the parallel parts of presentation) and the draw path that
feeds it to the GPU. Goal: hundreds of players and monsters with their
effects on screen, at the highest frame rate the CPU allows, with the same
picture as today.

Paths are relative to `apps/client-next/` unless stated.

## 1. The problem

The client already runs on three threads: the simulation worker (socket,
codec, session, clock), the asset worker (pack downloads and decoding) and
the main thread. Everything a frame does per actor runs on the main
thread, and that is where a crowd spends its time.

### 1.1 Baseline on the current tree (2026-10-21)

`town-crowd-bench.mjs` still, 215 players online, 512 actors (the
`CHARACTER_ACTORS` cap is full), 318 visible, headless and uncapped,
server and crowd on the same 24-thread machine: **15 fps, 61.6 ms main
thread per frame** (p50 64 ms, p99 86 ms). Render storage reached 91 MB,
above the former 64 MiB budget, with no actor deferred.

Stage spans (`--spans`, ms per frame):

| Stage | ms |
| --- | --- |
| Render preparation and submit | 37.4 |
| - character prepare (`@character-plan` 14.6, `@character-upload` 9.4, `@character-poses` 2.9) | 27.0 |
| - submit | 5.0 |
| - labels and portraits | 3.4 |
| - world | 2.0 |
| Character presentation (`presentation-actors` 10.0, `actor-motion` 6.2, events 2.5) | 19.7 |
| UI | 3.9 |

CPU profile (`--cpu`, 16 fps, so 16 ms/s is about 1 ms per frame):

| Work | ms per frame | Kind |
| --- | --- | --- |
| Particle graph advance (`advanceParticles`, inside `@character-plan`) | 11.7 | Per graph, independent |
| Group preparation and draws (`prepareGroup`) | 8.0 | Main thread today; the draw path (5.9) |
| Actor presentation (`actor-presentation.ts` `present`) | 9.3 | Per actor |
| Needed poses (`evaluateNeededPoses`) | 2.9 | Per actor |
| Garbage collection | 2.9 | Falls as allocation falls |
| `characterRadius`, called from `animation` in `resources.poll` every frame | 2.4 | Serial churn: cache it |
| Bind bounds building a whole pose (`registerClip` under `characterBindBounds`) | 1.3 | Serial churn: cache it |

Structured-cloning the 477-actor list costs 2.1 ms and posting it 0.9 ms
per frame (`--clone-cost`), before any work: messages are not an option.

### 1.2 What it means

About half of the main thread is per-actor work that can run on workers.
The other half is the draw path (group preparation, uploads, labels,
submit), which has to stay on the thread that owns the GPU device. Workers
alone therefore only double the frame rate; past that the draw path itself
has to shrink to a few bulk uploads and few draws. Estimates for this
scene from the profile, to be replaced by a measurement at each step:

| After | Main thread per frame | fps |
| --- | --- | --- |
| Today | 58 to 62 ms | 15 |
| Per-actor work on workers | about 31 ms | about 30 |
| Plus the GPU-driven draw path | about 12 to 14 ms | about 70 to 80 |
| Plus the pipelined schedule | about 10 to 12 ms | about 80 to 100 |

GPU time for this scene was measured in section 6.7: the GPU allows 100 fps
on the measuring machine, and Chrome's GPU process is the next limit.

## 2. What earlier attempts taught

- **Render thread (`1761d572`, parked).** Moving the renderer into one
  worker on an `OffscreenCanvas` moves the single thread; it does not add
  one. The per-actor work stays serial.
- **Rust renderer.** A faster language does not change a data model that
  spends its time walking objects, Maps and string keys. The profile puts
  the math kernels at about 22% of the frame.
- **Rust particle pool over `SharedArrayBuffer` (`68838b3e`, parked).**
  Bit-identical and 1.77x faster on one thread, spread over up to 8
  workers, and the 200-player frame stayed at about 28 fps. It parallelised
  one subsystem; the rest of the per-actor work and the draw path stayed.
- **Copying to workers.** An earlier threading attempt copied the parts a
  worker needed. Structured-cloning the actor list every frame costs more
  than a large part of the work it would offload.

## 3. Decisions (2026-10-21)

1. **TypeScript only.** No Rust or WebAssembly kernels, no new toolchain:
   other contributors keep the language and gates they have. The Rust
   experiments stay parked.
2. **Staged replacement, not a rewrite in one go.** The end state below is
   designed once. Each subsystem is then replaced on its own, the old and
   new paths side by side until the existing exactness tests prove the new
   one identical and the town-crowd bench proves it faster.
3. **Shared memory, one writer per byte.** State lives in typed arrays over
   a `SharedArrayBuffer`. Every byte has exactly one writer in each phase;
   everyone may read it. `Atomics` is used only for the control counters,
   never for the data.
4. **Fork-join first, pipelining later.** Fork-join is the default and
   keeps today's output. The pipelined schedule comes last, as an
   Experimental option; outputs are double-buffered from the start so it is
   a scheduling change, not a rewrite.
5. **The draw path is in scope.** Workers write their outputs in the
   layout the GPU buffers use; main uploads them in bulk and issues few
   draws.
6. **Poses first.** They prove the mechanics (shared tables, pool,
   barriers, GPU-layout output) with no random-number question; particles,
   the bigger win, follow.
7. **Kernels in one place.** Frame kernels on flat arrays live in one
   folder with its own short `AGENTS.md`. Gameplay, UI, network and the
   rest keep their current style.

## 4. Platform facts the design rests on

- **One thread owns the GPU device.** A `GPUDevice` cannot be shared or
  transferred between threads. Workers compute; the main thread uploads
  and submits.
- **Each worker has its own JavaScript heap and garbage collector.** No JS
  object is ever shared. What is shared is raw memory: a
  `SharedArrayBuffer`. Its contents are outside every heap: never scanned,
  moved or collected.
- **`SharedArrayBuffer` needs cross-origin isolation.** The page must be
  served with `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`), and
  every cross-origin resource it loads must allow it (CORP or CORS). The
  repository sends neither header today. Without isolation
  `crossOriginIsolated` is false and the pool runs inline (section 5.8).
- **The main thread may not block.** `Atomics.wait` throws on the window's
  thread. The main thread signals workers with `Atomics.notify`, does its
  own serial work, and only then spins on a completion counter with
  `Atomics.load`. Workers block with `Atomics.wait` between frames.
- **Atomics order plain writes.** A thread's plain writes before an
  `Atomics` operation are visible to a thread that observes that operation
  (the JavaScript memory model is sequentially consistent for data-race-free
  programs), so the counters are the only synchronisation the data needs.
- **`writeBuffer` takes shared memory.** The WebGPU IDL types its data as
  `AllowSharedBufferSource`; the prototype confirms Chrome accepts a view
  over a `SharedArrayBuffer` without a copy of its own. Not a growable one:
  Chrome refuses a resizable buffer (section 6.13).
- **Cores are shared.** The page already has the main thread, two workers,
  the browser's GPU process and the compositor. The pool takes
  `min(MAX_FRAME_WORKERS, navigator.hardwareConcurrency - RESERVED_THREADS)`
  workers, with `MAX_FRAME_WORKERS = 8` and `RESERVED_THREADS = 4` to begin
  with, both tuned by measurement. A machine with four threads or fewer
  gets zero workers and runs inline.

## 5. Design

### 5.1 Shared tables

**The resource table** holds read-only data, written once when a model or
clip is admitted and read by every thread: skeletons (parent indices, bind
and inverse-bind matrices), clip key tracks, cloth rest shapes and
constraint lists, particle programs. It is append-only within a session.
Entries are addressed by integer ids, never by name, so no thread ever
builds a string. Admission happens between frames, never during one.

**The actor table** holds per-actor frame state for every kind of actor
(player, monster, NPC, pet, attachment), with a kind column. It has a fixed
capacity of `CHARACTER_ACTORS` (512, `foundation/animation/character-budget.ts`)
slots in struct-of-arrays columns, so a kernel walks one column of numbers
rather than a list of objects:

| Column group | Written by | Read by | Examples |
| --- | --- | --- | --- |
| Inputs | main, before the fork | workers | model and clip ids, clip times and weights, transform, LOD fraction, flags, parent slot, depth level |
| Outputs (A and B) | one worker per slot, during the fork | main after the join, later phases | bone palettes, socket matrices, cloth vertices, bounds, instance rows |
| Scratch | its own worker | that worker | temporary matrices and quaternions |
| Events | one ring per worker | main, after the join | sound, effect start, damage-text and state-change requests |
| Control | main and workers through `Atomics` | all | frame number, phase, next-chunk counter, done counter |

**The effect table** holds particle graph state, one row per live effect,
with the slot of its holder actor.

Spawns, despawns and new effects change the tables' structure only on the
main thread, between frames, while the workers sleep. The tables are sized
at startup for the capacity and grown only between frames; a growable
`SharedArrayBuffer` (`maxByteLength`) avoids copying, and every view is
re-created after a grow.

### 5.2 One frame (fork-join)

```
main:    snapshot -> write inputs -> notify ──┐       world, UI -> spin until done -> replay events -> upload -> draw -> submit
workers:                                      └> poses by level -> particles -> cloth -> done
```

1. **Snapshot.** The main thread writes the frame's inputs into the actor
   table. During migration this is a plain write of a few kilobytes with
   no allocation; once the table owns that state, the write disappears.
2. **Fork.** Bump the frame number, reset the counters, `Atomics.notify`.
3. **Serial work in the gap.** The main thread does the work that never
   moves (world preparation, UI, input) while the workers run.
4. **Join.** Spin on the done counter. In a healthy frame the workers have
   already finished, and the spin is near zero.
5. **Replay.** Apply each worker's events in actor-slot order, so output
   never depends on which thread finished first.
6. **Upload and draw.** A few large `writeBuffer` calls straight from the
   output views, then the draws.

### 5.3 Phases and splitting the work

A frame's work runs in phases with a barrier between each: poses (by
level, 5.4), then particles (reading their holder's sockets), then cloth.
In each phase workers take chunks of `ACTOR_CHUNK` rows (8 to begin with)
from a shared counter (`Atomics.add`). No worker belongs to one kind of
actor; the load balances itself across however many workers there are. A
row's outputs belong to the worker that took its chunk, so no two threads
ever write the same bytes in one phase, and there are no locks. Chunk
boundaries and the counters sit on separate 64-byte lines, so threads do
not contend for one cache line.

### 5.4 Dependencies between actors

A rider needs its mount's saddle socket. An effect needs its holder's
bone. Attachments go up to 8 deep. Each actor gets a depth level when the
hierarchy is built (it already is: `foundation/animation/character-hierarchy.ts`).
The pose phase runs level by level, with a barrier between levels. Nearly
every actor is at level 0, so the extra barriers cost little.

### 5.5 Allocation-free kernels

A worker allocates nothing after its init, so its garbage collector never
runs. In the kernels: only numbers, preallocated typed-array views and
indices. No `{}`, `[]`, closures, `map`/`filter`, strings, object-returning
functions or per-frame `postMessage`. This is checked, not assumed: a test
runs each kernel for many frames and fails if the heap grows, and `--heap`
captures confirm it in the browser.

### 5.6 What moves to the workers

| Order | Work | Today (ms, 1.1) | Notes |
| --- | --- | --- | --- |
| 1 | Pose evaluation and bone rows, every actor kind | 2.9 | Independent per actor after levels; no random numbers |
| 2 | Particle graph simulation | 11.7 | Per-graph random streams (section 7); ribbons stay on main |
| 3 | Presentation: actor motion, pose selection, clocks | about 9 | Per-actor state stepping; side effects become events |
| 4 | Cloth | about 1 | 20 Hz Verlet; consumes the gust stream (section 7) |
| - | Event application, sounds, UI, damage text | rest | Stays on main, replayed in order |

### 5.7 Lifecycle

One module owns the pool: `Init` (create the tables and workers, wait for
each worker's ready), `Frame` (fork, join, replay), `Shutdown` (stop the
workers, release the tables), in the runtime's visible frame and disposal
order. Workers never start async work of their own.

### 5.8 Fallback and failure

With zero workers (no isolation, few cores, the option off) the same
kernels run inline over the same tables on the main thread: one code path,
and the reference the threaded path is tested against. A worker that fails
or misses `JOIN_TIMEOUT_MS` is retired: the pool reports a `degraded`
incident (`apps/client-next/AGENTS.md`), finishes that frame inline, and
stays inline for the session. A broken pool never ends the session or
drops a frame's actors.

### 5.9 The GPU-driven draw path

Today every draw owns its buffers and bind group, the same mesh is uploaded
once per outfit, and batches are keyed by whole outfit, so the main thread
builds and uploads per actor. The end state:

- **Resources uploaded once:** shared vertex and index pools for character
  meshes, a material table, explicit bind group layouts.
- **Instance rows in the actor table:** one row per (actor, part) with
  transform, bone offset, material index and the per-actor material state,
  written by the worker that posed the actor, in the GPU's layout.
- **Few uploads, few draws:** one `writeBuffer` per output column per
  frame, and draws bucketed by pipeline state and mesh, recorded once in
  render bundles and re-recorded only when a mesh appears or leaves.

The parked pooled-character renderer (`68838b3e`, TypeScript, 0 differing
pixels over its crowd and cloth frames) is the candidate starting point.
Native draw-order rules (blend order, material-set order, far-to-near
transparent groups) decide bucket order, as `docs/RENDERER_REWRITE.md` on
that branch lists.

### 5.10 The pipelined schedule

Workers compute frame N+1 into output B while main uploads and draws frame
N from output A; the halves swap at the frame boundary. The frame then
costs the slower of the two sides instead of their sum. Workers pose for
the next frame's predicted display time, so a pose is not a frame old;
state that arrives during a frame appears one frame later. That timing
differs from native, so the schedule is an Experimental row, off, tested
against fork-join.

### 5.11 The character presentation on its own worker

Step 4 moved the presentation's arithmetic to the frame workers; what is
left of it on the main thread is logic (animation choice, appearance,
events and effects, publication), about a third of the frame in the town
crowd (section 6.14). It cannot become a flat kernel without a rewrite,
but the whole owner can move, unchanged, to a worker of its own, which
runs it while the main thread draws. Port-only, not native: an
Experimental row, "Characters on a worker", off; read at startup like
Worker threads. The viewer and the row off keep today's path.

**What makes it possible.** The presentation (`runtime/characters/**`
and the 127 modules it imports) touches no DOM, WebGPU, AudioContext,
storage or animation frame, and keeps no module-level state: everything
outside it arrives through `createCharacterPresentation`'s arguments and
`step`'s inputs. The worker builds the same owner with stand-ins for
those arguments.

**Schedule (pipelined).** Each main frame applies the newest finished
output of the worker, then posts this frame's inputs; it never waits.
Characters are drawn one frame after the simulation state they show; the
camera follows the same output (`cameraTarget`), so the two agree. A
worker slower than the display steps only the newest inputs.

**Inputs.**
- The simulation's world batches and snapshots reach the worker straight
  from the simulation worker (a second port; that worker posts to both),
  and the worker keeps its own projection (`createPresentation`): its
  entities, gameplay, feedback, lifecycle events and effective HP.
- From the main thread each frame: the frame time, the camera pitch,
  V held, the front end's dock, preview and server name, the video
  options read today, the mall preview choice, the Experimental flags,
  and the renderer's facts of the frame it drew last (presentation
  camera, audio listener, night, the deferred emitters' clocks, the last
  drawn matrix of an emitter that restarts); scenery and dungeon room
  visibility when they change.

**Outputs, one message a frame.**
- To the renderer: the actor and portrait lists (structured clone
  first), the assemblies requested this frame (a definition only for an
  id the main thread has not seen), models and clips as they load (their
  buffers and bitmaps transferred), the retained model list, footprints,
  damage text and event rain.
- To the rest: sound events (`audio.enqueue`), the effective-HP
  operations the step made (`impact`, `release`, `finishedCasts`,
  replayed on the main thread's projection for the UI), the camera target
  and camera scripts, the orb gauge, readiness, errors and the mall
  state.

**Services inside the worker.**
- Assets: a stand-in for the asset owner that relays requests to the main
  thread's owner, so every owner keeps sharing its four slots; results
  are transferred to the worker.
- Skeleton queries (`characterSocket`, `characterMatrix`,
  `characterLocalMatrix`): the renderer's character owner
  (`renderer/characters/characters.ts`), which needs no GPU (the tests
  run it in Node), built in the worker without geometry commands and
  given the same models, assemblies and clips; it answers on the rows
  the presentation passes, as the renderer does.
- Random: a stream of the worker's own, seeded from the main thread's
  (decision 7.1: worker paths need not draw in the main thread's order).
- Pose kernels: run inside the worker (the frame-worker pool stays the
  renderer's, so its one open phase is never shared).

**Where it differs from the main-thread path.** The one-frame display
delay; the random order; answers the renderer gives after the fact (a
model or assembly over budget, an emitter's last drawn matrix and clock)
arrive a frame later; socket queries pose exactly where the renderer may
reuse a level-of-detail sample. Tests drive the owner through the
worker's stand-ins inline and compare its outputs with the main path's
for the same inputs and random stream.

**Stages.**
1. The owner's arguments narrowed to what it uses (a renderer subset, an
   HP subset), so stand-ins can implement them. Exact.
2. The worker's services (asset relay, skeleton owner, renderer facts,
   output collector, HP operations), tested inline against the main path.
3. The worker, the main thread's host, the simulation's second port and
   the Experimental row; measured in the town crowd.
4. The actor list through shared memory instead of a clone, if receiving
   it shows in the main thread's profile.

## 6. Steps

Each step is measured with the town crowd (section 8) against the step
before, and lands only when the existing tests prove it identical.

| Step | Work | Acceptance |
| --- | --- | --- |
| 1 | Cache fixes: `characterRadius` per animation, bind bounds per model | Output identical (existing tests); main-thread time falls by about 3.7 ms |
| 2 | Shared tables, worker pool (control block, chunks, levels, inline fallback), isolation headers on the dev server, the Experimental row; poses and bone rows for every actor kind on it, palettes in GPU layout | Bit-identical palettes with 0 and N workers; worker heap does not grow over 10,000 frames; a killed worker falls back and reports; `writeBuffer` from shared memory confirmed |
| 3 | GPU-driven draw path on the same tables | Pixel parity with today's renderer; draws fall towards the mesh count; main-thread draw path falls |
| 4 | Particles, presentation and cloth on the workers (can run beside step 3) | Particle, presentation and cloth tests exact inline; agreed random-order behaviour threaded |
| 5 | The pipelined schedule, Experimental | Matches fork-join apart from the documented timing; frame rate rises |
| 6 | Production: isolation headers on the page and every asset origin; the default decided by the owner | Production build isolated; the threaded path matches the serial path, or stays an Experimental row |

### 6.1 Step 1 result (2026-10-21)

`characterRadius` keeps each clip channel's largest key value per values
array (`character-bounds.ts`); the renderer keys bind bounds by the nodes
and primitives a clip admission keeps (`characters.ts` `bindBoundsOf`).
Both give bit-identical results (`character-bounds-exact.test.mjs`).

Bench, still, `--near` a first-ring crowd player, both trees with the
256 MiB render budget and every actor drawn, two rounds each back to back:

| | Base | Step 1 |
| --- | --- | --- |
| fps | 18, 18 | 21, 20 |
| Main thread ms per frame | 52.0, 50.0 | 44.7, 47.8 |
| Labels and portraits ms | 2.75, 2.85 | 0.40, 0.49 |
| Character presentation ms | 20.9, 19.1 | 18.7, 18.7 |

CPU self time: `characterRadius` 48.7 to 3.9 ms/s, `registerClip` 28.0 to
4.5 ms/s. A comparison with the old 64 MiB budget is invalid: it deferred
197 actors and drew 623 draws instead of about 2,100.

The profile after step 1 (21 fps, so 21 ms/s is about 1 ms per frame):

| Work | ms per frame | Note |
| --- | --- | --- |
| `worker.onmessage` (`simulation/host.ts`) | 2.4 | Main thread receiving the simulation worker's structured-cloned world batches |
| `worldDelta`, `walkingLocation`, `worldVector`, `hypot3`, `actor-motion` `present` | about 8 | Per-actor movement presentation |
| `materialize` (CPU poses) | 2.3 | Most poses already sample on the GPU; CPU poses serve cloth and sockets |
| Cloth `step` and `cloth-vertices` `update` | 3.0 | Per cloth wearer |
| Garbage collection | 2.1 | |
| `createGpuClipPlan` | 1.2 | Churn on clip admission, like step 1's |

### 6.2 Step 2, part 1 result: flat walking paths (2026-10-22)

The movement presentation's chain searches (`walkingLocation`,
`nearestWalkingPose`, `walkingPose`, `recoverWalking`) moved onto flat
arrays (first `foundation/gameplay/walking-path.ts`; part 2b moved them
into the frame kernels as `foundation/kernels/walking-chain.ts`).
`pose-presentation-flat-walk.test.mjs` drives the current module and a
frozen copy (`tests/fixtures/pose-presentation-before-flat-walk.ts`) with
seeded walks, receipts, stalls and carries, outdoors and in a dungeon,
and requires every drawn pose bit for bit; deliberate one-ulp mutations
of each searched function fail it.

Bench, still, two rounds back to back, everything else equal:

| | Base | Flat walk |
| --- | --- | --- |
| fps | 23, 22 | 28, 26 |
| Main thread ms per frame | 40.9, 43.1 | 32.7, 35.4 |
| Character presentation ms | 14.4, 15.5 | 9.1, 9.1 |

The pose presentation is now about 2.6 ms a frame in all. What remains,
at 23 fps: `@character-upload` 10 to 11 ms, CPU poses about 4, cloth about
3, movement presentation about 2.6, receiving the simulation worker's
world batches about 2.3, particles 2 to 4 by scene, garbage collection
about 1.3.

### 6.3 Step 2, part 2a: the frame worker machinery (2026-10-22)

- `foundation/workers/frame-jobs.ts` (stateless): the control block
  layout, publishing a phase, claiming chunks, the worker loop
  (`serveFrameJobs`), recovery of a stalled worker's chunks
  (`finishFramePhase`) and the CPU-count rule (`frameWorkerCount`: Auto is
  `min(8, threads - 3)`). A claim is a compare-and-swap on a word holding the
  phase generation and next chunk, so a late worker never claims from a
  phase it has not read; descriptors and done counts alternate between two
  slots.
- `runtime/frame-workers/frame-workers.ts`: owns the workers and the shared
  control block; `run( kernel, chunks, local )` publishes a phase, claims
  chunks on the main thread beside the workers and joins. Without isolation
  or with the setting off there are no workers and the same code runs every
  chunk on the main thread. A join waiting past 250 ms retires the workers
  and the phase finishes on the main thread.
- `runtime/frame-workers/worker/entry.ts`: one start message, then shared
  memory only; no kernels are registered yet (part 2b adds movement).
- Experimental > Other > "Worker threads": Off (default), Auto, 1, 2, 4, 8;
  read at startup. The dev server and preview send the isolation headers.
  `SharedArrayBuffer` and `Atomics` are capability-owned
  (`verify-capabilities.mjs`).
- `frame-jobs.test.mjs` runs the shipping loop on Node worker threads: 400
  phases with 4 workers racing the owner, every chunk exactly once with its
  phase's kernel (10 of 10 repeated runs clean); a throwing chunk fails its
  phase without hanging the join; the owner finishes a stalled worker's
  chunk.
- Browser: `town-crowd-bench.mjs --frame-workers auto` on the 24-thread
  machine reports the page isolated and 8 of 8 workers ready, with the game
  running normally.

### 6.4 Step 2, part 2b: movement presentation on flat records (2026-10-22)

The whole movement presentation now runs as a frame kernel, for every
character kind (player, monster, NPC, pet), still inline on the main
thread:

- `foundation/kernels/` (rules in its `AGENTS.md`): `pose-record.ts`, one
  actor's 228-double record (untimed track, sampled track, this call's
  input, target, frame time, drawn pose); `pose-kernel.ts`, the port of
  `pose()` onto a scratch copy of the record; `flat-pose.ts`, the pose
  arithmetic; `walking-chain.ts`, the chain searches over the walk arena.
- `runtime/characters/pose-presentation.ts` is the record owner: a slot per
  gid, each call's input and target written into the record, the kernel run
  on a copy, the drawn pose handed back as an object (same API as before).
  Chains are written once per published chain object into the walk arena,
  which compacts to its live chains when full.
- Identity comparisons became ids and flags (an input's leg end, a model
  that was the latest sample itself, a track replaced this call); a missing
  revision is `MISSING_REVISION` and moving is three-state, so every
  comparison keeps the object code's result.
- `pose-presentation-flat-walk.test.mjs`: three bit-for-bit comparisons
  against the frozen object code (seeded walks; every input shape:
  missing fields, reused or fresh leg ends, skill clocks, corridors, turns,
  previous paths, relocations, reasons, settled translations, a late clock
  origin, retained sets; a turn through its corner). 21 of 23 deliberate
  one-point mutations across the kernel fail it; the two that do not are a
  1 ms move of the late-sample threshold and the held-path bookkeeping,
  which only shows when a later correction lies on an older held path.
- Bench, still, two rounds back to back against the frozen original:
  22, 21 fps to 26, 27 fps; main thread 42.8, 43.8 to 35.1, 33.8 ms;
  character presentation 14.5, 16.2 to 9.1, 9.3 ms. Part 1 measured the
  same gain, so moving the state into records costs nothing.
- `town-crowd-bench.mjs --monsters CODENAME:COUNT` tops a passive monster
  population up near the observer with GM `/LOADMONSTER`. The scratch
  character must hold GM rights, which the GameWorld grants at startup
  (`SRO_GM_CHARACTERS`), so it needs one restart after `asd2` is created.

### 6.5 Step 2, part 2c: the movement poses on the frame workers (2026-10-22)

- **Speculation with rollback.** `pose()` is called more than once per
  character per frame (effect anchoring, then actor motion, then a re-pose
  after a carry), and a repeated call is not provably a no-op. So
  `prepare()` (called by `presentation-events.ts` just before effects
  anchor, for the characters it is about to pose) computes each character's
  next two calls in one `KERNEL_POSE` phase, keeping the record before them
  and after the first as snapshots. A later call takes a precomputed result
  only when its arguments match bit for bit; any other call, a carry, new
  samples, a retained set or a new clock origin first rolls the record back
  to the state after the last result handed out. Every drawn pose is the
  one the calls in order would draw on one thread.
- **Kernel memory** (`frame-kernels.ts`): records, snapshots, walk arena and
  request list, owned by the frame workers; growable `SharedArrayBuffer`s
  when workers run, plain buffers on one thread. Every thread keeps
  **fixed-length** views and remakes one only when its table grew: a view
  that tracks a growable shared buffer's length ran a loop about 33 times
  slower than a fixed-length one (Node 24: plain 74 ms, fixed SAB 75,
  growable SAB with a fixed view 76, with a length-tracking view 2,443;
  resizable ArrayBuffers 257 to 314). The arena compacts in place only while
  nothing is pending, and compaction remaps every record's input chain.
- **Proof.** `pose-presentation-flat-walk.test.mjs` now also drives
  `prepare()` against the frozen object code through every way a
  prediction can miss (another target, settled calls, carries, unposed and
  unprepared characters, extra calls) and through arena compaction in the
  middle of a prepare; four deliberate breaks of the bookkeeping and the
  compaction fault each fail it. `pose-kernel-threads.test.mjs` runs 300
  characters for 240 frames with the phase on 4 real worker threads over
  growing shared tables against one thread, bit for bit (10 of 10 runs).
- **Scaling** (`tools/perf/bench/frame-kernel-bench.mjs`, Node worker
  threads, ms per frame on the main thread):

  | Characters | Setup (main only) | Phase, 0 workers | 1 | 2 | 4 | 8 | Join wait |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | 200 | 0.26 | 0.55 | 0.32 | 0.25 | 0.25 | 0.22 | <= 0.06 |
  | 1000 | 1.4 | 2.35 | 1.26 | 0.89 | 0.63 | 0.50 | <= 0.04 |
  | 4000 | 7.5 | 9.78 | 5.04 | 3.48 | 2.23 | 1.50 | <= 0.03 |

  The kernel phase scales 6.5 times at 4,000 characters with 8 workers; fork
  and join cost hundredths of a millisecond. What does not scale is the
  setup: writing each character's sample input from JavaScript objects into
  its record. The fix is the simulation worker writing those inputs into
  the shared table directly (it also removes the main thread's 2.4 ms of
  world-batch decoding).
- **Browser** (town crowd, 214 players, still, back to back): 8 of 8
  workers ready, about 6,600 phases a session (one a frame), 128 to 136 ms
  of join wait in all, none retired. Off 30, 26 fps; auto 27, 27 fps;
  character presentation 8.7, 9.3 ms off against 8.3, 8.2 auto. The poses
  are a small part of the frame since part 1; the machinery is proven, and
  the next kernels carry the gain.

### 6.6 Step 2, part 3a: walking histories leave the worker flat (2026-10-22)

- **Measured first.** World batches captured in the browser with 214
  players walking (60 batches, about 45 moving states each): every moving
  state carried its whole walking history, 194 point objects on average.
  Histories were 87% of a batch's bytes and 80% of its structured-clone
  time (3.63 ms a batch whole, 0.73 ms without them). A history is a new
  array at every step, so the main thread also copied every point into the
  walk arena again.
- **Change.** `entities.ts` `take()` publishes each history as one
  `Float64Array` in the walk arena's entry layout (point count, then 5
  doubles a point), flattened once per history
  (`walking-history.ts` `publishWalkingChains`); the main thread copies it
  into the arena with one `set()`. The simulation worker keeps its own
  `Pose[]` histories, which its movement owners extend; on the main thread
  `MovementPath` and `MovementTransition` carry `walkingChain`, and
  `SampleInput.walkingChain` replaces `walkingPath`. No isolation and no
  setting: the drawn poses are the same bits, so everyone gets it.
- **Proof.** The differential tests hand the frozen object code `Pose[]`
  chains and the current code the same chains flat, through the shipping
  flattener (`walk-scenario.mjs` `chainOf`): every pose bit for bit, on
  worker threads too. `walking-chain-publication.test.mjs`: the flat numbers
  bit for bit, every other field and object kept (leg ends keep their
  identity), the worker's own value untouched, and a batch through `take()`,
  a structured clone, `apply` and the sample builder. Five deliberate breaks
  (the flattener swapping y and z, `take()` publishing the worker's values,
  the sample builder ignoring a transition's chain, a transition left
  unpublished, the arena copy dropping a point) each fail a test.
- **Browser**, CPU profiles back to back against the previous commit, ms
  per second of main thread: `worker.onmessage` (decoding world batches)
  50.2 to 15.1, garbage collection 33.8 to 25.9, `chainAt` 2.9 to 0.55;
  about 2 ms a frame. The captured batches clone in 0.99 ms instead of 3.63.
  Frame rate, still, 20-second rounds alternating with the previous commit:
  25, 29, 28 fps against 25, 25, 26 (two 8-second rounds, 24, 23 against
  25, 23, are within the crowd's noise).
- **The setup did not move in Node** (`frame-kernel-bench.mjs`: 0.28, 1.65
  and 8.5 ms at 200, 1,000 and 4,000 characters): its chains are short and
  seldom republished. Its profile at 4,000 puts the setup in `prepare`
  copying each whole 228-double record into its snapshot (129 ms/s),
  `writeInput` reading the sample objects (127 ms/s) and the leg-end
  identity map (38 ms/s); those, not chains, are what input rows written
  by the worker would remove.
- **Why not straight into shared memory yet.** With flat chains, what is
  left of the histories is 0.26 ms of clone a batch (the main thread pays
  about half) and 0.016 ms of arena copy. Writing them into the shared
  arena would save that, but needs a lifetime protocol: the main thread
  keeps an idle character's last chain as long as its record names it, so
  the worker cannot reuse that memory until told. The larger remainders of
  a batch are the local player's gameplay snapshots (0.45 ms a batch) and
  whole-entity state events (about 0.3 ms).

### 6.7 What else limits the frame: GPU, GPU process, simulation worker (2026-10-22)

Before the draw path, the limits a 10 ms (100 fps) frame would meet besides
the main thread. Town crowd, 214 players, still, 1600 x 900, AMD Radeon
RX 6900 XT, after part 3a (main thread about 35 ms a frame).

- **GPU execution** (`town-crowd-bench.mjs --gpu`, `tools/perf/core/gpu-timing.mjs`:
  timestamps around every render and compute pass the page encodes, the
  renderer's own `?gpu-timing=1` timer leaving water reflection, bloom, HDR
  and the final passes out). Busy time a frame, the sum of its passes:

  | Settings | Mean | p50 | p95 | Largest passes (ms a frame) |
  | --- | --- | --- | --- | --- |
  | New player defaults | 4.9 to 5.2 | 5.1 to 5.5 | 5.8 to 6.0 | main pass 3.0 to 3.3, skeletal animation 1.7 |
  | High preset (`--preset 2`) | 6.6 | 6.7 | 7.9 | main pass 2.3, water reflection 2.2, skeletal animation 1.7 |

  On this card the GPU allows 100 fps. A card with a third of its speed
  would need 15 to 20 ms and limit the frame to 50 to 65 fps, so for most
  players 100 fps also needs GPU work (the water reflection redraws the
  scene, the main pass draws about 1,600 draws).
- **Chrome's GPU process** (`--trace`, `CrGpuMain`): 9.0 ms a frame, 22% busy
  at 24 fps, almost all `GpuChannel::ExecuteDeferredRequest`: validating
  and translating the page's WebGPU commands. It runs beside the main
  thread, but at this command volume it limits the frame to about 110 fps.
  The draw path's fewer draws and reused bundles are what shrink it.
- **Simulation worker** (same trace): 67% busy, 28 ms of its own time a
  frame: `navContactDetail` 269 ms/s (navigation queries for every 2-unit
  sample of each remote walker's history), journal costing (`jsonChars`)
  93 ms/s, navigation `segment` 68 ms/s. It keeps up with 214 players on
  its own thread; it is a limit for more players, not for the frame rate.

### 6.8 Step 4, part 1: character cloth on the frame workers (2026-10-22)

- **Decision first** (section 7, item 1): cloth and particles on the
  workers need only look the same, so each cloth wearer draws from its own
  CRT stream (seeded from gid and primitive). Worker threads off keeps the
  object path and the shared stream unchanged.
- **Kernel** (`foundation/kernels/cloth-kernel.ts`, `cloth-record.ts`):
  `cloth-vertices.ts` update and `cloth.ts` advance and step on one
  wearer's flat record, expression by expression. A wearer's positions and
  previous positions are double-buffered, so a chunk run again after a
  stalled worker starts from the same state. Programs (rest shape, skin,
  mobility, pins, constraints in solve order) are written once per cloth
  mesh and freed with its last wearer.
- **Owner** (`renderer/characters/cloth-wearers.ts`, since moved to
  `foundation/animation`): `drawCloth` admits a
  wearer per cloth primitive of a batch and requests its frame; `prepare`
  runs one `KERNEL_CLOTH` phase after the groups and uploads each wearer's
  packed vertices. A wearer is released with its batch.
- **Proof**: `cloth-kernel.test.mjs` gives the object cloth the wearer's
  stream and requires every packed vertex bit for bit (skinned or not,
  normals or not, option changes, stalls, wind, a shared program, released
  and reused state), a chunk run twice, and 1,500 wearers on 4 threads over
  growing tables. `character-cloth-workers.test.mjs` runs the shipped
  renderer: no shared-stream draws, every non-cloth primitive's draws as
  before, threads equal to one thread. Deliberate breaks fail them.
- **Browser** (214 players, 120 cloth wearers, CPU profiles, ms per second
  of main thread): character cloth `step` + `update` about 65 to the
  wearers' share the main thread runs in the phase (about 11), `request` 5
  and `writeVertices` 14 (4 before: the vertices are now written on other
  cores, so the main thread's copy reads them from another core's cache;
  Chrome copies shared buffers as fast as ordinary ones, 0.1 ms per
  3.6 MB). World cloth (flags) still runs the object path, about 17 ms/s.
- **Frame rate**, 20-second rounds alternating Worker threads Auto and Off
  (both include the movement poses on the workers when on): 31, 32, 37 fps
  against 30, 30, 29; main thread 31.0, 29.8, 26.3 ms against 32.2, 32.5,
  33.4.
- **Next**: start the cloth phase early and join it late, so the main
  thread builds the other groups while the workers simulate instead of
  running a share of the phase itself.

### 6.9 Step 4, part 2: phases overlap the main thread's work (2026-10-22)

- **Fork and join.** The frame workers gain `fork` (open a phase the
  workers start at once) and `join` (run what they have not claimed, then
  wait) beside `run`. With Worker threads on, `prepare` builds the cloth
  wearers' groups first, forks the cloth phase, builds every other group
  while the workers simulate, then joins and uploads; each group's draws
  keep their place (`character-cloth-workers.test.mjs` holds the object
  path's draw order with cloth and plain groups interleaved).
- **Every posed character predicted.** The pose phase predicted only moving
  characters, about 23 of 214: actor motion's call for every other
  presented character ran the kernel inline, 158 calls a frame and 40 ms/s
  of `presentPose` on the main thread. The characters step now prepares,
  right after choosing the presented characters, the calls effect
  anchoring and actor motion will make, and forks the phase; the first
  call that needs a record joins it. Counted in the crowd: 0 misses and 0
  inline calls in 142 frames. `presentPose` on the main thread fell to
  9 ms/s (the share the main thread still runs when the first call joins).
- **Frame rate**, 20-second rounds alternating Worker threads Auto and Off:
  32, 32, 32 fps against 28, 26, 28; main thread 29.9, 30.4, 30.2 ms
  against 34.1, 36.9, 34.5.
- **Where the main thread goes now** (Auto, ms per second of main thread):
  character particles 127 (`advanceParticles`, holder sockets included),
  CPU poses 105 (`materialize`, mostly for the 120 cloth wearers whose body
  palettes come from the CPU) and their palettes 54, actor presentation
  125, the draw path's group building about 200, world cloth 17.

### 6.10 Step 4, part 3: character poses on the frame workers (2026-10-22)

- **Kernel** (`foundation/kernels/skeleton-kernel.ts`, `skeleton-record.ts`):
  `animation-pose.ts` materialize on one pose's flat record: rest reset,
  layer sampling (linear, step, cubic, quaternion slerp with its bracket
  cache), event-before-timed blending with headroom, the bone rotator, and
  parent-first locals and globals, the pose math repeated on offsets with
  the same arithmetic. Restartable: `R_BUSY` recomposes a chunk a stalled
  worker left; `R_CHANGED` only ever gains.
- **One pose code.** `animation-pose.ts` takes an optional `PoseSkeleton`:
  its arrays become fixed views of the shared state and `materialize` goes
  through the kernel; layer resolution, palettes, sockets, body volume and
  rotators stay the same code. Without one nothing changes.
- **Owner** (`renderer/characters/skeletons.ts`): a skeleton a model, a clip
  entry a sampled clip (key clocks shared as the timelines share them),
  state and scratch a pose; used only when the frame workers' tables grow
  in place (shared memory). `prepare` collects twice: while it evaluates
  the attachment owners and mounts `advanceParticles` reads sockets of,
  and around `evaluateNeededPoses`; each time it forks one
  `KERNEL_SKELETON` phase and the first palette or socket read joins.
  Poses left to the GPU are queued too, so the cloth wearers' CPU palettes
  are ready when read.
- **Proof**: `skeleton-kernel.test.mjs` (flat against object poses, every
  palette and socket bit for bit, on threads, with chunks run twice; seven
  deliberate breaks fail it) and `character-cloth-workers.test.mjs`
  (skeleton poses on threads against object poses through the shipped
  renderer, digest for digest).
- **Browser**: pose work on the main thread 78 to 16 ms/s including joins;
  `writeBatchRows` 107 to 70.
- **Frame rate**, 20-second rounds alternating Worker threads Auto and Off:
  34, 38, 37 fps against 27, 26, 26; main thread 28.1, 25.5, 26.3 ms
  against 36.2, 37.5, 37.3.
- **Main-thread churn found on the way** (not threading): every clip
  admission builds a new `clips` array, so the GPU clip plan of the whole
  set is rebuilt and validated again (`createGpuClipPlan`, 21 ms/s).

### 6.11 Step 4, part 4: clip catalogs grow in place, world cloth on the workers (2026-10-22)

- **Clip catalogs** (both settings): a lazily admitted action makes a new
  catalog whose prefix is the last one. Its GPU clip set, bounds envelope
  and source charge are now built from the prefix's plus the new clip
  (`foundation/animation/clip-catalogs.ts`); the GPU clip set reserves its
  header to the next power of two, so an extension copies the previous
  buffer as it is. The envelope is kept per catalog, not walked again for
  each assembly of the body. Was 44 ms/s of main thread (clip plan 21.5,
  radius 7, charge 6, the rest admission) while actions kept arriving.
  `clip-catalogs.test.mjs` compares every step of grown catalogs with
  fresh builds.
- **World cloth** (Worker threads on): the cloth wearer owner moves to
  `foundation/animation/cloth-wearers.ts` and takes a bank, so the world's
  flags and banners are wearers in their own tables (`worldCloth*`,
  `KERNEL_WORLD_CLOTH`), admitted, reset and released by the world alone.
  The kernel reports whether a step left a pin off its anchor
  (`N_SETTLED`), so a world mesh still holds between 20 Hz steps exactly
  when its object cloth would. Wearer vertices upload through
  `streamVertices` (no draw mirror copy).
- **Frame rate**, 20-second rounds alternating Worker threads Auto and Off:
  39, 44, 39 fps against 29, 29, 30; main thread 24.6, 22.1, 24.9 ms
  against 33.9, 33.8, 32.5.
- **Next: particles.** The particle graphs (`advanceParticleGraph` 58
  ms/s, holder transforms 20, graph records 20) are the largest coherent
  block left. They are independent once created (each graph keeps its own
  random cursor into the shared read-only table), so they port to a flat
  kernel like the skeletons: element slots per emitter, parents and groups
  as indices, double-buffered for restarts, the GPU records written by the
  kernel at each tick.

### 6.12 Step 4, part 5: particle graphs on the frame workers (2026-10-22)

- **Kernel** (`foundation/kernels/particle-kernel.ts`, `particle-step.ts`,
  `particle-output.ts`, layout `particle-record.ts`): `particle-graph.ts`
  advanceParticleGraph with `particle-program.ts` initializeParticle and
  advanceParticle, commands, vectors, emission, and `particle-records.ts`
  writeGraphRecord, on one graph instance's flat state. An element slot
  per emitter capacity and the root; parents, group owners and siblings
  are indices, groups keep Map order. The object graph's numbers are
  doubles and its Float32Arrays floats, so every store rounds where it
  did. Double-buffered, copying only each emitter's used rows; births out
  of slot order clear the holes they skip, so a run again finds none.
- **Owner** (`renderer/characters/particle-graphs.ts`): a graph's
  definition (emitters, programs, commands, lists; which emitters are
  drawn) is encoded once; an instance lives as long as the actor's
  particle history. `advanceParticles` requests the graphs a tick or a
  region crossing falls due for and forks one `KERNEL_PARTICLES` phase;
  `prepare` plans the frame and evaluates poses while the workers tick,
  joins before the poses' phase, then writes each holder follow. The
  particle streams copy the kernel's records (`writeFlatRow`). Models that
  draw ribbons keep object graphs (the ribbon reads elements here).
- **Random draws**: a graph keeps its own cursor into the shared table, as
  before. Graphs admitted in one frame step the shared cursor apart (they
  tick later, together), and after the phase the shared cursor is the last
  graph's, where the object path leaves it.
- **Proof**: `particle-kernel.test.mjs` drives 60 seeded graphs that use
  every feature (`tests/helpers/particle-graph-cases.mjs`) through both and
  requires every element field, group and live GPU record bit for bit, on
  threads and with chunks run twice; 9 of 10 deliberate breaks fail it (the
  tenth needs a looping element born behind a missing parent).
  `particle-graph-workers.test.mjs` runs the shipped renderer both ways and
  compares every presented stream, through a rewind.
- **Browser**: `advanceParticles` 89 to 31 ms/s (the holder sockets, 20,
  stay on the main thread); `writeParticleRow` 34 to 12.
- **Frame rate**, 20-second rounds alternating Worker threads Auto and Off:
  46, 51, 48 fps against 29, 28, 28; main thread 20.8, 18.7, 20.0 ms
  against 33.1, 34.1, 34.7 (before: 39, 44, 39 fps on 24.6, 22.1, 24.9 ms).
- **Where the main thread goes now** (Auto, ms/s): actor presentation 127
  (`actor-motion.ts` present 52 of it), group building 167, uploads about
  85 (`writeBuffer` 49, the upload arena's copies 25, of which cloth
  vertices 22, `copyBufferToBuffer` 11), UI about 50, simulation snapshot
  decoding 21, holder sockets 20, garbage collection 18.

### 6.13 Step 4, part 6: palettes in the skeleton phase, more overlap, presentation churn (2026-10-22)

- **Palettes** (`skeleton-kernel.ts`, `skeleton-record.ts`,
  `animation-pose.ts`, `renderer/characters/skeletons.ts`): a skeleton also
  holds its model's palette bindings (joints, inverse binds) and a pose its
  body thickness and one palette a binding. The phase writes them for the
  poses whose palettes the main thread reads: a cloth batch's
  (`readsPalettes`) and evaluations the GPU does not take. `palette` copies
  them while they are the current version; a body volume changed after the
  inputs were queued leaves them unused. Bit for bit the object code's
  (`skeleton-kernel.test.mjs`). `palette` on the main thread 23 to 12 ms/s,
  what is left being the copy out of shared memory.
- **Overlap**: the groups without cloth build while the skeleton phase
  runs; the cloth groups then read its palettes and fork the cloth phase,
  which runs while the renderer goes on to shadows, labels and the
  interface, until `characters.finishCloth` joins it just before encoding
  (a frame that never got there uploads at the next prepare). The material
  clocks step during the owners' phase. Kernel work the main thread did
  inside joins: 46 to 34 ms/s, the skeleton phase's 12.8 to 2.2.
- **`writeBuffer` does not take a growable shared buffer.** Chrome refuses
  it ("The provided [AllowShared] ArrayBuffer value must not be
  resizable"), so the cloth vertices still reach the GPU through the upload
  arena's copy. Section 4's note holds for fixed-size shared memory only.
- **Churn, exact, for everyone** (ms/s in the town crowd): the material
  clocks' charge per model, cached (10); `hostMotions` passing over other
  hosts' effects first (12 to 6); a body's clip list asked through a set,
  about 20 scans of hundreds of names an actor a frame (about 150 ns a
  scan); the per-frame motion names (`native:set:state`, the weapon motion
  set, the preview idle) made once, so catalog lookups stop hashing new
  strings; `evaluateNeededPoses` sorting on keys read once (9); the group
  order's effect and blend flags, cached (7); `admitBatch` comparing gids
  instead of building a signature string; the cloth wearers' views
  refreshed only when their tables grow (7).
- **Not ported: the actor presentation itself** (`actor-motion.ts`,
  `actor-appearance.ts`, `presentation-events.ts`). Its time is string and
  Map lookups, object building, sounds, effects and events, not
  arithmetic; a flat kernel would be a rewrite of that logic with little
  to run faster. Its churn was cut instead (above).
- **Frame rate**, 20-second rounds alternating Worker threads Auto and Off:
  54, 55, 59 fps against 33, 35, 33; main thread 17.8, 17.6, 16.3 ms
  against 29.8, 27.8, 29.6 (before: 46, 51, 48 against 29, 28, 28 fps).
- **Where the main thread goes now** (Auto, ms/s): character prepare about
  385 (group building 157, needed poses 48, particles 40), draw encoding
  151, actor presentation about 125 (`actor-motion.ts` present 53 of its
  own), UI about 115 (its step 73, the renderer's copy 20, the device's
  packing 21), uploads about 87 (`writeBuffer` 51, of which CPU palettes
  of cloth batches 12, the arena's copies 24, `copyBufferToBuffer` 12),
  simulation snapshot decoding 20, garbage collection 16.

### 6.14 Step 4, part 7: a casting crowd's effects (2026-10-22)

The town crowd restarted walking and casting (Fire Force): about 300 skill
effect actors where the still crowd had 85, the 512-actor room full, 3,366
draws a frame. Particle presentation became the main thread's largest
item (Auto, ms/s): `drawParticles` 105 (the device's `presentParticles`
40, the actor rows 38), the device's particle encoding 83 (its buffer
copies 31, `writeBuffer` 22).

- **The deferred particles' continuation is skipped when it would draw
  nothing** (`renderer.ts`, `deferred-particles.ts` `drawing`): after the
  occlusion query the renderer prepared the whole crowd a second time even
  when no queued emitter draws (occluded, faded out, or night-only by day).
  Exact: every pass presents the same streams
  (`deferred-continuation.test.mjs`); by day in Jangan the continuation
  drew nothing in any of about 450 frames, and with night forced its
  lanterns look the same skipped or not.
- **A skill effect instance was a model of its own**
  (`presentation-auxiliary.ts` assembles `effect:<gid>:<program>`), so
  every cast batched alone: one batch, one draw a primitive and one
  particle stream an emitter an instance. In the crowd a frame presented
  about 405 particle streams for about 420 rows, the Fire Force "keep"
  program alone in 58 batches.
- **Experimental "Batched effects"** (port-only, off): the instances of a
  program share `effect:<program>`, so a crowd's casts of it draw as one
  batch. A batch's rows present what the instances' own batches did,
  through casts that start, end and change rows
  (`batched-effects.test.mjs`, with and without the frame workers); only
  the rows' order differs, so overlapping translucent instances can blend
  in gid order where each took its own place in the far-to-near order.
  10-second rounds in the crowd (about 140 bodies and 80 effects in view),
  alternating: Auto 80, 85, 83 fps against 70, 74, 70 (main thread 11.9,
  11.2, 11.5 ms against 13.7, 12.9, 13.6); Off 44.5, 43.8 against 41.0,
  41.8.
- **What the device's particle encoding still does a frame** (counted in
  the crowd before batching): about 405 streams in one dispatch, 1,030
  `copyBufferToBuffer` (each stream's instances and palettes back into its
  draw's buffers, and 217 streams' dirty records), the material tables
  uploaded again (58,600 floats, unchanged since the stream began) and the
  dirty records copied three times on the CPU. Batching cuts the stream
  count; binding the draws to the arena's output would remove the copies
  back, and a resident material table the uploads.

## 7. Open decisions for the owner

1. **Random order. Decided 2026-10-22:** cloth and particles on the frame
   workers need not be bit-identical, only look the same; the frame rate
   decides. Each cloth wearer and each effect draws from its own random
   stream, so no worker waits on another and the main thread draws nothing
   for them. This runs only with Worker threads on (Experimental, off by
   default); with it off the frame keeps today's exact code. The options
   that were weighed, best first:
   - **Pre-drawn per actor.** The main thread draws each actor's random
     numbers from the shared stream, in today's order, into the actor's
     input slot before the fork. Exact, but only where the count of draws
     is known in advance. For cloth it is (one gust per step). For
     particles it depends on the data.
   - **Per-actor streams seeded from the shared one,** as the parked
     particle pool did. Deterministic and nearly identical, but not bit
     for bit, so the path stays Experimental.
   - **Keep that kernel on the main thread.**
2. **Cross-origin isolation in production.** The page and every asset
   origin need the headers. Anything the page embeds from another origin
   without CORP or CORS stops loading. This needs an inventory before
   step 6.
3. **Default.** Whether the threaded path, once identical, becomes the
   default for everyone, or stays a player option.

## 8. Measuring

Both tools are in `tools/perf/bench` and run from `apps/client-next` with
the local cluster up and a character logged in:

```
node tools/perf/bench/town-crowd.mjs --near NAME --count 200
node tools/perf/bench/town-crowd-bench.mjs --near NAME --seconds 8 [--turn | --walk] [--spans] [--cpu | --trace] [--heap] [--clone-cost]
```

`town-crowd.mjs` holds the players until Ctrl+C. The bench writes
`temp/artifacts/town-crowd/crowd-<scenario>.result.json` and any captures
beside it; analyse them with `tools/perf/analyze/profile.mjs` and
`trace.mjs` (`docs/PROFILING.md`). A trace shows the workers' threads next
to the main thread, which is how a step proves that the work moved and
that the join does not wait.

The crowd moves on its own clocks, and the machine is shared. Compare runs
made back to back, and two trees by pointing
`SRO_PROBE_CLIENT_NEXT_BASE_URL` at the other tree's dev server.
