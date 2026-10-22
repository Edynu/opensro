/*
===========================================================================

asset-stand-in.ts - the asset owner the character worker's presentation asks

Port-only, not native (docs/CLIENT_WORKERS_PLAN.md 5.11). Every runtime
owner shares the main thread's four asset request slots, so the worker's
presentation does not load assets itself: its requests and cancellations
go to the main thread with its output, which issues them on the real owner
and posts their results back with the next frame. The calls answer as the
real owner's do against the slots the relay offers (asset-relay.ts poll).

===========================================================================
*/
import type { AssetResult, PresentationAssets } from "@/engine/contracts/assets";
import type { CharacterWorkerOutput } from "@/engine/contracts/character-worker";
import { assetRequestBudget } from "@/engine/foundation/assets/asset-budget";
import { collectTransferables } from "@/engine/foundation/workers/transferables";

// The real owner's default request limit (assets.ts request).
const DEFAULT_LIMIT = 16 << 20;

/*
================
closeResult

What the real owner's cancel releases of a result nobody takes.
================
*/
function closeResult( result: AssetResult ) {
	if ( result.kind === "character" ) {
		for ( const image of result.images ) {
			if ( !("kind" in image) ) image.close();
		}
	} else if ( result.kind === "image" ) result.image.close();
}

/*
================
createAssetStandIn

delivered collects the buffers and bitmaps of every result handed to the
presentation (renderer-stand-in.ts moves them on instead of copying).
================
*/
export function createAssetStandIn( delivered: WeakSet<object> ) {
	let available = 0, next = 0;
	let requests: CharacterWorkerOutput["requests"][number][] = [], cancels: number[] = [];
	// Requests the main thread has not answered, and answers not yet taken.
	const pending = new Set<number>(), results = new Map<number, AssetResult>();
	const assets: PresentationAssets = {
		available: () => available,
		request( url, limit = DEFAULT_LIMIT, decode ) {
			if (
				available <= 0 || !Number.isSafeInteger( limit ) || limit < 1 || limit > assetRequestBudget( decode )
			) {
				throw new Error( "Asset request exceeds budget" );
			}
			available--;
			const id = ++next;
			pending.add( id );
			requests.push( { id, url, limit, decode } );
			return id;
		},
		take( id ) {
			const result = results.get( id );
			if ( !result ) return null;
			results.delete( id );
			return result;
		},
		cancel( id ) {
			const result = results.get( id );
			if ( result ) {
				results.delete( id );
				closeResult( result );
				return;
			}
			if ( pending.delete( id ) ) cancels.push( id );
		}
	};
	return {
		assets,
		/*
		================
		frame

		The main thread's free slots and the answers it posted.
		================
		*/
		frame( free: number, answered: readonly (readonly [number, AssetResult])[] ) {
			available = Math.max( 0, free );
			for ( const [id, result] of answered ) {
				if ( !pending.delete( id ) ) {
					closeResult( result );
					continue;
				}
				for ( const value of collectTransferables( result ) ) delivered.add( value );
				results.set( id, { ...result, id } as AssetResult );
			}
		},
		/*
		================
		take

		This step's requests and cancellations for the output.
		================
		*/
		take() {
			const taken = { requests, cancels };
			requests = [];
			cancels = [];
			return taken;
		}
	};
}
