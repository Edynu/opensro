/*
===========================================================================

asset-relay.ts - the character worker's asset requests on the real owner

Port-only, not native (docs/CLIENT_WORKERS_PLAN.md 5.11). The character
worker's presentation shares the four asset request slots with every other
owner, so its requests are issued here, on the main thread's owner: in
their order, each when a slot is free (another owner may have taken the one
the worker saw), and their results go back with the next frame, their
buffers and bitmaps transferred.

===========================================================================
*/
import type { AssetOwner, AssetResult } from "@/engine/contracts/assets";
import type { CharacterWorkerOutput } from "@/engine/contracts/character-worker";
import { ASSET_REQUEST_SLOTS } from "@/engine/foundation/assets/asset-budget";
import { collectTransferables } from "@/engine/foundation/workers/transferables";

type Request = CharacterWorkerOutput["requests"][number];

/*
================
createAssetRelay
================
*/
export function createAssetRelay( assets: Pick<AssetOwner, "available" | "request" | "take" | "cancel"> ) {
	const queued: Request[] = [];
	// The worker's request id and the real owner's.
	const issued = new Map<number, number>();
	let answered: (readonly [number, AssetResult])[] = [];
	/*
	================
	issue

	The queued requests that fit, in order; one the owner refuses is
	answered with its error, as the presentation's own request would have
	thrown.
	================
	*/
	const issue = () => {
		while ( queued.length && assets.available() > 0 ) {
			const request = queued.shift()!;
			try {
				issued.set(
					request.id,
					assets.request( request.url, request.limit, request.decode as Parameters<AssetOwner["request"]>[2] )
				);
			} catch ( error ) {
				answered.push( [ request.id, { kind: "error", id: request.id, error: String( error ) } ] );
			}
		}
	};
	return {
		/*
		================
		receive

		A step's requests and cancellations, in the order the worker made
		them, as its output arrives: a request starts now, not a frame later.
		================
		*/
		receive( requests: readonly Request[], cancels: readonly number[] ) {
			queued.push( ...requests );
			for ( const id of cancels ) {
				const index = queued.findIndex( request => request.id === id );
				if ( index >= 0 ) queued.splice( index, 1 );
				const job = issued.get( id );
				if ( job !== undefined ) {
					issued.delete( id );
					assets.cancel( job );
				}
			}
			issue();
		},
		/*
		================
		poll

		Issue what fits now, take what finished: the frame's answers, their
		transfer list and the slots offered the worker. The worker is offered
		the owner's slots less its own outstanding requests, not what is free
		this instant: a request that cannot start yet waits here and starts
		here, at the start of the main thread's frame (the host steps before
		the world streams), where the presentation would ask on the main
		thread. Offered only what was free, it would ask a frame later and
		lose each freed slot to the world's streaming.
		================
		*/
		poll() {
			issue();
			for ( const [id, job] of issued ) {
				const result = assets.take( job );
				if ( !result ) continue;
				issued.delete( id );
				answered.push( [ id, result ] );
			}
			const results = answered;
			answered = [];
			return {
				results,
				transfer: collectTransferables( results ),
				available: Math.max( 0, ASSET_REQUEST_SLOTS - queued.length - issued.size )
			};
		},
		/*
		================
		dispose

		Releases every request still on the real owner.
		================
		*/
		dispose() {
			for ( const job of issued.values() ) assets.cancel( job );
			issued.clear();
			queued.length = 0;
		}
	};
}
