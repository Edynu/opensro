/*
===========================================================================

particle-record.ts - the particle graph kernel's flat layout

A particle graph (foundation/animation/particle-graph.ts) on flat memory,
for the frame workers (particle-kernel.ts). Five tables:

- particleDefs (doubles): one encoded definition per drawn graph (its
  ParticleEmitter[] and which emitters its primitives draw): a header
  (GD_*), one emitter record each (D_*), their programs (Q_*), commands
  (C_*), vector commands (V_*) and lists ([count, values...]).
- particleGraphs (doubles): one record per graph instance (G_*): where its
  definition, state and frames are, which half is current, and this
  frame's inputs.
- particleState (doubles): an instance's two halves of numeric state (a
  header H_*, each emitter's state S_*, then its elements E_* in slot
  order and the root last), then its scratch.
- particleFrames (floats): an instance's two halves of element matrices
  (F_*, the object graph's Float32Arrays, so stores round as they did),
  then the GPU records (particle-records.ts) of its drawn emitters' slots.
- particleRandom (floats): the shared native random table, read only.

An element's index is its emitter's D_BASE plus its slot; the root is the
index GD_ELEMENTS. Parents, group owners and siblings are such indices,
and -1 is none (an undefined reference in the object graph). A flag the
object graph left undefined is -1 (undefined program flags) or 0 (a field
that was absent).

The kernel reads the current half and writes the other (only each
emitter's used rows are copied), so a chunk run again after a stalled
worker starts from the same state; the owner switches halves after the
phase. The scratch and the records are written whole before they are
read, so a run again writes them again the same way.

===========================================================================
*/

// Doubles in a list's header: [count, values...].
export const LIST_COUNT = 0;
export const LIST_VALUES = 1;

// Graph definition header, then one D_* record offset per emitter.
export const GD_EMITTERS = 0;
export const GD_HORIZON = 1; // particle-graph.ts tickHorizon; Infinity when unbounded
export const GD_ELEMENTS = 2; // element slots; the root's index
export const GD_HALF_WORDS = 3; // doubles in one state half
export const GD_HALF_FLOATS = 4; // floats in one frames half
export const GD_SCRATCH_WORDS = 5; // doubles of scratch after the two halves
export const GD_RECORD_FLOATS = 6; // floats of GPU records after the two frames halves
export const GD_ELEMENTS_AT = 7; // element 0 in a state half
export const GD_HEADER = 8;

// Emitter record (ParticleEmitter).
export const D_PARENT = 0; // emitter index, or -1 for the root
export const D_FRAMES = 1;
export const D_SLOTS = 2; // its element slots: capacity ?? births.length
export const D_BASE = 3; // the element index of slot 0
export const D_LOOP = 4;
export const D_EMISSION = 5; // 1 with an emission (particle-emission.ts)
export const D_START = 6;
export const D_DURATION = 7;
export const D_PERIOD = 8;
export const D_LIMIT = 9;
export const D_RATE = 10;
export const D_COMMANDS = 11; // [count, count C_* records], or -1 without commands
export const D_PROGRAM = 12; // Q_* offset, or -1
export const D_MATRIX = 13; // 16 doubles, or -1
export const D_LOCAL_MOTION = 14;
export const D_SHAPE_MOTION = 15;
export const D_KEEP_MATRIX = 16;
export const D_KEEP_ORIGIN = 17;
export const D_POSITION_DEPTH = 18;
export const D_MATRIX_DEPTH = 19;
export const D_VELOCITY_DEPTH = 20;
export const D_FOLLOW_DEPTH = 21;
export const D_SCALES = 22; // list of 3-vectors
export const D_POSITIONS = 23; // list of 3-vectors
export const D_ROTATIONS = 24; // list of 16-matrices
export const D_BIRTHS = 25; // list
export const D_PARENTS = 26; // list
export const D_SIBLINGS = 27; // 1 when an element reads its sibling (needsSibling)
export const D_STATE = 28; // the emitter's S_* state in a half
export const D_RECORDS = 29; // its records in the records area, or -1 when no primitive draws it
export const D_PARENT_SLOTS = 30; // the parent emitter's slots, 1 for the root
export const D_MOTION = 31; // Q_* of the update program advanceParticle runs, or -1
export const EMITTER_RECORD = 32;

// Program record (ParticleProgram). A 3-vector or matrix field is the
// offset of its doubles, or -1 when absent.
export const Q_ORDER = 0; // list of PROGRAM_OP_*, or -1 for the default order
export const Q_SPHERE = 1;
export const Q_SPHERE_FLAGS = 2; // -1 when undefined
export const Q_CONE = 3;
export const Q_CONE_FLAGS = 4;
export const Q_CONE_FORCE = 5;
export const Q_CONE_FORCE_FLAGS = 6;
export const Q_CONE_POS = 7;
export const Q_CONE_POS_FLAGS = 8;
export const Q_R_VELOCITY = 9; // 16 doubles
export const Q_ROTATION_FRAMES = 10; // list, or -1
export const Q_SPIN = 11; // 16 doubles
export const Q_SPIN_FRAMES = 12;
export const Q_SHAPE = 13; // 16 doubles
export const Q_ATTRACTION_SET = 14;
export const Q_ATTRACTION = 15;
export const Q_ATTRACTION_FRAMES = 16;
export const Q_SCALE = 17; // list of [time, x, y, z] points, or -1
export const Q_SCALE_FRAMES = 18;
export const Q_VECTORS = 19; // [count, count V_* records], or -1
export const PROGRAM_RECORD = 20;

// initializeParticle's ops, as Q_ORDER lists them; any other name is 0.
export const PROGRAM_OP_OTHER = 0;
export const PROGRAM_OP_SPHERE = 1;
export const PROGRAM_OP_SCALE = 2;
export const PROGRAM_OP_CONE = 3;
export const PROGRAM_OP_CONE_FORCE = 4;
export const PROGRAM_OP_CONE_POS = 5;

// Vector command record (ParticleVectorCommand).
export const V_NAME = 0; // VECTOR_*
export const V_FLAGS = 1;
export const V_VALUE = 2; // 3 doubles
export const V_FRAMES = 5; // list
export const VECTOR_RECORD = 6;
export const VECTOR_SET_POSITION = 1;
export const VECTOR_SET_VELOCITY = 2;
export const VECTOR_FORCE = 3;

// Command record (an emitter's commands entry).
export const C_FLAGS = 0;
export const C_BAN_ROTATION = 1; // 1 for "SetBANRot"
export const C_FRAMES = 2; // list
export const C_PROGRAM = 3; // Q_* offset
export const C_ROTATIONS = 4; // list of 16-matrices, or -1
export const C_POSITIONS = 5; // list of 3-vectors, or -1
export const COMMAND_RECORD = 6;

// Instance record (particleGraphs).
export const G_DEF = 0; // its definition in particleDefs
export const G_STATE = 1; // its region in particleState
export const G_FRAMES = 2; // its region in particleFrames
export const G_CURRENT = 3; // the current half: 0 or 1
export const G_TIME = 4; // inputs: advanceParticleGraph's arguments
export const G_TRANSFORM = 5; // 16
export const G_STOP = 21;
export const G_SHIFT_X = 22;
export const G_SHIFT_Z = 23;
export const G_KEEP_ROOTS = 24;
export const PARTICLE_GRAPH_RECORD = 28;

// State half header (ParticleGraphState's numbers).
export const H_FRAME = 0;
export const H_INDEX = 1; // the graph's random cursor
export const H_SERIAL = 2;
export const H_HEADER = 4;

// An emitter's state in a half: its rows (rows.length; an emission
// emitter's births grow with them), its groups' count, its live elements
// when drawn (the records' count), then with an emission the births and
// parents of its slots and its groups: the group owners in insertion
// order (Map order) and each owner slot's total.
export const S_ROWS = 0;
export const S_GROUPS = 1;
export const S_LIVE = 2;
export const S_ARRAYS = 3;

// The scratch after the two halves: the alive elements of an emitter in
// serial order (GD_ELEMENTS of them), then each element's sibling and each
// parent's latest child (GD_ELEMENTS + 1 each, the root included).
export const K_ORDERED = 0;

// Element doubles (ParticleElement and its ParticleInstance).
export const E_SERIAL = 0;
export const E_BORN = 1;
export const E_CLOCK_BIRTH = 2;
export const E_AGE = 3;
export const E_ALIVE = 4;
export const E_CHILDREN = 5;
export const E_RELEASED = 6;
export const E_GROUP = 7; // the owner of its emission group, or -1
export const E_ROOT_LINK = 8;
export const E_PARENT = 9;
export const E_PRESENT = 10; // 1 when its row holds an element
export const E_FRAME = 11; // state.frame
export const E_HAS_TICK = 12; // 1 once state.previous exists
export const E_PREVIOUS = 13; // previousPosition, 3
export const E_POSITION = 16;
export const E_VELOCITY = 19;
export const E_SCALE = 22;
export const E_ORIGIN = 25;
export const E_TICK_POSITION = 28; // state.previous.position, 3
export const E_TICK_SCALE = 31; // state.previous.scale, 3
export const ELEMENT_WORDS = 34;

// Element floats.
export const F_ROTATION = 0; // state.rotation
export const F_TICK_ROTATION = 16; // state.previous.rotation
export const F_TICK_MATRIX = 32; // state.previous.matrix
export const F_MATRIX = 48;
export const F_DELTA = 64;
export const F_LOCAL = 80;
export const F_SHAPE = 96;
export const ELEMENT_FLOATS = 112;

// The shared random table's length (particle-program.ts particleRandomTable).
export const PARTICLE_RANDOM_VALUES = 5000;

// A thread's particle scratch. Doubles: the old root position, the vector
// commands' work, initializeParticle's sample (position, velocity, scale),
// the inherited velocity, the holder shift, a cone sample, the
// particle-presentation rotation work, then registers. Floats: the graph
// scratch matrix, inverse and previous, and the link's turned matrix.
export const W_OLD_ROOT = 0;
export const W_VECTOR = 3;
export const W_SAMPLE_POSITION = 6;
export const W_SAMPLE_VELOCITY = 9;
export const W_SAMPLE_SCALE = 12;
export const W_INHERITED = 15;
export const W_SHIFT = 18;
export const W_CONE = 21;
export const W_ROTATION = 24; // 27 doubles (ROTATION_WORK)
// Registers: the graph being run's definition, its state half, element 0
// in that half, its frames half, its scratch and its root's index; an
// emission's new total.
export const W_DEF = 51;
export const W_HALF = 52;
export const W_ELEMENTS = 53;
export const W_FRAMES = 54;
export const W_SCRATCH = 55;
export const W_ROOT = 56;
export const W_TOTAL = 57;
export const PARTICLE_WORK = 60;
export const M_MATRIX = 0;
export const M_INVERSE = 16;
export const M_PREVIOUS = 32;
export const M_TURNED = 48;
export const PARTICLE_MATRIX_WORK = 64;
