/*
===========================================================================

cloth-record.ts - one cloth wearer as flat numbers

The layout cloth-kernel.ts reads and writes for each cloth primitive an
actor wears. Three tables (frame-kernels.ts):

- clothPrograms (doubles): a mesh's cloth, written once per primitive and
  shared by every wearer of it: a P_HEADER header, then, for n vertices
  and m constraints, its rest positions (3n), normals (3n), skin joints
  (4n) and weights (4n), mobility (n) and pins (n), and its constraints
  (3m: a, b, rest length) already in solve order.
- clothRecords (doubles): one CLOTH_RECORD a wearer: where its program and
  state are, this frame's inputs, and its clock and random state twice,
  current (W_*) and next (N_*).
- clothState (floats): a wearer's arrays: two halves of positions (3n) and
  previous positions (3n), skin anchors (3n), its packed vertex stream
  (geometry-vertices.ts, 14n) and this frame's palette (16 a joint).

The kernel reads the current half and writes the other and the N_* fields,
so a chunk run again after a stalled worker starts from the same state;
the owner (cloth-wearers.ts) switches halves after the phase.

===========================================================================
*/

// Program header, then the arrays in clothProgramOffsets order.
export const P_VERTICES = 0;
export const P_CONSTRAINTS = 1;
export const P_JOINTS = 2; // palette joints: 16 floats each
export const P_SKINNED = 3; // 1 when the mesh has joints and weights
export const P_FORCE_SET = 4; // 1 when the cloth authors its own force
export const P_FORCE = 5; // x, y, z
export const P_GRAVITY = 8;
export const P_GRAVITY_MOBILITY = 9;
export const P_WIND_MOBILITY = 10;
export const P_DAMPING = 11;
export const P_WIND_PERIOD = 12;
export const P_HEADER = 16;

// Wearer record: program and state, this frame's inputs, current clock and
// random state, and the next ones the kernel writes.
export const W_PROGRAM = 0; // offset of the program in clothPrograms
export const W_STATE = 1; // offset of the state in clothState
export const W_CURRENT = 2; // which half of positions and previous is current: 0 or 1
export const W_SECONDS = 3; // input: this frame's time
export const W_ENABLED = 4; // input: 1 when the cloth simulates this frame
export const W_DIRECTION = 5; // input: wind direction x, y, z
export const W_SPEED = 8; // input: wind speed
export const W_RANDOM = 9; // CRT rand() state, an unsigned 32-bit value
export const W_LAST_SET = 10; // 1 once the wearer has been updated
export const W_LAST_SECONDS = 11; // the time of its last update
export const W_ELAPSED = 12; // the step accumulator, ms
export const W_INITIALIZED = 13;
export const N_RANDOM = 14;
export const N_ELAPSED = 15;
export const N_INITIALIZED = 16;
export const CLOTH_RECORD = 20;

// Packed vertex stride (geometry-vertices.ts): position, normal, uv, color, mask uv.
export const CLOTH_VERTEX_FLOATS = 14;
// Palette floats a joint.
export const CLOTH_JOINT_FLOATS = 16;
