/*
===========================================================================

asset-budget.ts - the asset owner's request slots and per-request byte limits

The main thread's asset owner (runtime/assets/assets.ts) holds this many
requests at once for every runtime owner together; the character worker's
relay (runtime/character-worker/asset-relay.ts) offers the worker no more.

===========================================================================
*/
import type { AssetRequest } from "@/engine/contracts/assets";

export const ASSET_REQUEST_SLOTS = 4;

/*
================
assetRequestBudget

The most bytes one request of decode may read.
================
*/
export function assetRequestBudget( decode: Extract<AssetRequest, { kind: "load"; }>["decode"] ): number {
	// `effect` reads the shared EasyFX catalog, not one decoded character model.
	// Its native resource closure exceeds 32 MiB. Model/image residency keeps its
	// own independent bounds; the encoded catalog is retained once per worker.
	return (decode === "world" || decode === "frontend-world" || decode === "navigation" ?
		128 :
		decode === "effect" ?
		64 :
		decode === "effects" ?
		32 :
		16) * 1048576;
}
