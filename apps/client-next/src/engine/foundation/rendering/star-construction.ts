// 8CBE10 child insertion order and reversed final lerp are significant to
// rejection sampling. Preserve each x87 float store (8C5C80, 8CCD1E).
const NATIVE_STAR_COUNT = 0xbb8;
const NATIVE_STAR_VECTOR_STRIDE_BYTES = 0x10;
const NATIVE_STAR_FLICKER_BATCH_COUNT = 10;
const NATIVE_STAR_FLICKER_BATCH_SIZE = 100;
const NATIVE_STAR_STEADY_START_VERTEX = 1000;
const NATIVE_RAND_SEED = 1;
const NATIVE_RAND_SEED_SOURCE =
  "original CRT startup seed 1 verified at 8CBE10; WinMain later reseeds the shared thread-local stream with timeGetTime at 0x00711c6c";
const NATIVE_RAND_MULTIPLIER = 0x343fd;
const NATIVE_RAND_INCREMENT = 0x269ec3;
const NATIVE_RAND_MASK = 0x7fff;
const NATIVE_RAND_DIVISOR = 32767;
const NATIVE_SKY_SPHERE_SCALE = 20000;
const NATIVE_STAR_ACCEPT_MIN_Y = 5000;
const NATIVE_STAR_Z_OFFSET = 6666.66650390625;
const NATIVE_STAR_Z_DAMPEN_DIVISOR = 10;
const NATIVE_STAR_FIRST_MIDPOINT_WEIGHT = 0.5;
const NATIVE_STAR_SECOND_MIDPOINT_WEIGHT = 0.66666668653488159;


type Vector=[number,number,number];
type Triangle=[number,number,number];

export function buildNativeSkyStarPrimitive(seed = NATIVE_RAND_SEED) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error("Invalid native star construction seed");
const NATIVE_STAR_COLOR_TABLE_RGB = [
  0x005c4487,
  0x00595715,
  0x00a7ad01,
  0x00874467,
  0x00676295,
  0x00a8a550,
  0x00d9a1da,
  0x00bab3ff
];
  const skyPrimitive = buildNativeSkyPrimitiveSphere();
  const starTriangles = skyPrimitive.triangles.filter((triangle) =>
    triangle.every((vertexIndex) => skyPrimitive.vertices[vertexIndex]![1] >= 0)
  );
  const rand = createNativeRand(seed);
  const vertices: {x:number;y:number;z:number;colorArgb:number}[] = [];

  while (vertices.length < NATIVE_STAR_COUNT) {
    const triangle = starTriangles[rand() % starTriangles.length]!;
    const vertex0 = skyPrimitive.vertices[triangle[0]]!;
    const vertex1 = skyPrimitive.vertices[triangle[1]]!;
    const vertex2 = skyPrimitive.vertices[triangle[2]]!;
    const edgePoint0 = nativeLerp3(vertex0, vertex1, Math.fround(rand() / NATIVE_RAND_DIVISOR));
    const edgePoint1 = nativeLerp3(vertex0, vertex2, Math.fround(rand() / NATIVE_RAND_DIVISOR));
    const edgePoint2 = nativeLerp3(vertex1, vertex2, Math.fround(rand() / NATIVE_RAND_DIVISOR));
    const midpoint = nativeLerp3(edgePoint0, edgePoint1, NATIVE_STAR_FIRST_MIDPOINT_WEIGHT);
    const starPoint = nativeLerp3(edgePoint2, midpoint, NATIVE_STAR_SECOND_MIDPOINT_WEIGHT);

    if (starPoint[1] < NATIVE_STAR_ACCEPT_MIN_Y) {
      continue;
    }

    const colorIndex = nativeRandSignedModulo(rand(), NATIVE_STAR_COLOR_TABLE_RGB.length);
    const colorArgb = (0xff000000 | NATIVE_STAR_COLOR_TABLE_RGB[colorIndex]!) >>> 0;

    if (nativeRandSignedModulo(rand(), 4) === 0) {
      starPoint[2] = Math.fround(starPoint[2] / NATIVE_STAR_Z_DAMPEN_DIVISOR);
    }
    starPoint[2] = Math.fround(starPoint[2] + NATIVE_STAR_Z_OFFSET);

    vertices.push({
      x: starPoint[0],
      y: starPoint[1],
      z: starPoint[2],
      colorArgb
    });
  }

  return {
    reconstructedFrom: {
      constructor: "sub_8cbe10",
      upload: "sub_8ca0a0",
      draw: "sub_8cb380"
    },
    vectorOffset: "sky+0x54",
    payloadOffsets: {
      start: "sky+0x58",
      end: "sky+0x5c",
      capacity: "sky+0x60"
    },
    positionVectorOffset: "sky+0x24",
    triangleVectorOffset: "sky+0x154",
    vertexBufferOffset: "sky+0x80",
    vertexFormat: "xyz_argb",
    vertexStrideBytes: NATIVE_STAR_VECTOR_STRIDE_BYTES,
    pointCount: vertices.length,
    flickerBatchCount: NATIVE_STAR_FLICKER_BATCH_COUNT,
    flickerBatchSize: NATIVE_STAR_FLICKER_BATCH_SIZE,
    steadyStartVertex: NATIVE_STAR_STEADY_START_VERTEX,
    primitiveType: "D3DPT_POINTLIST",
    nativeRand: {
      function: "sub_9c4776",
      seed,
      stateAfterConstruction: rand.state(),
      calls: rand.calls(),
      seedSource: NATIVE_RAND_SEED_SOURCE,
      multiplier: NATIVE_RAND_MULTIPLIER,
      increment: NATIVE_RAND_INCREMENT,
      mask: NATIVE_RAND_MASK,
      divisor: NATIVE_RAND_DIVISOR
    },
    constructionConstants: {
      sphereScale: NATIVE_SKY_SPHERE_SCALE,
      acceptMinY: NATIVE_STAR_ACCEPT_MIN_Y,
      zOffset: NATIVE_STAR_Z_OFFSET,
      zDampenDivisor: NATIVE_STAR_Z_DAMPEN_DIVISOR,
      firstMidpointWeight: NATIVE_STAR_FIRST_MIDPOINT_WEIGHT,
      secondMidpointWeight: NATIVE_STAR_SECOND_MIDPOINT_WEIGHT
    },
    sourceSphere: {
      basePrimitive: "octahedron",
      subdivisionPasses: 4,
      vertexCount: skyPrimitive.vertices.length,
      triangleCount: skyPrimitive.triangles.length,
      starTriangleCount: starTriangles.length
    },
    colorTableArgb: NATIVE_STAR_COLOR_TABLE_RGB.map((rgb) =>
      `0x${((0xff000000 | rgb) >>> 0).toString(16).padStart(8, "0")}`
    ),
    vertices
  };
}

function buildNativeSkyPrimitiveSphere():{vertices:Vector[];triangles:Triangle[]} {
  const vertices:Vector[] = [
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 0],
    [0, 0, -1],
    [-1, 0, 0],
    [0, -1, 0]
  ];
  const vertexKeys = new Map(vertices.map((vertex, index) => [nativeVertexKey(vertex), index]));
  let triangles:Triangle[] = [
    [0, 2, 1],
    [0, 3, 2],
    [0, 4, 3],
    [0, 1, 4],
    [5, 1, 2],
    [5, 2, 3],
    [5, 3, 4],
    [5, 4, 1]
  ];

  for (let pass = 0; pass < 4; pass += 1) {
    const nextTriangles:Triangle[] = [];
    for (const [vertex0, vertex1, vertex2] of triangles) {
      const midpoint01 = addNativeSkyMidpoint(vertices, vertexKeys, vertex0, vertex1);
      const midpoint12 = addNativeSkyMidpoint(vertices, vertexKeys, vertex1, vertex2);
      const midpoint20 = addNativeSkyMidpoint(vertices, vertexKeys, vertex2, vertex0);
      nextTriangles.push(
        [vertex0, midpoint01, midpoint20],
        [midpoint01, midpoint12, midpoint20],
        [vertex1, midpoint12, midpoint01],
        [midpoint20, midpoint12, vertex2]
      );
    }
    triangles = nextTriangles;
  }

  return {
    vertices: vertices.map((vertex) => [
      Math.fround(vertex[0] * NATIVE_SKY_SPHERE_SCALE),
      Math.fround(vertex[1] * NATIVE_SKY_SPHERE_SCALE),
      Math.fround(vertex[2] * NATIVE_SKY_SPHERE_SCALE)
    ]),
    triangles
  };
}

function addNativeSkyMidpoint(vertices:Vector[], vertexKeys:Map<string,number>, index0:number, index1:number) {
  const vertex0 = vertices[index0]!;
  const vertex1 = vertices[index1]!;
  const midpoint = normalizeNative3([
    Math.fround((vertex0[0] + vertex1[0]) * 0.5),
    Math.fround((vertex0[1] + vertex1[1]) * 0.5),
    Math.fround((vertex0[2] + vertex1[2]) * 0.5)
  ]);
  const key = nativeVertexKey(midpoint);
  const existing = vertexKeys.get(key);
  if (typeof existing === "number") {
    return existing;
  }

  const index = vertices.length;
  vertices.push(midpoint);
  vertexKeys.set(key, index);
  return index;
}

function normalizeNative3(vector:Vector):Vector {
  const length = Math.fround(Math.sqrt(Math.fround(vector[0]*vector[0]+vector[1]*vector[1]+vector[2]*vector[2])));
  const reciprocal = length>0?Math.fround(1/length):0;
  return [
    Math.fround(vector[0] * reciprocal),
    Math.fround(vector[1] * reciprocal),
    Math.fround(vector[2] * reciprocal)
  ];
}

function nativeVertexKey(vertex:Vector) {
  return `${vertex[0].toFixed(6)} ${vertex[1].toFixed(6)} ${vertex[2].toFixed(6)}`;
}

function nativeLerp3(from:Vector, to:Vector, weight:number):Vector {
  return [
    Math.fround(from[0] + Math.fround(Math.fround(to[0] - from[0]) * weight)),
    Math.fround(from[1] + Math.fround(Math.fround(to[1] - from[1]) * weight)),
    Math.fround(from[2] + Math.fround(Math.fround(to[2] - from[2]) * weight))
  ];
}

function createNativeRand(seed:number) {
  let state = seed >>> 0;
  let calls = 0;
  const next = () => {
    calls++;
    state = Math.imul(state, NATIVE_RAND_MULTIPLIER) + NATIVE_RAND_INCREMENT;
    state >>>= 0;
    return (state >>> 16) & NATIVE_RAND_MASK;
  };
  next.state = () => state;
  next.calls = () => calls;
  return next;
}

function nativeRandSignedModulo(value:number, modulo:number) {
  const masked = value & 0x80000000;
  const adjusted = masked ? -((~value + 1) >>> 0) : value;
  return ((adjusted % modulo) + modulo) % modulo;
}
