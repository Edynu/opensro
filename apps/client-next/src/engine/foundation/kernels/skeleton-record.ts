/*
===========================================================================

skeleton-record.ts - one character pose's skeleton as flat numbers

The layout skeleton-kernel.ts reads and writes to materialize one pose
(animation-pose.ts materialize): sample its layers' clips, blend event
lanes before timed ones, compose local matrices and multiply them into
global matrices parent first, then, when asked, its skin palettes
(animation-pose.ts palette). Six tables (frame-kernels.ts):

- skeletonModels (doubles): a model's skeleton, written once: S_HEADER,
  then for n nodes their parents (n), parent-first order (n), whether each
  has an authored matrix (n), those matrices (16n), and the rest
  translations (3n), rotations (4n) and scales (3n); then its palette
  bindings (animation-pose.ts skeletonBindings), each its joint count j,
  its joints (j) and its inverse bind matrices (16j).
- skeletonClips (doubles): a clip's channels, written once while a pose
  samples it: CLIP_HEADER, then CLIP_TIMELINE words a distinct key clock
  (its keys' offset in skeletonKeys and count), then CLIP_CHANNEL words a
  channel (node, path, interpolation, clock, values' offset).
- skeletonKeys (floats): the clips' key times and values, as authored.
- skeletonRecords (doubles): one SKELETON_RECORD a pose: where its model,
  state and scratch are, this materialization's inputs, its retained flags
  and its output (R_CHANGED).
- skeletonScratch (doubles): a pose's layers (LAYER_WORDS each), its
  quaternion brackets (4 a channel) and key clocks (4 a clock).
- skeletonState (floats): a pose's sampled translations (3n), rotations
  (4n) and scales (3n), blend passes (10n), lane weights (3n) and committed
  weights (3n), local and global matrices (16n each), changed-global and
  animated-local flags (n each), body thickness (n), a 4-float sample
  (STATE_* offsets in units of n), then the palettes of its bindings in
  their order (16 floats a joint).

R_BUSY makes a chunk run again after a stalled worker recompute every
matrix, and R_CHANGED and R_PALETTED only ever gain, so the pose's owner
reads the same result either way.

===========================================================================
*/

// Skeleton header; the arrays follow in the order above.
export const S_NODES = 0;
export const S_BINDINGS = 1; // palette bindings after the node arrays
export const S_HEADER = 4;
// Doubles a node takes in a skeleton, after S_HEADER.
export const S_NODE_WORDS = 29;

// Clip header, then its clocks and channels.
export const CLIP_CHANNELS = 0;
export const CLIP_TIMELINES = 1;
export const CLIP_HEADER = 2;
export const CLIP_TIMELINE = 2; // keys offset, key count
export const CLIP_CHANNEL = 5; // node, path, interpolation, clock, values offset
export const PATH_TRANSLATION = 0;
export const PATH_ROTATION = 1;
export const PATH_SCALE = 2;
export const INTERPOLATION_LINEAR = 0;
export const INTERPOLATION_STEP = 1;
export const INTERPOLATION_CUBIC = 2;

// Pose record.
export const R_MODEL = 0; // skeleton offset in skeletonModels
export const R_STATE = 1; // state offset in skeletonState
export const R_SCRATCH = 2; // scratch offset in skeletonScratch
export const R_LAYERS = 3; // input: layer count
export const R_DIRECT = 4; // input: one full-weight single-track layer
export const R_ROTATED = 5; // input: the rotator's node, or -1
export const R_RELEASED = 6; // input: the node a dropped rotator held, or -1
export const R_ROTATION = 7; // input: the rotator's quaternion x y z w
export const R_INITIALIZED = 11; // matrices composed at least once
export const R_DIRECT_MATRICES = 12; // the last materialization was direct
export const R_CHANGED = 13; // output: a matrix changed (only ever set by the kernel)
export const R_BUSY = 14; // 1 while the kernel runs this pose
export const R_CACHE_CLIP = 15; // the clip whose quaternion brackets the scratch holds, or -1
export const R_LAYER_CAPACITY = 16; // layers the scratch holds
export const R_CHANNEL_CAPACITY = 17; // quaternion brackets the scratch holds
export const R_CLOCK_CAPACITY = 18; // key clocks the scratch holds
export const R_PALETTES = 19; // input: PALETTES_* below
export const R_PALETTED = 20; // output: the palettes were written (only ever set by the kernel)
export const SKELETON_RECORD = 21;

// Whether a materialization writes the pose's palettes: never, when a
// matrix changed (the palettes written last are current otherwise), always.
export const PALETTES_NONE = 0;
export const PALETTES_CHANGED = 1;
export const PALETTES_ALWAYS = 2;

// One layer in the scratch: clip offset (or -1), time, weight, lane.
export const LAYER_WORDS = 4;
export const LANE_EVENT = 0;
export const LANE_TIMED = 1;

// Pose state offsets, in units of the node count n.
export const STATE_TRANSLATIONS = 0;
export const STATE_ROTATIONS = 3;
export const STATE_SCALES = 7;
export const STATE_PASSES = 10; // per node: translation 3, rotation 4, scale 3
export const STATE_WEIGHTS = 20;
export const STATE_COMMITTED = 23;
export const STATE_LOCALS = 26;
export const STATE_GLOBALS = 42;
export const STATE_CHANGED = 58;
export const STATE_ANIMATED = 59;
export const STATE_THICKNESS = 60;
export const STATE_SAMPLE = 61; // 4 floats, not scaled by n
export const STATE_SAMPLE_FLOATS = 4;
export const STATE_FLOATS_PER_NODE = 61;
