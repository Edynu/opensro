/*
===========================================================================

companion-rentals.ts - displayed summoner rental time on the simulation clock

The server owns lease expiry. This owner only counts down received durations
and returns item replacements for the inventory owner to publish.

===========================================================================
*/
import type { InventoryItem } from "@/engine/contracts/gameplay";

const MILLISECONDS_PER_SECOND = 1000;

/*
================
createCompanionRentals
================
*/
export function createCompanionRentals() {
	let deadlines = new WeakMap<InventoryItem, number>();
	return {
		/*
================
step

New authoritative item bodies establish new durations. Locally decremented
bodies inherit their original deadline so frame frequency cannot extend rent.
================
		*/
		step( items: Iterable<InventoryItem>, now: number ): InventoryItem[] {
			const updates: InventoryItem[] = [];
			for ( const item of items ) {
				const summon = item.summon;
				if ( !summon || summon.remainingSeconds === undefined ) continue;
				const deadline = deadlines.get( item ) ?? now + summon.remainingSeconds * MILLISECONDS_PER_SECOND;
				deadlines.set( item, deadline );
				const remainingSeconds = Math.max( 0, Math.ceil( (deadline - now) / MILLISECONDS_PER_SECOND ) );
				if ( remainingSeconds === summon.remainingSeconds ) continue;
				const next = { ...item, summon: { ...summon, remainingSeconds } };
				deadlines.set( next, deadline );
				updates.push( next );
			}
			return updates;
		},
		/*
================
reset
================
		*/
		reset() {
			deadlines = new WeakMap();
		}
	};
}
