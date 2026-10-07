/*
===========================================================================

frame-bundle-state.test.mjs - retained bundles preserve effective draw state

The fake encoder records the state seen by each draw, not a source-text or
call-count-only approximation. Equal adjacent state can be omitted only when
every draw still sees the same resources and order, including new bundles.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { createFrame } = await import( "../../src/engine/runtime/renderer/frame/frame.ts" );

/*
================
fixture
================
*/
function fixture() {
	const calls = { pipeline: 0, binding: 0, vertices: 0, indices: 0, bundles: 0 };
	let executed = [];
	const commands = /** @type {any} */ ({
		createBundleEncoder() {
			calls.bundles++;
			let pipeline, binding, vertices, indices;
			const tape = [];
			return {
				setPipeline( value ) {
					calls.pipeline++;
					pipeline = value;
				},
				setBindGroup( index, value ) {
					assert.equal( index, 0 );
					calls.binding++;
					binding = value;
				},
				setVertexBuffer( index, value ) {
					assert.equal( index, 0 );
					calls.vertices++;
					vertices = value;
				},
				setIndexBuffer( value, format ) {
					assert.equal( format, "uint32" );
					calls.indices++;
					indices = value;
				},
				drawIndexed( ...args ) {
					tape.push( [ pipeline, binding, vertices, indices, ...args ] );
				},
				draw( ...args ) {
					tape.push( [ pipeline, binding, ...args ] );
				},
				finish() {
					return tape;
				}
			};
		},
		createEncoder() {
			return {
				beginRenderPass() {
					return {
						executeBundles( bundles ) {
							for ( const bundle of bundles ) executed.push( ...bundle );
						},
						setBlendConstant() {},
						end() {}
					};
				},
				finish() {
					return {};
				}
			};
		},
		submit() {}
	});
	const frame = /** @type {any} */ (createFrame( commands ));
	return {
		calls,
		/*
		================
		draw
		================
		*/
		draw( world, ui = [] ) {
			executed = [];
			frame.draw( {}, undefined, undefined, undefined, world, ui );
			return executed;
		}
	};
}

test("geometry bundles omit repeated state while retaining every ordered draw and initializing each encoder", () => {
	const f = fixture(), pipeline = {}, binding = {}, vertices = {}, indices = {};
	const world = Array.from( { length: 70 }, ( _, index ) => ({
		pipeline,
		binding,
		vertices,
		indices,
		indexCount: index + 1,
		instanceCount: 1
	}) );
	const expected = () =>
		world.map( draw => [
			draw.pipeline,
			draw.binding,
			draw.vertices,
			draw.indices,
			draw.indexCount,
			draw.instanceCount,
			0,
			0,
			0
		] );
	assert.deepEqual( f.draw( world ), expected() );
	assert.equal( f.calls.bundles, 3 );
	assert.equal( f.calls.pipeline, 3 );
	assert.equal( f.calls.binding, 3 );
	assert.equal( f.calls.vertices, 3 );
	assert.equal( f.calls.indices, 3 );
	const before = { ...f.calls };
	assert.deepEqual( f.draw( world ), expected() );
	assert.deepEqual( f.calls, before, "unchanged frames replay retained bundles" );
	world[33] = { ...world[33], pipeline: {}, binding: {}, vertices: {}, indices: {} };
	assert.deepEqual( f.draw( world ), expected(), "changed state and its restoration stay ordered" );
	assert.ok( f.calls.pipeline > before.pipeline );
	assert.deepEqual( f.draw( world ), expected() );
});

test("UI bundles initialize their own state and retain draw instance ranges", () => {
	const f = fixture(), pipeline = {}, binding = {};
	const ui = Array.from(
		{ length: 5 },
		( _, index ) => ({ pipeline, binding, count: index + 1, first: index * 10 })
	);
	assert.deepEqual( f.draw( [], ui ), ui.map( draw => [ pipeline, binding, 6, draw.count, 0, draw.first ] ) );
	assert.equal( f.calls.pipeline, 1 );
	assert.equal( f.calls.binding, 1 );
	const before = { ...f.calls };
	assert.deepEqual( f.draw( [], ui ), ui.map( draw => [ pipeline, binding, 6, draw.count, 0, draw.first ] ) );
	assert.deepEqual( f.calls, before );
});
