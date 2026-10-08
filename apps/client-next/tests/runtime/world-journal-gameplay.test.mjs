/*
===========================================================================

world-journal-gameplay.test.mjs - gameplay publication and delivery contracts

A gameplay snapshot published while an older one is still queued merges
into it. The merged batch must present exactly what the unmerged
sequence presents, and a world reset stays a barrier.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { defined } from "../helpers/defined.mjs";
const { createEntities } = await import(
	"../../src/engine/runtime/simulation/worker/session/world/entities/entities.ts"
);
const { createPresentation } = await import( "../../src/engine/runtime/presentation/presentation.ts" );
const { mergeGameplaySnapshots } = await import( "../../src/engine/foundation/gameplay/gameplay-snapshot.ts" );

// The shop and social values are opaque here: only their identity is checked.
const CATALOG = [ { id: 1, name: "skill" } ];
const SOCIAL = /** @type {any} */ (Object.freeze( { party: [] } ));
const SHOP = /** @type {any} */ (Object.freeze( { npc: 1 } ));

// What the worker publishes over three ticks (core.ts omits unchanged parts).
/** @type {any[]} */
const SNAPSHOTS = [
	{ localGid: 1, skillCatalog: CATALOG, shop: SHOP },
	{ localGid: 2, social: SOCIAL },
	{ localGid: 3, shop: undefined }
];

/*
================
snapshot

Every dynamic field is a replacement, even when it contains an empty value.
================
*/
/** @returns {import("../../src/engine/contracts/gameplay").GameplayState} */
function snapshot( /** @type {Partial<import("../../src/engine/contracts/gameplay").GameplayState>} */ changes = {} ) {
	return {
		revision: 1,
		localGid: 1,
		pose: null,
		authoritativePose: null,
		pendingMoves: 0,
		acknowledgedMove: 0,
		target: 0,
		targetPending: 0,
		inventory: [],
		inventoryPending: false,
		vitals: [],
		casts: [],
		error: null,
		...changes
	};
}

/*
================
gameplayEvent
================
*/
/** @returns {import("../../src/engine/contracts/world").WorldEvent} */
function gameplayEvent( /** @type {any} */ state ) {
	return { kind: "gameplay", state };
}

/*
================
presented

The gameplay state presentation shows after one batch.
================
*/
function presented( /** @type {readonly import("../../src/engine/contracts/world").WorldEvent[]} */ events ) {
	const presentation = createPresentation();
	presentation.apply( { sequence: 1, events } );
	return defined( presentation.gameplay(), "presented gameplay" );
}

/*
================
queuedGids

The localGid of each gameplay event in a batch, or the kind of any other.
================
*/
function queuedGids( /** @type {import("../../src/engine/contracts/world").WorldBatch | null} */ batch ) {
	return defined( batch, "batch" ).events.map( event =>
		event.kind === "gameplay" ? event.state.localGid : event.kind
	);
}

test("queued gameplay snapshots merge into one that presents the same state", () => {
	const entities = createEntities();
	for ( const state of SNAPSHOTS ) entities.publish( gameplayEvent( state ) );
	const batch = defined( entities.take(), "batch" );
	assert.equal( batch.events.length, 1 );
	const merged = presented( batch.events );
	assert.deepEqual( merged, presented( SNAPSHOTS.map( gameplayEvent ) ) );
	assert.equal( merged.localGid, 3 );
	assert.equal( merged.skillCatalog, CATALOG );
	assert.equal( merged.social, SOCIAL );
	assert.ok( "shop" in merged );
	assert.equal( merged.shop, undefined );
});

test("an earlier shop survives a merge that does not name one", () => {
	const entities = createEntities();
	entities.publish( gameplayEvent( { localGid: 1, shop: SHOP } ) );
	entities.publish( gameplayEvent( { localGid: 2 } ) );
	assert.equal( presented( defined( entities.take(), "batch" ).events ).shop, SHOP );
});

test("an offered batch is never rewritten and a reset is a merge barrier", () => {
	const entities = createEntities();
	entities.publish( gameplayEvent( { localGid: 1 } ) );
	const first = defined( entities.take(), "first batch" );
	entities.publish( gameplayEvent( { localGid: 2 } ) );
	assert.deepEqual( queuedGids( first ), [ 1 ] );
	entities.clear();
	entities.publish( gameplayEvent( { localGid: 3 } ) );
	entities.ack( first.sequence );
	assert.deepEqual( queuedGids( entities.take() ), [ 2, "reset", 3 ] );
});

test("the shared merge retains only publication fields and does not mutate inputs", () => {
	const previous = Object.freeze( snapshot( {
		skillCatalog: [],
		social: SOCIAL,
		shop: SHOP,
		target: 7,
		error: "old",
		castPrediction: { token: 1, caster: 1, skill: 2, target: 7, damage: 0, fatal: false }
	} ) );
	const next = Object.freeze( snapshot() );
	const merged = mergeGameplaySnapshots( previous, next );
	assert.equal( merged.skillCatalog, previous.skillCatalog );
	assert.equal( merged.social, SOCIAL );
	assert.equal( merged.shop, SHOP );
	assert.equal( merged.target, 0 );
	assert.equal( merged.error, null );
	assert.equal( merged.castPrediction, undefined );
	assert.equal( merged.inventory, next.inventory );
	assert.equal( merged.casts, next.casts );
	assert.equal( "shop" in next, false );
	assert.equal( previous.target, 7 );
	const replacement = snapshot( { skillCatalog: [], social: { ...SOCIAL }, shop: undefined } );
	const replaced = mergeGameplaySnapshots( merged, replacement );
	assert.equal( replaced.skillCatalog, replacement.skillCatalog );
	assert.equal( replaced.social, replacement.social );
	assert.equal( "shop" in replaced, true );
	assert.equal( replaced.shop, undefined );
});

test("omission-only batches retain delivered values while an explicit shop close survives coalescing", () => {
	const entities = createEntities();
	const presentation = createPresentation();
	entities.publish( gameplayEvent( snapshot( { skillCatalog: [], social: SOCIAL, shop: SHOP } ) ) );
	const first = defined( entities.take(), "first batch" );
	presentation.apply( first );
	const initial = defined( presentation.gameplay(), "initial gameplay" );
	entities.ack( first.sequence );
	entities.publish( gameplayEvent( snapshot( { revision: 2 } ) ) );
	entities.publish( gameplayEvent( snapshot( { revision: 3 } ) ) );
	const second = defined( entities.take(), "second batch" );
	assert.equal( second.events.length, 1 );
	const event = defined( second.events[0], "coalesced gameplay" );
	assert.equal( event.kind, "gameplay" );
	if ( event.kind !== "gameplay" ) throw new Error( "Expected gameplay" );
	assert.equal( "shop" in event.state, false );
	presentation.apply( second );
	const carried = defined( presentation.gameplay(), "carried gameplay" );
	assert.equal( carried.revision, 3 );
	assert.equal( carried.shop, SHOP );
	assert.equal( carried.social, SOCIAL );
	assert.equal( carried.skillCatalog, initial.skillCatalog );
	assert.equal( carried.skillIndex, initial.skillIndex );
	entities.ack( second.sequence );
	entities.publish( gameplayEvent( snapshot( { shop: undefined } ) ) );
	entities.publish( gameplayEvent( snapshot() ) );
	const third = defined( entities.take(), "shop close batch" );
	presentation.apply( third );
	assert.equal( defined( presentation.gameplay(), "closed shop" ).shop, undefined );
	entities.ack( third.sequence );
	entities.clear();
	entities.publish( gameplayEvent( snapshot() ) );
	presentation.apply( defined( entities.take(), "reset batch" ) );
	const reset = defined( presentation.gameplay(), "reset gameplay" );
	assert.equal( reset.skillCatalog, undefined );
	assert.equal( reset.skillIndex, undefined );
	assert.equal( reset.social, undefined );
	assert.equal( reset.shop, undefined );
});

test("coalescing preserves interleaved reliable events and completed casts", () => {
	const entities = createEntities();
	const cast = { token: 7, caster: 1, skill: 2, target: 1, damage: 0, fatal: false };
	/** @type {import("../../src/engine/contracts/world").WorldEvent[]} */
	const reliable = [
		{ kind: "hp-seed", gid: 1, hp: 100 },
		{ kind: "cast-finalize", cast },
		{ kind: "buff-ended", gid: 1, at: 100 },
		{ kind: "orb-gauge", value: 3 },
		{ kind: "native", opcode: 1, payload: new Uint8Array( [ 1 ] ) }
	];
	const original = [
		gameplayEvent( snapshot( { casts: [ cast ] } ) ),
		...reliable,
		gameplayEvent( snapshot( { vitals: [ { gid: 1, hp: 0 } ] } ) )
	];
	for ( const event of original ) entities.publish( event );
	const batch = defined( entities.take(), "mixed batch" );
	assert.deepEqual( batch.events.filter( event => event.kind !== "gameplay" ), reliable );
	const merged = createPresentation(), sequential = createPresentation();
	merged.apply( batch );
	sequential.apply( { sequence: 1, events: original } );
	assert.deepEqual( merged.gameplay(), sequential.gameplay() );
	assert.deepEqual( defined( merged.gameplay(), "completed cast" ).casts, [ cast ] );
	assert.deepEqual( defined( merged.gameplay(), "effective HP" ).vitals, [ { gid: 1, hp: 100 } ] );
	assert.deepEqual( merged.takeSounds(), [ reliable[2] ] );
	assert.deepEqual( merged.takeFeedback(), [ reliable[3] ] );
	assert.deepEqual( merged.takeNative(), [ reliable[4] ] );
	merged.finishedCasts();
	assert.deepEqual( defined( merged.gameplay(), "released cast" ).casts, [] );
});
