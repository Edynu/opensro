/*
===========================================================================

journal-batches.mjs - world batches as the simulation worker publishes them

A deterministic stream of world batches for the shared journal's tests
(foundation/workers/shared-journal.ts): entities spawn, change and
despawn, each new state a shallow spread of the last, so an unchanged
nested value (equipment, appearance) keeps its identity, as the worker's
entity journal keeps it; gameplay snapshots keep their catalog; resets,
sounds and native payloads come between.

===========================================================================
*/
import { createRandom } from "./walk-scenario.mjs";

/*
================
journalBatches

count batches from seed, sequences from 1.
================
*/
/** @returns {any[]} */
export function journalBatches( seed, count ) {
	const random = createRandom( seed ), live = new Map(), batches = [];
	const catalog = Array.from( { length: 50 }, ( _, i ) => ({ id: i, name: `skill ${i}` }) );
	/** @type {any} */
	let gameplay = { localGid: 1, catalog, hp: 100, chat: [] };
	const number = () => Math.round( random() * 100000 ) / 100;
	for ( let sequence = 1; sequence <= count; sequence++ ) {
		const events = [];
		for ( let n = Math.floor( random() * 8 ); n > 0; n-- ) {
			const roll = random(), gid = 1 + Math.floor( random() * 30 ), entity = live.get( gid );
			if ( !entity || roll < .1 ) {
				const spawned = {
					gid,
					kind: "player",
					name: `Player\u{1F525}${gid}`,
					regionId: 25000,
					x: number(),
					y: 0,
					z: number(),
					heading: number(),
					equipment: [ { slot: 1, id: gid * 10, plus: 3 }, { slot: 6, id: gid * 10 + 1, plus: 0 } ],
					appearanceState: [ 1, 0, 0 ],
					moving: false,
					ownerName: undefined
				};
				live.set( gid, spawned );
				events.push( { kind: "spawn", entity: spawned } );
			} else if ( roll < .7 ) {
				const next = { ...entity, x: number(), z: number(), moving: random() < .5 };
				if ( random() < .1 ) next.equipment = [ ...entity.equipment, { slot: 2, id: 7, plus: 1 } ];
				if ( random() < .1 ) next.name = `Renamed ${gid}`;
				if ( random() < .1 ) delete next.ownerName;
				if ( random() < .1 ) next.movementPath = { points: Float32Array.of( number(), number() ), loop: false };
				live.set( gid, next );
				events.push( { kind: "state", entity: next } );
			} else if ( roll < .8 ) {
				live.delete( gid );
				events.push( { kind: "despawn", gid } );
			} else if ( roll < .9 ) {
				gameplay = {
					...gameplay,
					hp: Math.floor( random() * 100 ),
					...(random() < .3 ? { chat: [ ...gameplay.chat, `line ${sequence} ${"x".repeat( 5000 )}` ] } : {})
				};
				events.push( { kind: "gameplay", state: gameplay } );
			} else if ( roll < .97 ) {
				events.push( { kind: "native", opcode: 0x3013, payload: Uint8Array.of( 1, 2, 3, sequence & 255 ) } );
			} else {
				live.clear();
				events.push( { kind: "reset", epoch: sequence } );
			}
		}
		// The worker stamps how long the batch's oldest event waited (entities.ts).
		batches.push(
			sequence % 3 ? { sequence, spanMs: Math.floor( random() * 1000 ), events } : { sequence, events }
		);
	}
	return batches;
}
