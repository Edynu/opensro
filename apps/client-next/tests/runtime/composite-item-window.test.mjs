/*
===========================================================================

composite-item-window.test.mjs - the premium package window in the HUD

A click on a package's board slot (6E2840) opens CIFCompositeItemWnd for
that package; a row's button (6AFB40) sends that row's use and closes
the window; cancel, the close button and Escape close it; a package whose
rows end closes it. Driven through the production HUD.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { uiFixture } from "../helpers/ui-fixture.mjs";

const PACKAGE = 10130, RETURN = 4001, REVERSE = 4002;

/*
================
row

One count-job row as the gameplay state publishes it.
================
*/
function row( itemRefObjId, uses, itemName ) {
	return {
		packageRefObjId: PACKAGE,
		itemRefObjId,
		uses,
		remainingSec: 2419200,
		receivedAtMs: 0,
		reference: { typeFlags: 0x72ec, periodSec: 2419200, name: "Gold Time" },
		itemName
	};
}

/*
================
open

A fixture in the world with two limited items, settled and stepped.
================
*/
function open( sent ) {
	const f = uiFixture( command => sent.push( command ) );
	f.state.gameplay = {
		...f.state.gameplay,
		countJobs: [ row( RETURN, 3, "Instant return" ), row( REVERSE, 0, "Reverse return" ) ]
	};
	for ( let time = 0; time < 1200; time += 100 ) f.ui.step( f.state, time );
	return f;
}

/*
================
controlIds
================
*/
function controlIds( result ) {
	return result.controls.map( c => c.id ).filter( id => id.startsWith( "composite-item" ) );
}

test("a package slot opens its window, and a row's button sends that row", () => {
	const sent = [], f = open( sent );
	try {
		f.ui.event( { kind: "activate", id: "count-job:" + PACKAGE } );
		const shown = f.ui.step( f.state, 1300 );
		assert.deepEqual( controlIds( shown ), [
			"composite-item-close",
			"composite-item:" + RETURN,
			"composite-item:" + REVERSE,
			"composite-item-cancel"
		] );
		// 6AF780: a row without uses is a disabled button.
		assert.equal( shown?.controls.find( c => c.id === "composite-item:" + REVERSE )?.disabled, true );
		assert.ok( f.hasText( "Instant return(3)" ) );
		f.ui.event( { kind: "activate", id: "composite-item:" + RETURN } );
		const closed = f.ui.step( f.state, 1400 );
		assert.deepEqual( controlIds( closed ), [] );
		const uses = sent.filter( c => c.kind === "gameplay" && c.command.kind === "count-job-use" );
		assert.deepEqual( uses.map( c => c.command ), [ {
			kind: "count-job-use",
			packageRefObjId: PACKAGE,
			itemRefObjId: RETURN
		} ] );
	} finally {
		f.dispose();
	}
});

test("cancel, the close button and Escape close the window without a use", () => {
	const sent = [], f = open( sent );
	try {
		for ( const close of [ "composite-item-cancel", "composite-item-close", "Escape" ] ) {
			f.ui.event( { kind: "activate", id: "count-job:" + PACKAGE } );
			assert.notDeepEqual( controlIds( f.ui.step( f.state, 1300 ) ), [] );
			f.ui.event( close === "Escape" ? { kind: "key", code: "Escape" } : { kind: "activate", id: close } );
			assert.deepEqual( controlIds( f.ui.step( f.state, 1400 ) ), [] );
		}
		assert.equal( sent.filter( c => c.kind === "gameplay" && c.command.kind === "count-job-use" ).length, 0 );
	} finally {
		f.dispose();
	}
});

test("the window closes when its package's rows end", () => {
	const sent = [], f = open( sent );
	try {
		let latest;
		const step = now => (latest = f.ui.step( f.state, now ) ?? latest);
		f.ui.event( { kind: "activate", id: "count-job:" + PACKAGE } );
		assert.notDeepEqual( controlIds( step( 1300 ) ), [] );
		f.state.gameplay = { ...f.state.gameplay, countJobs: [] };
		step( 1400 );
		// The package returns, but the closed window stays closed.
		f.state.gameplay = { ...f.state.gameplay, countJobs: [ row( RETURN, 3, "Instant return" ) ] };
		assert.deepEqual( controlIds( step( 1500 ) ), [] );
	} finally {
		f.dispose();
	}
});
