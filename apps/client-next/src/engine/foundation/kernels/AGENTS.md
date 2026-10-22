# AGENTS.md - frame kernels

Area rules for `src/engine/foundation/kernels/`. The client rules in
[`../../../../AGENTS.md`](../../../../AGENTS.md) and the repository rules
apply too. Why this folder exists: [docs/CLIENT_WORKERS_PLAN.md](../../../../../../docs/CLIENT_WORKERS_PLAN.md).

A frame kernel is per-actor frame work that any thread can run: the main
thread inline, or a frame worker (`runtime/frame-workers`). That is why it
looks different from the rest of the client:

- **Flat memory only.** A kernel reads and writes numbers in typed arrays:
  one actor's record copied into the thread's scratch, plus shared
  read-only data such as the walk arena. No objects, strings, Maps or
  closures cross into it, and it returns results through the scratch.
- **No allocation.** No `{}`, `[]`, spreads, `map`/`filter`, closures or
  object-returning helpers in a kernel's path. A worker that allocates
  nothing never pauses for its garbage collector.
- **No module state.** Layout offsets are literal constants (the ownership
  gate accepts nothing else); scratch registers are offsets, not variables.
- **Bit-identical to the code it replaces.** Keep the original's operation
  order expression by expression. Where the original compared objects by
  identity or let a field be undefined, use an id, a flag or a documented
  encoding with the same comparison result (`pose-record.ts`). A kernel
  lands with a differential test that drives it and a frozen copy of the
  original (`tests/fixtures/*-before-*.ts`) and requires identical bits.
- **One record per actor, whole.** A thread copies the record in, runs the
  kernel, and copies it back. The record's owner (a runtime module) writes
  its inputs and reads its outputs; nothing else touches it. A record too
  large to copy (a cloth wearer's vertices) is double-buffered instead:
  the kernel reads the current half and writes the other, and the owner
  switches halves after the phase.
- **Restartable.** A chunk a stalled worker left is run again by the main
  thread, so a kernel never changes what it reads.
- **Same draws, same bits.** Where the owner decided a kernel's random
  numbers may come from the actor's own stream instead of a shared one
  (cloth, docs/CLIENT_WORKERS_PLAN.md section 7), the kernel still matches
  the original bit for bit given the same draws, and its test proves it.

Run the differential tests after any change here:

```
node --test tests/runtime/pose-presentation-flat-walk.test.mjs tests/runtime/cloth-kernel.test.mjs
```
