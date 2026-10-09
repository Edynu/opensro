/*
===========================================================================

render-scale-surface.test.mjs - scaled targets and native restoration

Allocation sizes and retirement are observable surface contracts. The
full-size canvas and HUD depth must never inherit the scene resolution.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { createSurface } = await import( "../../src/engine/runtime/renderer/surface/surface.ts" );

test("scale changes recreate scene targets and retain full-size HUD targets", () => {
	const allocations = [],
		swap = {},
		canvas = {
			width: 0,
			height: 0,
			getContext: () => ({ getCurrentTexture: () => ({ createView: () => swap }), unconfigure() {} })
		};
	/*
	================
	target
	================
	*/
	function target( kind, width, height ) {
		const row = { kind, width, height, disposed: 0 };
		allocations.push( row );
		return {
			view: row,
			dispose() {
				row.disposed++;
			}
		};
	}
	const surface = createSurface(
		/** @type {any} */ (canvas),
		/** @type {any} */ ({
			configure() {},
			createColor: ( w, h ) => target( "color", w, h ),
			createDepth: ( w, h ) => target( "depth", w, h )
		}),
		"bgra8unorm"
	);
	try {
		assert.equal( surface.acquire( { width: 129, height: 97 } ), swap );
		assert.equal( allocations.length, 1, "native mode allocates only depth" );
		for ( const [width, height, scale] of [ [ 129, 97, 50 ], [ 129, 97, 75 ], [ 173, 111, 50 ] ] ) {
			const previous = allocations.slice();
			const scene = /** @type {any} */ (surface.acquire( { width, height }, false, scale ));
			assert.deepEqual( [ scene.width, scene.height ], [
				Math.round( width * scale / 100 ),
				Math.round( height * scale / 100 )
			] );
			for ( const view of [ surface.frameView(), surface.frameDepth() ] ) {
				assert.deepEqual( [ /** @type {any} */ (view).width, /** @type {any} */ (view).height ], [
					width,
					height
				] );
			}
			assert.deepEqual( [ canvas.width, canvas.height ], [ width, height ] );
			assert.ok( previous.every( row => row.disposed === 1 ), "replaced targets retire once" );
			const count = allocations.length;
			assert.equal( surface.acquire( { width, height }, false, scale ), scene );
			assert.equal( allocations.length, count, "stable frames reuse targets" );
		}
		assert.equal( surface.acquire( { width: 129, height: 97 }, false, 100 ), swap );
		assert.equal( allocations.filter( row => row.disposed === 0 ).length, 1 );
	} finally {
		surface.dispose();
		surface.dispose();
	}
	assert.ok( allocations.every( row => row.disposed === 1 ) );
});
