/*
===========================================================================

parseDof

JMXVDOF 0101 ("Dungeon Object File") parser.

Strict-RE provenance (SRO_Client v1.150):
  * Dof_Load (sub_a8b880) opens the file through the GlobalObj archive opener and validates it
    with Dof_ValidateHeader (sub_a8ae70): first 0x400 bytes are read, size must be >= 0x2c, the
    signature dwords must spell "DOF " (0x444f4620) then version "0101" (0x30313031). Source path
    baked into the binary: D:\Project\SilkroadOnline\TOOLS & PLUGINS\SimpleViewer\objengine\DungeonObj.cpp.
  * The serializer is Dof_Serialize (sub_a8cb30): a 12-byte ascii signature ("JMXVDOF 0101")
    followed by an 8 x uint32 offset table (44 / 0x2c byte header, matching the size check).

Layout cross-checked byte-for-byte against the shipped dofs: all
12 well-formed files (including the only two referenced by data\dungeon\dungeoninfo.txt --
Dunhwang_Cv.dof and event.dof) parse to EOF with zero trailing bytes.

v1.150 DIVERGENCE from the public JMXVDOF wiki spec: the Labels section's floorName length is a
uint32 here, not the uint16 the wiki shows (older clients). With u16 the label section drifts and
every multi-floor dof overruns; with u32 every shipped file lands exactly on the next section
offset. This is the only field that differs from the wiki layout for this client version.

===========================================================================
*/

// JMX names use CP949; match the asset publisher and extracted resource names.
const dofTextDecoder = new TextDecoder("euc-kr");

export type Vector3 = readonly [number, number, number];

export type DofHeader = {
	signature: string;
	blockOffset: number;
	linkOffset: number;
	gridOffset: number;
	groupOffset: number;
	labelOffset: number;
	/** Always 0 in shipped files. */
	offset5: number;
	/** Always 0 in shipped files. */
	offset6: number;
	boundingBoxOffset: number;
};

export type DofGeneralInfo = {
	type: number;
	name: string;
	unk0: number;
	unk1: number;
	/** Dungeon sector id, e.g. 0x8001 (bit15 set). Low 15 bits = region id. */
	regionId: number;
};

/** Optional per-block height-fog parameters (block.FogParam.hasHeightFog == 1). */
export type DofHeightFog = {
	unk3: number;
	unk4: number;
	unk5: number;
	unk6: number;
};

export type DofFogParam = {
	color: number;
	nearPlane: number;
	farPlane: number;
	intensity: number;
	heightFog: DofHeightFog | null;
};

/** A renderable object instance inside a block (an *.bsr resource with a transform). */
export type DofObject = {
	name: string;
	/** *.bsr resource path. */
	path: string;
	position: Vector3;
	rotation: Vector3;
	scale: Vector3;
	/** 0 = None, 2 = ColObj, 4 = WaterObj (bitfield). */
	flag: number;
	unk0: number;
	radiusSqrt: number;
	/** Present only when (flag & 4) (water object). */
	waterColor?: number;
};

export type DofLight = {
	name: string;
	position: Vector3;
	/** Diffuse / ambient / specular (per wiki annotation). */
	color0: Vector3;
	color1: Vector3;
	color2: Vector3;
	attenuation: number;
	float1: number;
	float2: number;
};

/** One dungeon block (a room/segment of geometry plus its objects, lights and connectivity). */
export type DofBlock = {
	/** *.bsr block geometry path. */
	path: string;
	name: string;
	unk0: number;
	position: Vector3;
	yaw: number;
	/** Serialized v1.150 field retained for exact record alignment; not consumed. */
	isEntrance: number;
	/** 6 floats: min xyz, max xyz. */
	collisionBox: readonly number[];
	unk1: number;
	fog: DofFogParam;
	/** Optional extra block payload (block.unkByte1 != 0): two vec3s + a uint. */
	extra: { v0: Vector3; v1: Vector3; u: number } | null;
	unkString: string;
	roomIndex: number;
	floorIndex: number;
	/** Walkable-connected block indices. */
	connectedBlocks: readonly number[];
	/** Portal-visible block indices (occlusion culling). */
	visibleBlocks: readonly number[];
	colObjCount: number;
	objects: readonly DofObject[];
	lights: readonly DofLight[];
};

/** A 200x200x200-unit voxel of the block-lookup acceleration grid. */
export type DofGridVoxel = {
	/** Packed X/Z/Y index (10 bits each); see wiki bit layout. */
	id: number;
	blockIndices: readonly number[];
};

export type DofGrid = {
	width: number;
	height: number;
	length: number;
	voxels: readonly DofGridVoxel[];
};

export type DofGroup = {
	name: string;
	/** 0 or 1 (service?). */
	flag: number;
	blockIndices: readonly number[];
};

export type DofLabels = {
	rooms: readonly string[];
	floors: readonly string[];
};

export type DungeonObjectFile = {
	header: DofHeader;
	info: DofGeneralInfo;
	/** Two 6-float collision boxes (box1 unused by CRTNavMeshDungeon). */
	boundingBox: { box0: readonly number[]; box1: readonly number[] };
	blocks: readonly DofBlock[];
	grid: DofGrid;
	/** Off-mesh links: each entry is a list of neighbour block indices. */
	links: readonly( readonly number[] )[];
	labels: DofLabels | null;
	groups: readonly DofGroup[];
};

const DOF_SIGNATURE = "JMXVDOF 0101";


//=====================================================================


/*
================
DofReader

Little-endian cursor over the dof bytes. Every read advances `offset`, so the
call ORDER in the section readers below IS the file layout - one reordered
read corrupts every following field.
================
*/
class DofReader {
	private readonly view: DataView;
	private readonly bytes: Uint8Array;
	offset = 0;

	/*
	================
	DofReader::constructor
	================
	*/
	constructor( buffer: ArrayBuffer | Uint8Array ) {
		if ( buffer instanceof Uint8Array ) {
			this.bytes = buffer;
			this.view = new DataView( buffer.buffer, buffer.byteOffset, buffer.byteLength );
		} else {
			this.bytes = new Uint8Array( buffer );
			this.view = new DataView( buffer );
		}
	}

	/*
	================
	DofReader::length
	================
	*/
	get length(): number {
		return this.bytes.byteLength;
	}

	/*
	================
	DofReader::seek
	================
	*/
	seek( offset: number ): void {
		this.offset = offset;
	}

	/*
	================
	DofReader::u8
	================
	*/
	u8(): number {
		const	v = this.view.getUint8( this.offset );

		this.offset += 1;
		return v;
	}

	/*
	================
	DofReader::u16
	================
	*/
	u16(): number {
		const	v = this.view.getUint16( this.offset, true );

		this.offset += 2;
		return v;
	}

	/*
	================
	DofReader::u32
	================
	*/
	u32(): number {
		const	v = this.view.getUint32( this.offset, true );

		this.offset += 4;
		return v;
	}

	/*
	================
	DofReader::f32
	================
	*/
	f32(): number {
		const	v = this.view.getFloat32( this.offset, true );

		this.offset += 4;
		return v;
	}

	/*
	================
	DofReader::vec3
	================
	*/
	vec3(): Vector3 {
		return [ this.f32(), this.f32(), this.f32() ];
	}

	/*
	================
	DofReader::floats
	================
	*/
	floats( count: number ): number[] {
		const	out = new Array<number> ( count );

		for ( let i = 0; i < count; i += 1 ) {
			out[i] = this.f32();
		}
		return out;
	}

	/*
	================
	DofReader::u32s
	================
	*/
	u32s( count: number ): number[] {
		const	out = new Array<number> ( count );

		for ( let i = 0; i < count; i += 1 ) {
			out[i] = this.u32();
		}
		return out;
	}

	/*
	================
	DofReader::strU32

	uint32-length-prefixed CP949 string, decoded to the published Unicode name.
	================
	*/
	strU32(): string {
		const	n = this.u32();

		return this.readString( n );
	}

	/*
	================
	DofReader::strU16

	uint16-length-prefixed string (used nowhere in v1.150 dofs, kept for completeness).
	================
	*/
	strU16(): string {
		const	n = this.u16();

		return this.readString( n );
	}

	/*
	================
	DofReader::readString
	================
	*/
	private readString( n: number ): string {
		if ( !Number.isSafeInteger( n ) || n < 0 || n > this.bytes.length - this.offset ) {
			throw new Error( "Truncated DOF string" );
		}
		const text = dofTextDecoder.decode( this.bytes.subarray( this.offset, this.offset + n ) );
		this.offset += n;
		return text;
	}
}


//=====================================================================


/*
================
readSignature
================
*/
function readSignature( reader: DofReader ): string {
	let		sig = "";

	for ( let i = 0; i < 12; i += 1 ) {
		sig += String.fromCharCode( reader.u8() );
	}
	return sig;
}

/*
================
readBlock

One DofBlock. The read order below is the exact serialized field order
(Dof_Serialize sub_a8cb30); object-literal property order sequences the reads.
================
*/
function readBlock( reader: DofReader ): DofBlock {
	const	path = reader.strU32();
	const	name = reader.strU32();
	const	unk0 = reader.u32();
	const	position = reader.vec3();
	const	yaw = reader.f32();
	const	isEntrance = reader.u32();
	const	collisionBox = reader.floats( 6 );
	const	unk1 = reader.u32();

	const	fog: DofFogParam = {
		color: reader.u32(),
		nearPlane: reader.f32(),
		farPlane: reader.f32(),
		intensity: reader.f32(),
		heightFog: null
	};

	if ( reader.u8() !== 0 ) {
		fog.heightFog = { unk3: reader.f32(), unk4: reader.f32(), unk5: reader.f32(), unk6: reader.f32() };
	}

	let		extra: DofBlock["extra"] = null;

	if ( reader.u8() !== 0 ) {
		extra = { v0: reader.vec3(), v1: reader.vec3(), u: reader.u32() };
	}

	const	unkString = reader.strU32();
	const	roomIndex = reader.u32();
	const	floorIndex = reader.u32();

	const	connectedBlocks = reader.u32s( reader.u32() );
	const	visibleBlocks = reader.u32s( reader.u32() );

	const	objCount = reader.u32();
	const	colObjCount = reader.u32();
	const	objects = new Array<DofObject> ( objCount );

	for ( let i = 0; i < objCount; i += 1 ) {
		const	oName = reader.strU32();
		const	oPath = reader.strU32();
		const	obj: DofObject = {
			name: oName,
			path: oPath,
			position: reader.vec3(),
			rotation: reader.vec3(),
			scale: reader.vec3(),
			flag: reader.u32(),
			unk0: reader.u32(),
			radiusSqrt: reader.f32()
		};

		if ( obj.flag & 4 ) {
			obj.waterColor = reader.u32();
		}
		objects[i] = obj;
	}

	const	lightCount = reader.u32();
	const	lights = new Array<DofLight> ( lightCount );

	for ( let i = 0; i < lightCount; i += 1 ) {
		lights[i] = {
			name: reader.strU32(),
			position: reader.vec3(),
			color0: reader.vec3(),
			color1: reader.vec3(),
			color2: reader.vec3(),
			attenuation: reader.f32(),
			float1: reader.f32(),
			float2: reader.f32()
		};
	}

	return {
		path,
		name,
		unk0,
		position,
		yaw,
		isEntrance,
		collisionBox,
		unk1,
		fog,
		extra,
		unkString,
		roomIndex,
		floorIndex,
		connectedBlocks,
		visibleBlocks,
		colObjCount,
		objects,
		lights
	};
}

/*
================
readGrid
================
*/
function readGrid( reader: DofReader ): DofGrid {
	const	width = reader.u32();
	const	height = reader.u32();
	const	length = reader.u32();
	const	voxelCount = reader.u32();
	const	voxels = new Array<DofGridVoxel> ( voxelCount );

	for ( let i = 0; i < voxelCount; i += 1 ) {
		const	id = reader.u32();

		voxels[i] = { id, blockIndices: reader.u32s( reader.u32() ) };
	}
	return { width, height, length, voxels };
}

/*
================
readLinks
================
*/
function readLinks( reader: DofReader ): number[][] {
	const	count = reader.u32();
	const	links = new Array<number[]> ( count );

	for ( let i = 0; i < count; i += 1 ) {
		links[i] = reader.u32s( reader.u32() );
	}
	return links;
}

/*
================
readLabels
================
*/
function readLabels( reader: DofReader ): DofLabels {
	const	roomCount = reader.u32();
	const	rooms = new Array<string> ( roomCount );

	for ( let i = 0; i < roomCount; i += 1 ) {
		rooms[i] = reader.strU32();
	}

	const	floorCount = reader.u32();
	const	floors = new Array<string> ( floorCount );

	// v1.150: floorName length is u32 (wiki/older clients use u16 here).
	for ( let i = 0; i < floorCount; i += 1 ) {
		floors[i] = reader.strU32();
	}
	return { rooms, floors };
}

/*
================
readGroups
================
*/
function readGroups( reader: DofReader ): DofGroup[] {
	const	count = reader.u32();
	const	groups = new Array<DofGroup> ( count );

	for ( let i = 0; i < count; i += 1 ) {
		groups[i] = { name: reader.strU32(), flag: reader.u32(), blockIndices: reader.u32s( reader.u32() ) };
	}
	return groups;
}

/*
================
DofParseError
================
*/
export class DofParseError extends Error {
	/*
	================
	DofParseError::constructor
	================
	*/
	constructor( message: string ) {
		super( message );
		this.name = "DofParseError";
	}
}

/*
================
parseDof

Parse a JMXVDOF 0101 buffer into a typed DungeonObjectFile.

Mirrors Dof_ValidateHeader (signature + size) then walks each section at its header offset. Each
section read is bounds-checked against the next known offset to catch a malformed file early
(rather than running off the end), matching the native "Dof File Error" / size assertions.
================
*/
export function parseDof( buffer: ArrayBuffer | Uint8Array ): DungeonObjectFile {
	const	reader = new DofReader( buffer );

	if ( reader.length < 0x2c ) {
		throw new DofParseError( `dof too small (${reader.length} < 0x2c); native Dof_ValidateHeader size check` );
	}

	const	signature = readSignature( reader );

	if ( signature !== DOF_SIGNATURE ) {
		throw new DofParseError( `bad signature ${JSON.stringify( signature )} (expected ${JSON.stringify( DOF_SIGNATURE )})` );
	}

	const	header: DofHeader = {
		signature,
		blockOffset: reader.u32(),
		linkOffset: reader.u32(),
		gridOffset: reader.u32(),
		groupOffset: reader.u32(),
		labelOffset: reader.u32(),
		offset5: reader.u32(),
		offset6: reader.u32(),
		boundingBoxOffset: reader.u32()
	};

	const	info: DofGeneralInfo = {
		type: reader.u32(),
		name: reader.strU32(),
		unk0: reader.u32(),
		unk1: reader.u32(),
		regionId: reader.u16()
	};

	expectOffset( reader, header.boundingBoxOffset, "BoundingBox" );
	const	boundingBox = { box0: reader.floats( 6 ), box1: reader.floats( 6 ) };

	expectOffset( reader, header.blockOffset, "BlockList" );
	const	blockCount = reader.u32();
	const	blocks = new Array<DofBlock> ( blockCount );

	for ( let i = 0; i < blockCount; i += 1 ) {
		blocks[i] = readBlock( reader );
	}

	expectOffset( reader, header.gridOffset, "Grid" );
	const	grid = readGrid( reader );

	expectOffset( reader, header.linkOffset, "Links" );
	const	links = readLinks( reader );

	let		labels: DofLabels | null = null;

	if ( header.labelOffset !== 0 ) {
		expectOffset( reader, header.labelOffset, "Labels" );
		labels = readLabels( reader );
	}

	expectOffset( reader, header.groupOffset, "Groups" );
	const	groups = readGroups( reader );

	return { header, info, boundingBox, blocks, grid, links, labels, groups };
}

/*
================
expectOffset
================
*/
function expectOffset( reader: DofReader, expected: number, section: string ): void {
	if ( reader.offset !== expected ) {
		throw new DofParseError(
			`${section} section misaligned: at 0x${reader.offset.toString( 16 )} but header says 0x${expected.toString( 16 )} ` +
				`(dof layout mismatch)`
		);
	}
}
