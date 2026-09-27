/*
================================================================================
navmeshRuntimeTypes

Tuning constants, diagnostic/option contracts, and the runtime record types
shared by the native navmesh layer runtime and its sibling helper modules:
terrain cells/edges, object nav hosts, and bit15 dungeon records with their
native struct-offset field names.
================================================================================
*/

import type {
	DungeonHandle,
	SroWorldNavObjectResources,
	DungeonObjectFile,
	DungeonResourceLoader,
	SroWorldBmsNativePayload
} from "@sro/runtime";
import type {
	CRTNavMeshTerrainStepper,
	ObjMeshHost,
	RegionEdge,
	TerrainRegion
} from "@wip/functions/sub_404510_CRTNavMeshTerrain_StepMove/sub_404510_CRTNavMeshTerrain_StepMove";
import type {
	NavCellQuad,
	NavEdge as TerrainNavEdge
} from "@wip/functions/sub_45afc0_CRTNavCellQuad_ResolveEdgeCrossing/sub_45afc0_CRTNavCellQuad_ResolveEdgeCrossing";
import type {
	NavCell as ObjectNavCell,
	NavEdge as ObjectNavEdge,
	NavMeshHost
} from "@wip/functions/sub_428930_NavMesh_AdvanceWithinMesh/sub_428930_NavMesh_AdvanceWithinMesh";
import type {
	NavMeshObjHost
} from "@wip/functions/sub_428f40_CRTNavMeshObj_StepMove/sub_428f40_CRTNavMeshObj_StepMove";
import type {
	NavCellLinkedEdgeSlots
} from "@wip/functions/sub_45c410_NavCell_GetEdge/sub_45c410_NavCell_GetEdge";
import type {
	CRTNavMeshDungeonResolveSelf
} from "@wip/functions/sub_453d40_CRTNavMeshDungeon_ResolvePosition/sub_453d40_CRTNavMeshDungeon_ResolvePosition";
import type {
	NavMeshDungeonResidentPayload,
	NavMeshResidentObject
} from "@wip/functions/sub_4528d0_NavMeshInstance_NotifyDungeonResident/sub_4528d0_NavMeshInstance_NotifyDungeonResident";
import type {
	NavMeshObjCacheLoadMirror
} from "@wip/functions/sub_414ca0_NavMeshObjCache_Release/sub_414ca0_NavMeshObjCache_Release";
import type {
	NavEdgeSideCells
} from "@wip/functions/sub_45c070_NavEdge_SideTest/sub_45c070_NavEdge_SideTest";
import type {
	NavHitPoint3
} from "@wip/functions/sub_45c290_NavMesh_FixupCrossPoint/sub_45c290_NavMesh_FixupCrossPoint";
import type {
	NavCellPlaneY
} from "@wip/functions/sub_45c270_NavCell_SolvePlaneY/sub_45c270_NavCell_SolvePlaneY";
import type {
	NavMeshObjectBoundaryHost
} from "@wip/functions/sub_428300_NavMesh_CrossObjectBoundary/sub_428300_NavMesh_CrossObjectBoundary";
import type {
	ObjNavMeshStepThroughObjectHost
} from "@wip/functions/sub_403fb0_ObjNavMesh_StepThroughObject/sub_403fb0_ObjNavMesh_StepThroughObject";
import type {
	NavResidentKeyObject
} from "@wip/functions/sub_403c40_NavRegion_FindObjectByResidentKey/sub_403c40_NavRegion_FindObjectByResidentKey";
import type {
	CRTNavMeshObjResolveCellNearestYHost
} from "@wip/functions/sub_428140_NavMeshObj_ResolveCellNearestY/sub_428140_NavMeshObj_ResolveCellNearestY";
import type {
	NavMeshInstanceResolveNearestYHost
} from "@wip/functions/sub_403ca0_NavMeshInstance_ResolveNearestYCell/sub_403ca0_NavMeshInstance_ResolveNearestYCell";
import type {
	NavEdgeLineRecordCache,
	NavEdgeVertexXZ
} from "@wip/functions/sub_45bf60_NavEdge_DerefLineRecord/sub_45bf60_NavEdge_DerefLineRecord";
import type {
	NavVertRegionLinkOut,
	NavVertRegionLinkPair
} from "@wip/functions/sub_43ec80_NavVert_ResolveRegionLinkByte/sub_43ec80_NavVert_ResolveRegionLinkByte";
import type {
	NavRegionOutlineEdgeVector
} from "@wip/functions/sub_425ed0_NavRegion_GetEdgeObjectId/sub_425ed0_NavRegion_GetEdgeObjectId";
import type {
	NavHost,
	EdgeTrigger,
	RegionManagerEvents
} from "@wip/functions/sub_428290_NavRegion_FireEdgeEventTrigger/sub_428290_NavRegion_FireEdgeEventTrigger";
import type {
	Matrix44RowMajor,
	RegionLayerObject,
	RegionMoveStepper,
	RegionObject,
	RegionPosition
} from "@wip/shared/native";
import type {
	NativeObjectNavMesh
} from "./nativeObjectNavPayload";

export const NAVMESH_V2 = 2;
export const REGION_SPAN = 1920;
export const REGION_DUNGEON_FLAG = 0x8000;
export const TILE_OBJECT_NAV_MISSING_LIMIT = 16;
/** Small owner probe after a crossed object outline edge; not a height or OBB fallback. */
export const OBJECT_BOUNDARY_OWNER_PROBE = 0.25;
export const OBJECT_EXIT_SUPPRESSION_RADIUS = OBJECT_BOUNDARY_OWNER_PROBE * 2;
export const OBJECT_BOUNDARY_FOREIGN_HOST: NavHost = { triggers: [] };
/**
 * Boundary-entry bands: enter when the side cell is a step up, clip at storey
 * rims, hard-reject decks far overhead. Cluster evidence: real entries are
 * 0.2-4u (harbor/Jangan/stalls), the harness fixture deck spans up to 33u
 * over its flat-7 terrain, the inn storey rim is 39.3u, overhead decks 300u+.
 * 35 splits the fixture cluster from the storey cluster with margin on both
 * sides; entry deltas near the boundary vary with the crossing point, so the
 * budget must not knife-edge a legitimate cluster (30 did).
 */
export const OBJECT_ENTRY_STEP_UP_BUDGET = 35.0;
export const OBJECT_ENTRY_REJECT_HEIGHT = 60.0;

export type NativeNavmeshObjectNavGapReason =
	| "missing-nvm-object-record"
	| "missing-object-resource"
	| "missing-object-mesh"
	| "missing-object-nav-payload"
	| "unsupported-object-nav-payload"
	| "object-nav-surface-miss";

export type NativeNavmeshObjectNavPayloadSummary = {
	meshPath: string;
	kind: SroWorldBmsNativePayload["kind"];
	byteOffset: number;
	byteLength: number;
	countHint: number | null;
	sha256: string;
	decodeError?: string;
};

export type NativeNavmeshObjectNavGap = {
	objectIndex: number;
	assetId: number | null;
	sourcePath: string | null;
	meshPaths: string[];
	missingMeshPaths: string[];
	nativePayloads: NativeNavmeshObjectNavPayloadSummary[];
	reason: NativeNavmeshObjectNavGapReason;
};

export type NativeNavmeshLayerRuntimeDiagnostic = {
	kind: "missing-object-nav-host";
	regionWord: number;
	cellIndex: number;
	objectIndices: number[];
	objects: NativeNavmeshObjectNavGap[];
} | {
	kind: "missing-dungeon-resource";
	regionWord: number;
	message: string;
} | {
	kind: "missing-dungeon-resident-nav-host";
	regionWord: number;
	dofName: string;
	candidateIndices: number[];
	blocks: Array<{
		blockIndex: number;
		residentKey: string;
		residentName: string;
	}>;
} | {
	kind: "object-nav-entry-height-reject";
	regionWord: number;
	objectIndex: number;
	assetId: number;
	meshPath: string;
	cellIndex: number;
};

/**
 * Decoded native object-navigation surface hit used by the
 * CRegionManager_RaycastNavMeshInstances leg of SWorld_PickGroundAlongRay.
 *
 * Coordinates are returned in the caller-selected region frame so the
 * browser can compare the distance directly with its MAPM terrain ray hit.
 * Render BSR geometry is deliberately absent from this contract.
 */
export type NativeObjectNavRayHit = {
	distance: number;
	seedLocal: { x: number; y: number; z: number };
	regionWord: number;
	objectIndex: number;
	cellIndex: number;
};

export type NativeNavmeshEdgeEventRuntimeConfig = {
	readonly context: number;
	readonly callback: RegionManagerEvents["callback"];
	readonly callback2?: RegionManagerEvents["callback2"];
	readonly recordsByKey?: ReadonlyArray<readonly [number, unknown]>;
	readonly recordsByName?: ReadonlyArray<readonly [string, unknown]>;
	readonly cacheBackrefs?: boolean;
};

export type NativeNavmeshLayerRuntimeOptions = {
	/**
	 * Native manager+0x20c0 table consumed by sub_43ec80 while building object
	 * nav vertices. Defaults to the native MapLoader::Initialize seed
	 * (sub_43ec10: per-byte sin/-cos compass pairs); pass entries only to
	 * override individual slots (tests).
	 */
	readonly regionLinkTable20c0?: readonly NavVertRegionLinkPair[];
	/** Mission/session-owned dungeon resource loader used for bit15 loaded records. */
	readonly dungeonLoader?: DungeonResourceLoader | null;
	/** DOF-resident BSR/BMS nav records, indexed before any dungeon query. */
	readonly dungeonNavResources?: SroWorldNavObjectResources | null;
};

export type RuntimeCell = TerrainRegion &
	NavCellQuad & {
		readonly runtimeKind: "native-navmesh-cell";
		readonly regionWord: number;
		readonly cellIndex: number;
		readonly objectIndices: Uint16Array;
		/**
		 * CIObject+0x70 terrain-query surface (CIObjectTerrainQuery): resolved
		 * cells land in the position record's +0x00 slot, and the commit/update
		 * chains probe them (sub_85e860 objlight gate vt+0x08; sub_8f99a0
		 * packed ground-material query vt+0x0c; sub_85d890 transform-tween
		 * target vt+0x10).
		 */
		isLightSampleValid08: () => boolean;
		getGroundInfoAt0c: ( sectorLocalPos: { x: number; y: number; z: number } ) => number;
		resolveTransformTweenTarget10: ( record: { x: number; y: number; z: number } ) => {
			x: number;
			y: number;
			z: number;
		};
	};

export type RuntimeEdge = RegionEdge &
	TerrainNavEdge & {
		readonly runtimeKind: "native-navmesh-edge";
		readonly flags30: number;
		cellA08: RuntimeCell | null;
		cellB0c: RuntimeCell | null;
	};

export type RuntimeRegion = {
	readonly regionWord: number;
	readonly tileCellIds: Uint32Array;
	readonly tileFlags: Uint16Array;
	readonly tileTextureIds: Uint16Array;
	readonly cells: RuntimeCell[];
	readonly layerObj: RegionLayerObject;
	readonly terrainHost: RegionMoveStepper;
	readonly terrainStepper: CRTNavMeshTerrainStepper;
	readonly heightMap: Float32Array | null;
	readonly heightMapAxis: number;
	readonly tileSize: number;
	readonly tilesPerAxis: number;
	readonly planeType: Uint8Array | null;
	readonly planeHeight: Float32Array | null;
};

/**
 * Padded world-space AABB (host's own region frame) over every nav-cell
 * vertex of one object-nav host. Broad-phase reject for the SWorld pick's
 * object leg: a ray segment that misses this box cannot hit any of the
 * host's triangles, so skipping the host cannot change a pick result.
 * Mirrors the standalone Go server's per-mesh vertex-cloud bounds
 * (internal/game/world/movement/objectnav.go).
 */
export type ObjectNavPickBounds = {
	readonly minX: number;
	readonly minY: number;
	readonly minZ: number;
	readonly maxX: number;
	readonly maxY: number;
	readonly maxZ: number;
};

export type RuntimeObjectNavHost = RegionObject &
	RegionLayerObject & {
		readonly runtimeKind: "native-object-nav-host";
		readonly regionWord: number;
		readonly objectIndex: number;
		readonly assetId: number;
		readonly nativeLocalUid18: number;
		readonly nativeRegionId1e: number;
		readonly residentKey403c40: number;
		readonly sourcePath: string;
		readonly meshPath: string;
		readonly mesh: NativeObjectNavMesh;
		readonly objectX: number;
		readonly objectY: number;
		readonly objectZ: number;
		readonly cosYaw: number;
		readonly sinYaw: number;
		residentPayloadBackref04?: unknown;
		readonly cells: RuntimeObjectNavCell[];
		readonly navCellsVec44: RuntimeObjectNavCell[];
		readonly edges: RuntimeObjectNavEdge[];
		readonly outlineEdges24: RuntimeObjectNavEdge[];
		readonly edgeObjectLinks: RuntimeObjectEdgeLink[];
		readonly triggers: EdgeTrigger[];
		readonly kind0c: number;
		readonly passThroughFlag94: boolean;
		readonly objectForwardMatrix20: Matrix44RowMajor;
		readonly objectInverseMatrix60: Matrix44RowMajor;
		meshStateB4: RuntimeObjectNavHost | null;
		lastHitPointF58304: NavHitPoint3 | null;
		moveStepHost04: RegionMoveStepper;
		/** Computed once after the nav records are built; null for a host with no cells. */
		pickBounds: ObjectNavPickBounds | null;
	} & NavHost &
		NavMeshHost &
		NavMeshObjectBoundaryHost &
		ObjNavMeshStepThroughObjectHost &
		NavMeshObjHost &
		NavResidentKeyObject &
		NavRegionOutlineEdgeVector &
		CRTNavMeshObjResolveCellNearestYHost &
		NavMeshInstanceResolveNearestYHost;

export type RuntimeMissingObjectNavHost = ObjMeshHost & {
	readonly runtimeKind: "missing-object-nav-host";
	readonly ownerCell: RuntimeCell;
	readonly objectIndex: number;
	readonly passThroughFlag94: false;
};

export type RuntimeObjectNavCell = RegionObject &
	ObjectNavCell &
	NavCellLinkedEdgeSlots &
	NavCellPlaneY & {
		readonly runtimeKind: "native-object-nav-cell";
		readonly host: RuntimeObjectNavHost;
		readonly cellIndex: number;
		readonly vertexA: number;
		readonly vertexB: number;
		readonly vertexC: number;
		readonly edges: RuntimeObjectNavEdge[];
		linkedEdgeCount24: number;
		linkedEdges28: ( RuntimeObjectNavEdge | null )[];
		moveStepHost04: RegionMoveStepper;
		/** CIObject+0x70 terrain-query surface - see RuntimeCell. */
		isLightSampleValid08: () => boolean;
		getGroundInfoAt0c: ( sectorLocalPos: { x: number; y: number; z: number } ) => number;
		resolveTransformTweenTarget10: ( record: { x: number; y: number; z: number } ) => {
			x: number;
			y: number;
			z: number;
		};
	};

export type RuntimeObjectNavEdge = ObjectNavEdge &
	NavEdgeSideCells &
	NavEdgeLineRecordCache & {
	readonly runtimeKind: "native-object-nav-edge";
	readonly host: RuntimeObjectNavHost;
	readonly edgeGroup: "outline" | "internal";
	readonly edgeIndex: number;
	readonly vertexA: number;
	readonly vertexB: number;
	readonly srcCell: RuntimeObjectNavCell;
	readonly dstCell: RuntimeObjectNavCell | null;
	readonly srcCell0c: RuntimeObjectNavCell;
	readonly dstCell10: RuntimeObjectNavCell | null;
	readonly line: { x1: number; y1: number; x2: number; y2: number };
	lineRecordValid18: boolean;
	readonly vertexA04: RuntimeObjectNavVertex;
	readonly vertexB08: RuntimeObjectNavVertex;
	readonly lineRecord1c: { x1: number; y1: number; x2: number; y2: number };
};

export type RuntimeObjectNavVertex = NavEdgeVertexXZ & NavVertRegionLinkOut & { y: number };

export type RuntimeObjectEdgeLink = {
	readonly neighborObjectIndex: number;
	readonly neighborEdgeIndex: number;
	readonly myEdgeIndex: number;
};

export type ObjectSurfaceSample = {
	readonly host: RuntimeObjectNavHost;
	readonly cell: RuntimeObjectNavCell;
	readonly y: number;
	readonly localY: number;
	readonly cellIndex: number;
};

export type NudgedObjectEntryResult = {
	readonly sample: ObjectSurfaceSample | null;
	readonly flags: number;
};

export type DecodedEdgeBlock = {
	count: number;
	lines: Float32Array;
	flags: Uint8Array;
	assocDirections: Uint8Array;
	assocCells: Uint16Array;
	assocRegions: Uint16Array | null;
};

export type ObjectExitSuppression = {
	readonly sourceHost: RuntimeObjectNavHost;
	readonly cell: RuntimeCell;
	remaining: number;
	readonly regionWord: number;
	readonly localX: number;
	readonly localY: number;
	readonly localZ: number;
};

export type PendingObjectEntryHeightReject = {
	readonly cellIndex: number;
};

export type RuntimeDungeonResidentPayload = NavMeshDungeonResidentPayload<
	string,
	NavMeshResidentObject & CRTNavMeshObjResolveCellNearestYHost
>;

export type RuntimeDungeonHost = CRTNavMeshDungeonResolveSelf<
	string,
	NavMeshResidentObject & CRTNavMeshObjResolveCellNearestYHost
> & {
	readonly runtimeKind: "native-dungeon-nav-host";
	readonly regionWord: number;
	readonly dofName: string;
	readonly handle: DungeonHandle;
	readonly payload: DungeonObjectFile;
	readonly residentPayloadVector40: readonly RuntimeDungeonResidentPayload[];
	readonly residentExtInfoPayloadVector54: readonly RuntimeDungeonResidentPayload[];
	readonly residentObjectCache2098: NavMeshObjCacheLoadMirror<string, RuntimeObjectNavHost>;
};

export type RuntimeDungeonRecord = {
	readonly regionWord: number;
	readonly dofName: string;
	readonly handle: DungeonHandle;
	readonly host: RuntimeDungeonHost;
	readonly record: { resolvePosition0c( pos: RegionPosition ): void };
};

/**
 * The diagnostic view of a RegionPosition owner slot. Every field TYPE is
 * indexed off the real record that carries it, so renaming a field on those
 * records breaks this view (and describeNativeNavOwnerKind) at compile time
 * instead of silently degrading callers' owner labels to "unknown".
 */
type NativeNavOwnerDiagnosticView = {
	runtimeKind?:
		| RuntimeCell["runtimeKind"]
		| RuntimeEdge["runtimeKind"]
		| RuntimeObjectNavHost["runtimeKind"]
		| RuntimeMissingObjectNavHost["runtimeKind"]
		| RuntimeObjectNavCell["runtimeKind"]
		| RuntimeObjectNavEdge["runtimeKind"]
		| RuntimeDungeonHost["runtimeKind"];
	moveStepHost04?: RegionObject["moveStepHost04"];
	terrainStepperB0?: RegionLayerObject["terrainStepperB0"];
	passThroughFlag94?: RuntimeObjectNavHost["passThroughFlag94"] | RuntimeMissingObjectNavHost["passThroughFlag94"];
	assetId?: RuntimeObjectNavHost["assetId"];
};

/*
================
describeNativeNavOwnerKind

Debug label for a RegionPosition owner slot (regionObj / layerObj), for
dev diagnostic surfaces like ?debugMissionInput and the move-click trace.
Lives in this module, next to the runtime records it labels, and reads
them through NativeNavOwnerDiagnosticView so the contract is enforced by
the compiler - the previous structural probe lived in missionGroundPick.ts
and its record30.assetId read silently outlived that field.
================
*/
export function describeNativeNavOwnerKind(
	owner: RegionObject | RegionLayerObject | null | undefined
): string | null {
	if ( !owner ) {
		return null;
	}

	const	record: NativeNavOwnerDiagnosticView = owner;

	if ( typeof record.runtimeKind === "string" ) {
		return record.runtimeKind;
	}
	if ( record.terrainStepperB0 ) {
		return "terrain-layer";
	}
	if ( typeof record.passThroughFlag94 === "boolean" ) {
		return `object-host${record.assetId !== undefined ? `:${record.assetId}` : ""}`;
	}
	return "unknown";
}
