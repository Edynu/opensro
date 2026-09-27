/*
===========================================================================

palette-bindings.test.mjs - tests for animation-pose.ts, palette-bindings.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { createCharacterPose } = await import( "../../src/engine/foundation/animation/animation-pose.ts" );
const { paletteBindings } = await import( "../../src/engine/foundation/animation/palette-bindings.ts" );
const identity = () => Float32Array.of( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 );
test("binding reuse requires identical ordered joints and matrix bits", () => {
	const base = { joints: [ 0, 1 ], inverseBind: Float32Array.of( ...identity(), ...identity() ) };
	const copied = { ...base, inverseBind: base.inverseBind.slice() },
		reordered = { ...base, joints: [ 1, 0 ] },
		shifted = { ...base, inverseBind: base.inverseBind.slice() },
		signed = { ...base, inverseBind: base.inverseBind.slice() };
	shifted.inverseBind[12] = 3;
	signed.inverseBind[1] = -0;
	const model = { primitives: [ base, copied, reordered, shifted, signed ] }, bindings = paletteBindings( model );
	assert.equal( bindings.get( copied ), base );
	for ( const p of [ reordered, shifted, signed ] ) assert.equal( bindings.get( p ), p );
	const independent = paletteBindings( model );
	assert.equal( independent.get( copied ), base );
	assert.equal( independent.get( shifted ), shifted );
});
test("a binding hash collision cannot alias different transforms", () => {
	const base = { joints: [ 0 ], inverseBind: identity() }, collision = { joints: [ 0 ], inverseBind: identity() };
	const a = new Uint32Array( base.inverseBind.buffer ),
		b = new Uint32Array( collision.inverseBind.buffer ),
		p = 16777619,
		afterJoint = Math.imul( 2166136261, p );
	b[0] = 0x40000000;
	b[1] = (Math.imul( afterJoint ^ b[0], p ) ^ Math.imul( afterJoint ^ a[0], p ) ^ a[1]) >>> 0;
	assert.ok( collision.inverseBind.every( Number.isFinite ) );
	const bindings = paletteBindings( { primitives: [ base, collision ] } );
	assert.equal( bindings.get( collision ), collision );
});
test("shared binding palettes equal independent poses through animation, divergent binds and output writes", () => {
	const base = { joints: [ 0, 1 ], inverseBind: Float32Array.of( ...identity(), ...identity() ) };
	const primitives = [ base, { ...base, inverseBind: base.inverseBind.slice() }, { ...base, joints: [ 1, 0 ] }, {
		...base,
		inverseBind: base.inverseBind.slice()
	} ];
	primitives[3].inverseBind[12] = 7;
	const model = {
		nodes: [ 0, 1 ].map( ( _, i ) => ({
			name: String( i ),
			parent: i - 1,
			translation: [ i, 0, 0 ],
			rotation: [ 0, 0, 0, 1 ],
			scale: [ 1, 1, 1 ]
		}) ),
		primitives,
		clips: [ {
			name: "move",
			duration: 1,
			channels: [ {
				node: 1,
				path: "translation",
				interpolation: "LINEAR",
				times: Float32Array.of( 0, 1 ),
				values: Float32Array.of( 0, 0, 0, 2, 4, 6 )
			} ]
		} ]
	};
	const shared = createCharacterPose( model ),
		other = createCharacterPose( model ),
		oracles = primitives.map( p => createCharacterPose( { ...model, primitives: [ p ] } ) );
	for ( let frame = 0; frame < 120; frame++ ) {
		const time = frame * .013;
		shared.evaluate( "move", time );
		other.evaluate( "move", time + .2 );
		for ( let i = 0; i < primitives.length; i++ ) {
			const p = primitives[(i + frame) % primitives.length], oracle = oracles[primitives.indexOf( p )];
			oracle.evaluate( "move", time );
			const a = new Float32Array( 64 ), b = new Float32Array( 64 );
			shared.palette( p, a, 16 );
			oracle.palette( p, b, 16 );
			assert.deepEqual( a, b );
			a.fill( 99 );
			other.palette( p, a, 16 );
			shared.palette( p, a, 16 );
			assert.deepEqual( a.subarray( 16, 48 ), b.subarray( 16, 48 ) );
		}
	}
});
