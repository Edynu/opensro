/*
===========================================================================

experimental-options.test.mjs - explicit opt-in and draft cancellation

Browser additions stay off until a valid saved preference or Confirm enables
them. Opening again discards changes that were never confirmed. Every video
stage defaults off, which is the native frame.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

const experimentalModule = await import(
	"../../src/engine/foundation/ui/experimental-options.ts"
);
const { experimentalGameplay, experimentalOptions, experimentalVideo, renderScales } = experimentalModule;
const { createExperimentalHud, EXPERIMENTAL_TABS } = await import(
	"../../src/engine/runtime/ui/hud/experimental-hud.ts"
);
const { MAX_FRAME_WORKERS } = await import( "../../src/engine/foundation/workers/frame-jobs.ts" );

const OFF = Object.freeze( {
	renderScale: 100,
	frameWorkers: "off",
	chatTimestamps: false,
	developerDiagnostics: false,
	postProcessing: false,
	anisotropicFiltering: false,
	heightFog: false,
	dynamicSun: false,
	floatBloom: false,
	hdrToneMap: false,
	sunShadow: false,
	perPixelLighting: false,
	predictedRunUp: false,
	// On by default (owner 2026-10-15): the camera eases its height and release.
	smoothCamera: true,
	// On by default (owner 2026-10-17): +8 and higher weapons and shields wear enchant sparks.
	enchantSparks: true,
	// On by default (owner 2026-10-14); it changes only devices without BC.
	compressedTextures: true,
	// On by default (owner 2026-10-14): near effects outrank far characters.
	sharedActorRoom: true,
	// Off by default (port-only): every effect instance is its own model.
	batchedEffects: false,
	// On by default (owner 2026-10-15): a disabled tab is dimmed.
	greyDisabledTabs: true,
	// On by default (owner 2026-10-15): the shard's job-kill notices show.
	jobKillNotices: true,
	// On by default (owner 2026-10-15): the shard's drop and plus notices show.
	dropPlusNotices: true,
	// On by default (owner 2026-10-19): the shard's +7 notices show.
	plusSevenNotices: true,
	// Off by default: V hides only monsters and players, as the original does.
	vHidesCompanions: false,
	// On by default (port-only, not native): hides characters in dungeon blocks the active block does not draw.
	dungeonCharacterPvs: true,
	// On by default (owner 2026-10-15): labels and lists stay inside their window.
	fitWindowLabels: true,
	// On by default (owner 2026-10-15): a drop on a bag tab moves the item there.
	dropOnBagTab: true,
	// On by default (owner 2026-10-15): a notice's player and item are links.
	noticeLinks: true,
	// On by default (owner 2026-10-15): the notice banner shows for 5 s.
	shortNotices: true,
	attackPetTraining: false,
	// On by default (owner 2026-10-15): Withdraw asks before a guild ban.
	confirmGuildBan: true,
	// Off by default: straight projectiles keep their launch-captured endpoint (8D8580).
	homingProjectiles: false,
	// On by default (owner 2026-10-18, BUG-086): clicking CIFPetMiniInfo opens CIFCos;
	// off restores the native no-op click (6B3760).
	petClickOpensWindow: true,
	// On by default (owner 2026-10-20): keep bit 0x80 enabled on 0xB4/0xB5 so the
	// pet keeps picking up gold when full; off restores the native 0x0077DD61 disable.
	smartPetPickup: true,
	// Off by default: the M window shows only the five native towns and 28 x 8 overview.
	expandedWorldMap: false
} );

test("only an explicit boolean enables chat timestamps", () => {
	for ( const value of [ undefined, null, [], {}, true, { chatTimestamps: "true" }, { chatTimestamps: 1 } ] ) {
		assert.equal( experimentalOptions( value ).chatTimestamps, false );
	}
	assert.equal( experimentalOptions( { chatTimestamps: true, developerDiagnostics: false } ).chatTimestamps, true );
});

test("experimental drafts require Confirm and Default only changes the draft", () => {
	const hud = createExperimentalHud();
	assert.equal( hud.state().saved.chatTimestamps, false );
	hud.open();
	hud.toggle( "chatTimestamps" );
	assert.equal( hud.state().draft.chatTimestamps, true );
	assert.equal( hud.state().saved.chatTimestamps, false );
	hud.open();
	assert.equal( hud.state().draft.chatTimestamps, false );
	hud.toggle( "chatTimestamps" );
	assert.deepEqual( hud.confirm(), { ...OFF, chatTimestamps: true } );
	hud.reset();
	assert.equal( hud.state().draft.chatTimestamps, false );
	assert.equal( hud.state().saved.chatTimestamps, true );
	hud.open();
	assert.equal( hud.state().draft.chatTimestamps, true );
	hud.reset();
	assert.deepEqual( hud.confirm(), OFF );
	hud.restore( { ...OFF, chatTimestamps: true } );
	assert.deepEqual( hud.state(), {
		saved: { ...OFF, chatTimestamps: true },
		draft: { ...OFF, chatTimestamps: true },
		tab: 0
	} );
});

/*
================
Developer diagnostics opt-in
================
*/
test("diagnostics default off and follow the same draft lifecycle", () => {
	for ( const value of [ undefined, null, [], {}, { developerDiagnostics: "true" }, { developerDiagnostics: 1 } ] ) {
		assert.equal( experimentalOptions( value ).developerDiagnostics, false );
	}
	const hud = createExperimentalHud();
	hud.toggle( "developerDiagnostics" );
	assert.equal( hud.state().draft.developerDiagnostics, true );
	assert.equal( hud.state().saved.developerDiagnostics, false );
	hud.open();
	assert.equal( hud.state().draft.developerDiagnostics, false );
	hud.toggle( "developerDiagnostics" );
	assert.equal( hud.confirm().developerDiagnostics, true );
	hud.reset();
	assert.equal( hud.state().saved.developerDiagnostics, true );
	hud.open();
	assert.equal( hud.state().draft.developerDiagnostics, true );
	hud.reset();
	assert.equal( hud.confirm().developerDiagnostics, false );
});

/*
================
Video stages
================
*/
test("every video stage defaults off and only an explicit true enables it", () => {
	assert.deepEqual( experimentalOptions(), OFF );
	assert.deepEqual( experimentalVideo( experimentalOptions() ), {
		renderScale: 100,
		postProcessing: false,
		anisotropicFiltering: false,
		heightFog: false,
		dynamicSun: false,
		floatBloom: false,
		hdrToneMap: false,
		sunShadow: false,
		perPixelLighting: false,
		// Smooth camera is on by default (owner 2026-10-15).
		smoothCamera: true,
		// Enchant sparks are on by default (owner 2026-10-17).
		enchantSparks: true,
		// The shared actor room is on by default (owner 2026-10-14).
		sharedActorRoom: true,
		batchedEffects: false,
		vHidesCompanions: false,
		dungeonCharacterPvs: true
	} );
	for (
		const key of [
			"postProcessing",
			"anisotropicFiltering",
			"heightFog",
			"dynamicSun",
			"floatBloom",
			"hdrToneMap",
			"sunShadow",
			"perPixelLighting"
		]
	) {
		assert.equal( experimentalOptions( { [key]: 1 } )[key], false );
		assert.equal( experimentalOptions( { [key]: "true" } )[key], false );
		assert.equal( experimentalOptions( { [key]: true } )[key], true );
		assert.equal( experimentalVideo( experimentalOptions( { [key]: true } ) )[key], true );
	}
});

test("a saved preference holding the retired relief and horizon rows loads cleanly and ignores them", () => {
	// Both rows were removed at the owner's request (2026-10-11): a browser
	// that saved them on still loads, the keys are dropped, and the other
	// stages keep their saved values.
	const saved = { terrainRelief: true, texturedHorizon: true, heightFog: true, renderScale: 75 };
	const options = experimentalOptions( saved );
	assert.deepEqual( options, { ...OFF, heightFog: true, renderScale: 75 } );
	assert.equal( "terrainRelief" in options, false );
	assert.equal( "texturedHorizon" in experimentalVideo( options ), false );
	const ids = /** @type {string[]} */ (EXPERIMENTAL_TABS.flatMap( tab => tab.rows ).map( row => row.key ));
	assert.ok( !ids.includes( "terrainRelief" ) && !ids.includes( "texturedHorizon" ) );
});

test("new environment preferences persist only on Confirm and Default remains a draft", () => {
	for (
		const key of /** @type {const} */ ([
			"dynamicSun",
			"floatBloom",
			"hdrToneMap",
			"sunShadow",
			"perPixelLighting"
		])
	) {
		const hud = createExperimentalHud();
		hud.open();
		hud.toggle( key );
		assert.deepEqual( hud.state().saved, OFF );
		const saved = hud.confirm();
		assert.deepEqual( saved, { ...OFF, [key]: true } );
		const restored = createExperimentalHud();
		restored.restore( experimentalOptions( JSON.parse( JSON.stringify( saved ) ) ) );
		restored.open();
		assert.equal( restored.state().draft[key], true );
		restored.reset();
		assert.deepEqual( restored.state().draft, OFF );
		assert.equal( restored.state().saved[key], true );
		restored.open();
		assert.equal( restored.state().draft[key], true, "Unconfirmed Default must be discarded" );
		restored.reset();
		assert.deepEqual( restored.confirm(), OFF );
		restored.open();
		assert.deepEqual( restored.state().draft, OFF );
	}
});

/*
================
Tabs
================
*/
test("the window's tabs cover every preference once and Open returns to Image", () => {
	assert.deepEqual(
		EXPERIMENTAL_TABS.map( tab => tab.title ),
		[ "Image", "World", "Lighting", "Game", "Notices", "Other", "Pets" ]
	);
	// Lighting keeps the direct-light stages; render scale joins Image without
	// changing the indices used to reopen the existing tabs.
	assert.deepEqual(
		EXPERIMENTAL_TABS[2].rows.map( row => row.key ),
		[ "sunShadow", "perPixelLighting", "enchantSparks", "dungeonCharacterPvs" ]
	);
	for ( const tab of EXPERIMENTAL_TABS ) assert.ok( tab.rows.length <= 6, "At most six rows a tab" );
	const keys = EXPERIMENTAL_TABS.flatMap( tab => tab.rows.map( row => row.key ) ).sort();
	assert.deepEqual( keys, Object.keys( OFF ).sort() );
	const ids = EXPERIMENTAL_TABS.flatMap( tab => tab.rows.map( row => row.id ) );
	assert.equal( new Set( ids ).size, ids.length );
	const hud = createExperimentalHud();
	hud.selectTab( 4 );
	assert.equal( hud.state().tab, 4 );
	hud.open();
	assert.equal( hud.state().tab, 0 );
	assert.throws( () => hud.selectTab( EXPERIMENTAL_TABS.length ) );
	assert.throws( () => hud.selectTab( -1 ) );
});

/*
================
Render scale preferences
================
*/
test("render scale accepts only explicit numeric selections and reaches the renderer slice", () => {
	assert.deepEqual( renderScales(), [ 100, 75, 50 ] );
	for ( const renderScale of renderScales() ) {
		const saved = experimentalOptions( JSON.parse( JSON.stringify( { renderScale } ) ) );
		assert.equal( saved.renderScale, renderScale );
		assert.equal( experimentalVideo( saved ).renderScale, renderScale );
	}
	for ( const renderScale of [ undefined, null, true, false, "75", "50", 0, 25, 74.9, 101, NaN, Infinity, [], {} ] ) {
		assert.equal( experimentalOptions( { renderScale } ).renderScale, 100 );
	}
	for ( const legacy of [ undefined, null, [], {}, { chatTimestamps: true } ] ) {
		assert.equal( experimentalOptions( legacy ).renderScale, 100 );
	}
});

/*
================
Render scale restoration and reset
================
*/
test("restored render scale survives toggles and unconfirmed Default but confirmed Default restores native", () => {
	for ( const renderScale of renderScales() ) {
		const hud = createExperimentalHud();
		hud.restore( experimentalOptions( { renderScale } ) );
		hud.open();
		hud.toggle( "chatTimestamps" );
		assert.equal( hud.confirm().renderScale, renderScale );
		hud.reset();
		assert.equal( hud.state().draft.renderScale, 100 );
		assert.equal( hud.state().saved.renderScale, renderScale );
		hud.open();
		assert.equal( hud.state().draft.renderScale, renderScale );
		hud.reset();
		assert.equal( hud.confirm().renderScale, 100 );
	}
});

/*
================
Retired Video render scale
================
*/
test("legacy Video render scale is discarded without changing native Video records", async () => {
	const { defaultVideoOptions, videoOptions } = await import(
		"../../src/engine/foundation/rendering/video-options.ts"
	);
	const defaults = defaultVideoOptions();
	for ( const renderScale of [ 100, 75, 50, "50", null, -1 ] ) {
		const restored = videoOptions( { ...defaults, renderScale } );
		assert.deepEqual( restored, defaults );
		assert.equal( Object.hasOwn( restored, "renderScale" ), false );
	}
});

/*
================
Render scale draft selection
================
*/
test("render scale selections remain drafts until Confirm and reject unsupported values", () => {
	const hud = createExperimentalHud();
	for ( const renderScale of renderScales() ) {
		hud.open();
		hud.select( "renderScale", String( renderScale ) );
		assert.equal( hud.state().draft.renderScale, renderScale );
		assert.equal( hud.state().saved.renderScale, 100 );
		hud.open();
		assert.equal( hud.state().draft.renderScale, 100 );
		hud.select( "renderScale", String( renderScale ) );
		assert.equal( hud.confirm().renderScale, renderScale );
		hud.select( "renderScale", "25" );
		hud.select( "renderScale", "NaN" );
		hud.select( "renderScale", "Infinity" );
		assert.equal( hud.state().draft.renderScale, renderScale );
		hud.reset();
		hud.confirm();
	}
});

/*
================
Gameplay rows
================
*/
test("the predicted run-up defaults off and reaches only the worker's slice", () => {
	// The native press (6FCD50) never walks before the server answers.
	assert.deepEqual( experimentalGameplay( experimentalOptions() ), {
		predictedRunUp: false,
		jobKillNotices: true,
		dropPlusNotices: true,
		plusSevenNotices: true,
		homingProjectiles: false,
		smartPetPickup: true
	} );
	for ( const value of [ 1, "true", null, {} ] ) {
		assert.equal( experimentalOptions( { predictedRunUp: value } ).predictedRunUp, false );
	}
	const on = experimentalOptions( { predictedRunUp: true } );
	assert.deepEqual( experimentalGameplay( on ), {
		predictedRunUp: true,
		jobKillNotices: true,
		dropPlusNotices: true,
		plusSevenNotices: true,
		homingProjectiles: false,
		smartPetPickup: true
	} );
	assert.equal( "predictedRunUp" in experimentalVideo( on ), false );
});

test("compressed textures are on unless explicitly false, and the stored reader parses the saved key", () => {
	const { storedExperimentalOptions, EXPERIMENTAL_STORAGE_KEY } = experimentalModule;
	for ( const value of [ undefined, null, {}, { compressedTextures: 1 }, { compressedTextures: "false" } ] ) {
		assert.equal( experimentalOptions( value ).compressedTextures, true );
	}
	assert.equal( experimentalOptions( { compressedTextures: false } ).compressedTextures, false );
	const saved = new Map( [ [ EXPERIMENTAL_STORAGE_KEY, JSON.stringify( { compressedTextures: false } ) ] ] );
	const storage = { getItem: key => saved.get( key ) ?? null };
	assert.equal( storedExperimentalOptions( storage ).options.compressedTextures, false );
	assert.equal( storedExperimentalOptions( { getItem: () => null } ).options.compressedTextures, true );
	assert.equal( storedExperimentalOptions( undefined ).options.compressedTextures, true );
	assert.throws( () => storedExperimentalOptions( { getItem: () => "{" } ) );
});

test("the shared actor room is on unless explicitly false, and reaches the renderer's video options", () => {
	for ( const value of [ undefined, null, {}, { sharedActorRoom: 1 }, { sharedActorRoom: "false" } ] ) {
		assert.equal( experimentalOptions( value ).sharedActorRoom, true );
	}
	const off = experimentalOptions( { sharedActorRoom: false } );
	assert.equal( off.sharedActorRoom, false );
	assert.equal( experimentalVideo( off ).sharedActorRoom, false );
	assert.equal( experimentalVideo( experimentalOptions( {} ) ).sharedActorRoom, true );
});

test("batched effects is off unless explicitly true, and reaches the renderer's video options", () => {
	for ( const value of [ undefined, null, {}, { batchedEffects: 1 }, { batchedEffects: "true" } ] ) {
		assert.equal( experimentalOptions( value ).batchedEffects, false );
	}
	const on = experimentalOptions( { batchedEffects: true } );
	assert.equal( on.batchedEffects, true );
	assert.equal( experimentalVideo( on ).batchedEffects, true );
	assert.equal( experimentalVideo( experimentalOptions( {} ) ).batchedEffects, false );
});

test("grey disabled tabs is on unless explicitly false and stays out of the renderer's video options", () => {
	for ( const value of [ undefined, null, {}, { greyDisabledTabs: 1 }, { greyDisabledTabs: "false" } ] ) {
		assert.equal( experimentalOptions( value ).greyDisabledTabs, true );
	}
	assert.equal( experimentalOptions( { greyDisabledTabs: false } ).greyDisabledTabs, false );
	assert.equal( "greyDisabledTabs" in experimentalVideo( experimentalOptions( {} ) ), false );
});

test("job kill notices are on unless explicitly false and reach the worker's gameplay slice", () => {
	for ( const value of [ undefined, null, {}, { jobKillNotices: 1 }, { jobKillNotices: "false" } ] ) {
		assert.equal( experimentalOptions( value ).jobKillNotices, true );
	}
	const off = experimentalOptions( { jobKillNotices: false } );
	assert.equal( off.jobKillNotices, false );
	assert.equal( experimentalGameplay( off ).jobKillNotices, false );
	assert.equal( "jobKillNotices" in experimentalVideo( experimentalOptions( {} ) ), false );
});

test("drop and plus notices are on unless explicitly false and reach the worker's gameplay slice", () => {
	for ( const value of [ undefined, null, {}, { dropPlusNotices: 1 }, { dropPlusNotices: "false" } ] ) {
		assert.equal( experimentalOptions( value ).dropPlusNotices, true );
	}
	const off = experimentalOptions( { dropPlusNotices: false } );
	assert.equal( off.dropPlusNotices, false );
	assert.equal( off.jobKillNotices, true );
	assert.equal( experimentalGameplay( off ).dropPlusNotices, false );
	assert.equal( "dropPlusNotices" in experimentalVideo( experimentalOptions( {} ) ), false );
});

test("plus seven notices are on unless explicitly false, stay out of the video slice, and never widen the drop/plus row", () => {
	for ( const value of [ undefined, null, {}, { plusSevenNotices: 1 }, { plusSevenNotices: "false" } ] ) {
		assert.equal( experimentalOptions( value ).plusSevenNotices, true );
	}
	const off = experimentalOptions( { plusSevenNotices: false } );
	assert.equal( off.plusSevenNotices, false );
	assert.equal( off.dropPlusNotices, true );
	assert.equal( experimentalGameplay( off ).plusSevenNotices, false );
	assert.equal( experimentalGameplay( experimentalOptions( { dropPlusNotices: false } ) ).plusSevenNotices, true );
	assert.equal( "plusSevenNotices" in experimentalVideo( experimentalOptions( {} ) ), false );
});

test("V hides pets and transports only when explicitly on, and reaches the renderer's slice", () => {
	for ( const value of [ undefined, null, {}, { vHidesCompanions: 1 }, { vHidesCompanions: "true" } ] ) {
		assert.equal( experimentalOptions( value ).vHidesCompanions, false );
	}
	const on = experimentalOptions( { vHidesCompanions: true } );
	assert.equal( on.vHidesCompanions, true );
	assert.equal( experimentalVideo( on ).vHidesCompanions, true );
	assert.ok( EXPERIMENTAL_TABS.some( tab => tab.rows.some( row => row.key === "vHidesCompanions" ) ) );
});

test("fit window labels is on unless explicitly false and stays out of the worker's slices", () => {
	for ( const value of [ undefined, null, {}, { fitWindowLabels: 1 }, { fitWindowLabels: "false" } ] ) {
		assert.equal( experimentalOptions( value ).fitWindowLabels, true );
	}
	assert.equal( experimentalOptions( { fitWindowLabels: false } ).fitWindowLabels, false );
	assert.equal( "fitWindowLabels" in experimentalVideo( experimentalOptions( {} ) ), false );
	assert.equal( "fitWindowLabels" in experimentalGameplay( experimentalOptions( {} ) ), false );
});

test("drop on bag tabs is on unless explicitly false and stays out of the worker's slices", () => {
	for ( const value of [ undefined, null, {}, { dropOnBagTab: 1 }, { dropOnBagTab: "false" } ] ) {
		assert.equal( experimentalOptions( value ).dropOnBagTab, true );
	}
	assert.equal( experimentalOptions( { dropOnBagTab: false } ).dropOnBagTab, false );
	assert.equal( "dropOnBagTab" in experimentalVideo( experimentalOptions( {} ) ), false );
	assert.equal( "dropOnBagTab" in experimentalGameplay( experimentalOptions( {} ) ), false );
});

test("smooth camera is on unless explicitly false and reaches the renderer's slice", () => {
	for ( const value of [ undefined, null, {}, { smoothCamera: 1 }, { smoothCamera: "false" } ] ) {
		assert.equal( experimentalOptions( value ).smoothCamera, true );
	}
	const off = experimentalOptions( { smoothCamera: false } );
	assert.equal( off.smoothCamera, false );
	assert.equal( experimentalVideo( off ).smoothCamera, false );
});

test("enchant sparks are on unless explicitly false and reach the renderer's slice", () => {
	for ( const value of [ undefined, null, {}, { enchantSparks: 1 }, { enchantSparks: "false" } ] ) {
		const options = experimentalOptions( value );
		assert.equal( options.enchantSparks, true );
		assert.equal( experimentalVideo( options ).enchantSparks, true );
	}
	const off = experimentalOptions( { enchantSparks: false } );
	assert.equal( off.enchantSparks, false );
	assert.equal( experimentalVideo( off ).enchantSparks, false );
});

test("homing projectiles default off (native captured endpoint) and reach the worker's gameplay slice when enabled", () => {
	for ( const value of [ undefined, null, {}, { homingProjectiles: 1 }, { homingProjectiles: "true" } ] ) {
		const options = experimentalOptions( value );
		assert.equal( options.homingProjectiles, false );
		assert.equal( experimentalGameplay( options ).homingProjectiles, false );
		assert.equal( "homingProjectiles" in experimentalVideo( options ), false );
	}
	const on = experimentalOptions( { homingProjectiles: true } );
	assert.equal( on.homingProjectiles, true );
	assert.equal( experimentalGameplay( on ).homingProjectiles, true );
	assert.ok( EXPERIMENTAL_TABS.some( tab => tab.rows.some( row => row.key === "homingProjectiles" ) ) );
});

test("pet panel click-to-open defaults on (BUG-086) and stays out of the worker's slices", () => {
	for ( const value of [ undefined, null, {}, { petClickOpensWindow: 1 }, { petClickOpensWindow: "true" } ] ) {
		const options = experimentalOptions( value );
		assert.equal( options.petClickOpensWindow, true );
		assert.equal( "petClickOpensWindow" in experimentalGameplay( options ), false );
		assert.equal( "petClickOpensWindow" in experimentalVideo( options ), false );
	}
	const off = experimentalOptions( { petClickOpensWindow: false } );
	assert.equal( off.petClickOpensWindow, false );
	assert.ok( EXPERIMENTAL_TABS.some( tab => tab.rows.some( row => row.key === "petClickOpensWindow" ) ) );
});

test("smart pet pickup defaults on unless explicitly false and reaches the worker's gameplay slice", () => {
	for ( const value of [ undefined, null, {}, { smartPetPickup: 1 }, { smartPetPickup: "false" } ] ) {
		const options = experimentalOptions( value );
		assert.equal( options.smartPetPickup, true );
		assert.equal( experimentalGameplay( options ).smartPetPickup, true );
		assert.equal( "smartPetPickup" in experimentalVideo( options ), false );
	}
	const off = experimentalOptions( { smartPetPickup: false } );
	assert.equal( off.smartPetPickup, false );
	assert.equal( experimentalGameplay( off ).smartPetPickup, false );
	assert.ok( EXPERIMENTAL_TABS.some( tab => tab.rows.some( row => row.key === "smartPetPickup" ) ) );
});

test("expanded world map defaults off (native five towns and 28 x 8 overview) and stays out of the worker's slices", () => {
	for ( const value of [ undefined, null, {}, { expandedWorldMap: 1 }, { expandedWorldMap: "true" } ] ) {
		const options = experimentalOptions( value );
		assert.equal( options.expandedWorldMap, false );
		assert.equal( "expandedWorldMap" in experimentalGameplay( options ), false );
		assert.equal( "expandedWorldMap" in experimentalVideo( options ), false );
	}
	const on = experimentalOptions( { expandedWorldMap: true } );
	assert.equal( on.expandedWorldMap, true );
	assert.ok( EXPERIMENTAL_TABS.some( tab => tab.rows.some( row => row.key === "expandedWorldMap" ) ) );
});

test("worker threads default off, keep off, auto or a whole count, and stay out of every slice", () => {
	for (
		const frameWorkers of [ undefined, null, true, 0, -1, 2.5, 65, Number.NaN, "8", "max", "on" ]
	) {
		const options = experimentalOptions( frameWorkers === undefined ? {} : { frameWorkers } );
		assert.equal( options.frameWorkers, "off", String( frameWorkers ) );
		assert.equal( "frameWorkers" in experimentalVideo( options ), false );
		assert.equal( "frameWorkers" in experimentalGameplay( options ), false );
	}
	for ( const setting of [ "off", "auto", 1, 3, 8, 23, MAX_FRAME_WORKERS ] ) {
		assert.equal( experimentalOptions( { frameWorkers: setting } ).frameWorkers, setting );
	}
	assert.equal( experimentalOptions( { frameWorkers: MAX_FRAME_WORKERS + 1 } ).frameWorkers, "off" );
	assert.ok( EXPERIMENTAL_TABS.some( tab => tab.rows.some( row => row.key === "frameWorkers" ) ) );
});

test("the worker threads slider runs from off to every thread but the main thread's, beside Auto", () => {
	const hud = createExperimentalHud( 24 );
	hud.open();
	assert.deepEqual( hud.frameWorkerSlider(), {
		max: 23,
		position: 0,
		auto: false,
		text: "Off: the frame runs on one thread (CPU: 24). After reload."
	} );
	hud.select( "frameWorkers", "auto" );
	assert.equal( hud.state().draft.frameWorkers, "auto" );
	assert.equal( hud.state().saved.frameWorkers, "off", "a draft until Confirm" );
	assert.deepEqual( hud.frameWorkerSlider(), {
		max: 23,
		position: 8,
		auto: true,
		text: "Auto: 8 worker threads (CPU: 24). After reload."
	} );
	hud.select( "frameWorkers", "more" );
	assert.equal( hud.state().draft.frameWorkers, 9, "a step starts where Auto's thumb stands" );
	hud.select( "frameWorkers", "23" );
	assert.equal( hud.state().draft.frameWorkers, 23 );
	for ( const value of [ "more", "24", "-1", "max", "", "1.5", "auto2" ] ) {
		hud.select( "frameWorkers", value );
		assert.equal( hud.state().draft.frameWorkers, 23, `${value} leaves the draft` );
	}
	hud.select( "frameWorkers", "1" );
	assert.equal( hud.frameWorkerSlider().text, "1 worker thread (CPU: 24). After reload." );
	hud.select( "frameWorkers", "less" );
	assert.equal( hud.state().draft.frameWorkers, "off", "position 0 is off" );
	hud.select( "frameWorkers", "less" );
	assert.equal( hud.state().draft.frameWorkers, "off" );
	hud.select( "frameWorkers", "12" );
	assert.equal( hud.confirm().frameWorkers, 12 );

	// A four-thread CPU: Auto leaves three threads to the page; a pick may
	// take all three, and a count saved on a larger machine shows what starts.
	const small = createExperimentalHud( 4 );
	small.restore( experimentalOptions( { frameWorkers: 12 } ) );
	assert.deepEqual( small.frameWorkerSlider(), {
		max: 3,
		position: 3,
		auto: false,
		text: "3 worker threads (CPU: 4). After reload."
	} );
	small.select( "frameWorkers", "auto" );
	assert.equal( small.frameWorkerSlider().position, 1 );
	assert.equal( createExperimentalHud( Number.NaN ).frameWorkerSlider().max, 1 );
});
