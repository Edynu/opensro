/*
===========================================================================

hdr-stages.test.mjs - the 2026-10-08 lighting stages in isolation

A synthetic, textureless scene owns its geometry and its light: a lit
ground quad, a dome whose smooth normals separate per-vertex from
per-pixel lighting, and a box that casts. Each stage cycles off-on-off;
every disabled capture must restore the native pixels exactly.

===========================================================================
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { launchProbeBrowser } from "../../../../scripts/lib/probeBrowser.mjs";
import { CLIENT_NEXT_BASE_URL } from "../../../../scripts/lib/probeEndpoints.mjs";

import { captureLightingStages } from "../helpers/hdr-gpu.mjs";

test(
	"each lighting stage changes the native frame and disabling restores every pixel",
	{ timeout: 120000 },
	async () => {
		const { browser, page } = await launchProbeBrowser();
		const errors = [];
		page.on( "pageerror", error => errors.push( error.message ) );
		try {
			await page.route(
				CLIENT_NEXT_BASE_URL + "/",
				route => route.fulfill( { contentType: "text/html", body: "<!doctype html><body></body>" } )
			);
			await page.goto( CLIENT_NEXT_BASE_URL );
			const rows = await page.evaluate( captureLightingStages, {} );
			const native = rows[0].rgba;
			for ( const row of rows ) {
				if ( row.mode === "off" ) {
					assert.deepEqual( row.rgba, native, "Disabled stages must restore exact native pixels" );
				} else assert.notDeepEqual( row.rgba, native, `${row.mode} must independently affect the frame` );
			}
			// The witness must actually be lit geometry, not a black frame.
			assert.ok( native.some( ( value, i ) => i % 4 !== 3 && value > 24 ), "Witness must draw visible geometry" );
			const colors = new Map();
			for ( let i = 0; i < native.length; i += 4 ) {
				if ( Math.max( ...native.slice( i, i + 3 ) ) <= 24 ) continue;
				const key = native.slice( i, i + 3 ).join( "," );
				if ( !colors.has( key ) ) colors.set( key, [] );
				colors.get( key ).push( i );
			}
			const ground = [ ...colors.values() ].sort( ( a, b ) => b.length - a.length )[0];
			const shadowRow = rows.find( row => row.mode === "sunShadow" );
			assert.ok( shadowRow );
			const shadow = shadowRow.rgba;
			const unchanged = ground.filter( i => native.slice( i, i + 3 ).every( ( c, j ) => c === shadow[i + j] ) );
			const darkened = ground.filter( i => shadow[i] < native[i] - 4 );
			assert.ok( unchanged.length > ground.length / 2, "A sunlit part of the ground must remain lit" );
			assert.ok( darkened.length > 2, "The caster must shade a distinct part of the ground" );
			assert.deepEqual( errors, [] );
		} finally {
			await browser.close();
		}
	}
);

test(
	"HDR selected before startup and retained through device loss renders valid frames",
	{ timeout: 120000 },
	async () => {
		const { browser, page } = await launchProbeBrowser();
		try {
			await page.route(
				CLIENT_NEXT_BASE_URL + "/",
				route => route.fulfill( { contentType: "text/html", body: "<!doctype html><body></body>" } )
			);
			await page.goto( CLIENT_NEXT_BASE_URL );
			const rows = await page.evaluate( captureLightingStages, { startup: true, recover: true } );
			for ( const row of rows ) {
				assert.ok(
					row.rgba.some( ( value, i ) => i % 4 !== 3 && value > 24 ),
					row.mode + " draws visible geometry"
				);
			}
			const recovered = rows.find( row => row.mode === "recovered" ), restored = rows.at( -1 );
			assert.ok( recovered && restored );
			assert.deepEqual( recovered.rgba, rows[0].rgba );
			assert.notDeepEqual( restored.rgba, rows[0].rgba, "Disabling HDR restores a different native frame" );
		} finally {
			await browser.close();
		}
	}
);
