/*
===========================================================================

pose-direct.test.mjs - tests for animation-pose.ts, pose-math.ts

Loads the TypeScript sources directly through the shared native loader
(tests/helpers/native-source-loader.mjs), so the tests exercise the same
modules the client ships, not a per-test bundle.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { pathToFileURL as sourceFileUrl } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const { createCharacterPose } = await import(
	sourceFileUrl( "src/engine/foundation/animation/animation-pose.ts" ).href
);
const identity = () => Float32Array.of( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 );
test("retained layer comparison preserves normalized time and rejects partial invalid requests atomically", () => {
	const primitive = { joints: [ 0 ], inverseBind: identity() },
		model = {
			nodes: [ {
				name: "root",
				parent: -1,
				translation: [ 0, 0, 0 ],
				rotation: [ 0, 0, 0, 1 ],
				scale: [ 1, 1, 1 ]
			} ],
			primitives: [ primitive ],
			clips: [ {
				name: "move",
				duration: 1,
				channels: [ {
					node: 0,
					path: "translation",
					interpolation: "LINEAR",
					times: Float32Array.of( 0, 1 ),
					values: Float32Array.of( 0, 0, 0, 10, 20, 30 )
				} ]
			} ]
		};
	const pose = createCharacterPose( model ),
		layer = { clip: "move", time: .25, weight: 1, lane: "timed", loop: true };
	assert.equal( pose.evaluate( "", 0, true, [ layer ] ), true );
	assert.equal( pose.evaluate( "", 0, true, [ { ...layer, time: 1.25 } ] ), false );
	const expected = new Float32Array( 16 );
	pose.palette( primitive, expected );
	assert.throws(
		() => pose.evaluate( "", 0, true, [ { ...layer, time: .75 }, { ...layer, weight: NaN } ] ),
		/Invalid animation layer/
	);
	assert.equal( pose.evaluate( "", 0, true, [ layer ] ), false );
	const actual = new Float32Array( 16 );
	pose.palette( primitive, actual );
	assert.deepEqual( actual, expected );
	for ( let i = 0; i < 120; i++ ) {
		const layers = i % 7 === 0 ?
			[] :
			[
				{ ...layer, time: i * .031, weight: i % 3 ? .6 : 1, lane: i % 2 ? "event" : "timed" },
				...i % 4 ? [ { ...layer, time: i * .013, weight: .2, lane: "timed" } ] : []
			];
		const fresh = createCharacterPose( model );
		fresh.evaluate( "", 0, true, layers );
		pose.evaluate( "", 0, true, layers );
		fresh.palette( primitive, expected );
		pose.palette( primitive, actual );
		assert.deepEqual( actual, expected );
	}
});
test("retained key brackets equal cold binary search for seeks, wraps and duplicate timestamps", () => {
	const primitive = { joints: [ 0 ], inverseBind: identity() },
		nodes = [ {
			name: "root",
			parent: -1,
			translation: [ 0, 0, 0 ],
			rotation: [ 0, 0, 0, 1 ],
			scale: [ 1, 1, 1 ]
		} ];
	const clips = [ "STEP", "LINEAR", "CUBICSPLINE" ].map( ( interpolation, i ) => ({
		name: String( i ),
		duration: 2,
		channels: [ {
			node: 0,
			path: "translation",
			interpolation,
			times: Float32Array.of( .1, .3, .3, .9, 1.8 ),
			values: Float32Array.from(
				{ length: 15 * (interpolation === "CUBICSPLINE" ? 3 : 1) },
				( _, n ) => Math.sin( n ) * 3
			)
		} ]
	}) );
	const model = { nodes, clips, primitives: [ primitive ] },
		retained = createCharacterPose( model ),
		a = new Float32Array( 16 ),
		b = new Float32Array( 16 );
	for ( let frame = 0; frame < 600; frame++ ) {
		const layers = [
			{
				clip: String( frame % 3 ),
				time: frame % 11 === 0 ? .3 : frame % 7 === 0 ? frame * .07 : (frame % 200) * .01,
				loop: frame % 2 === 0,
				weight: 1,
				lane: "timed"
			},
			...(frame % 5 === 0 ?
				[ { clip: String( frame % 3 ), time: .13, loop: false, weight: .3, lane: "event" } ] :
				[])
		];
		const fresh = createCharacterPose( model );
		retained.evaluate( "", 0, true, layers );
		fresh.evaluate( "", 0, true, layers );
		retained.palette( primitive, a );
		fresh.palette( primitive, b );
		assert.deepEqual( a, b, `frame ${frame}` );
	}
});

test("retained quaternion coefficients match uncached slerp across key boundaries and clip switches", async () => {
	const { slerp, compose } = await import( sourceFileUrl( "src/engine/foundation/math/pose-math.ts" ).href );
	const node = { name: "root", parent: -1, translation: [ 0, 0, 0 ], rotation: [ 0, 0, 0, 1 ], scale: [ 1, 1, 1 ] },
		primitive = { joints: [ 0 ], inverseBind: identity() };
	const rotations = [ [ 0, 0, 0, 1, 0, .4, 0, .9, 0, -.7, 0, -.7 ], [ 0, 0, 0, 1, 0, .0000001, 0, 1, 0, 0, 0, 2 ] ];
	const clips = rotations.map( ( values, i ) => ({
		name: String( i ),
		duration: 2,
		channels: [ {
			node: 0,
			path: "rotation",
			interpolation: "LINEAR",
			times: Float32Array.of( 0, 1, 2 ),
			values: Float32Array.from( values )
		} ]
	}) );
	const model = { nodes: [ node ], primitives: [ primitive ], clips },
		pose = createCharacterPose( model ),
		actual = new Float32Array( 16 ),
		expected = new Float32Array( 16 ),
		q = new Float32Array( 4 );
	for ( let frame = 0; frame < 600; frame++ ) {
		const clip = clips[Math.floor( frame / 37 ) % 2],
			time = (frame * 17 % 199) / 100,
			low = Math.floor( time ),
			fraction = time - low;
		pose.evaluate( clip.name, time, false );
		pose.palette( primitive, actual );
		slerp( clip.channels[0].values, clip.channels[0].values, fraction, q, low * 4, (low + 1) * 4 );
		compose( node.translation, q, node.scale, expected );
		// The palette's identity product preserves the original leading +0 stores.
		for ( let i = 0; i < 16; i++ ) if ( Object.is( expected[i], -0 ) ) expected[i] = 0;
		assert.deepEqual( new Uint32Array( actual.buffer ), new Uint32Array( expected.buffer ), `frame ${frame}` );
		if ( frame % 11 === 0 ) {
			const layers = clips.map( ( c, i ) => ({
					clip: c.name,
					time: time / (i + 1),
					loop: false,
					weight: .5,
					lane: i ? "timed" : "event"
				})
				),
				fresh = createCharacterPose( model );
			pose.evaluate( "", 0, true, layers );
			fresh.evaluate( "", 0, true, layers );
			pose.palette( primitive, actual );
			fresh.palette( primitive, expected );
			assert.deepEqual( actual, expected );
		}
	}
});

test("constant skeleton branches equal full recomputation through clip changes and output mutation", () => {
	const nodes = Array.from(
		{ length: 8 },
		( _, i ) => ({
			name: String( i ),
			parent: i === 0 || i === 4 ? -1 : i - 1,
			translation: [ i * .1, .5, 0 ],
			rotation: [ 0, 0, 0, 1 ],
			scale: [ 1, 1, 1 ]
		})
	);
	const channel = {
		node: 2,
		path: "translation",
		interpolation: "LINEAR",
		times: Float32Array.of( 0, 1 ),
		values: Float32Array.of( 0, 0, 0, 1, 2, 3 )
	};
	const primitive = {
		joints: nodes.map( ( _, i ) => i ),
		inverseBind: Float32Array.from( nodes.flatMap( () => [ ...identity() ] ) )
	};
	const model = {
		nodes,
		clips: [ { name: "move", duration: 1, channels: [ channel ] } ],
		primitives: [ primitive ],
		images: []
	};
	const referenceModel = {
		...model,
		clips: [ ...model.clips, {
			name: "unused",
			duration: 1,
			channels: nodes.map( ( _, node ) => ({ ...channel, node }) )
		} ]
	};
	const fast = createCharacterPose( model ),
		reference = createCharacterPose( referenceModel ),
		a = new Float32Array( 128 ),
		b = new Float32Array( 128 );
	for ( let frame = 0; frame < 120; frame++ ) {
		const clip = frame % 5 ? "move" : "";
		fast.evaluate( clip, frame * .013 );
		reference.evaluate( clip, frame * .013 );
		fast.palette( primitive, a );
		reference.palette( primitive, b );
		assert.deepEqual( a, b );
		a.fill( 123 );
		fast.palette( primitive, a );
		assert.deepEqual( a, b, "consumer writes cannot corrupt retained palette" );
		for ( const node of nodes ) assert.deepEqual( fast.socket( node.name ), reference.socket( node.name ) );
	}
});
test("single-pass sampling equals native accumulation across interpolation and layer transitions", () => {
	const nodes = Array.from(
		{ length: 3 },
		( _, i ) => ({
			name: String( i ),
			parent: i - 1,
			translation: [ i, 0, 0 ],
			rotation: [ 0, 0, 0, 1 ],
			scale: [ 1, 1, 1 ]
		})
	);
	const clips = [ "LINEAR", "STEP", "CUBICSPLINE" ].map( ( interpolation, i ) => ({
		name: String( i ),
		duration: 2,
		channels: [ "translation", "rotation", "scale" ].map( ( path, n ) => {
			const width = path === "rotation" ? 4 : 3, values = [];
			for ( let key = 0; key < 3; key++ ) {
				if ( interpolation === "CUBICSPLINE" ) {
					for ( let c = 0; c < width; c++ ) {
						values.push( .02 * (c + 1) );
					}
				}
				for ( let c = 0; c < width; c++ ) {
					values.push(
						path === "rotation" ?
							(c === 3 ? Math.cos( key * .2 ) : c === 1 ? Math.sin( key * .2 ) : 0) :
							.7 + key * .4 + c * .2
					);
				}
				if ( interpolation === "CUBICSPLINE" ) {
					for ( let c = 0; c < width; c++ ) {
						values.push( -.03 * (c + 1) );
					}
				}
			}
			return {
				node: n,
				path,
				interpolation,
				times: Float32Array.of( 0, 1, 2 ),
				values: Float32Array.from( values )
			};
		} )
	}) );
	const model = { nodes, clips, images: [], primitives: [] },
		fast = createCharacterPose( model ),
		reference = createCharacterPose( model );
	const primitive = {
		joints: [ 0, 1, 2 ],
		inverseBind: Float32Array.from( [ ...identity(), ...identity(), ...identity() ] )
	};
	for ( let i = 0; i < 150; i++ ) {
		const layer = {
			clip: String( i % 3 ),
			time: i * .077,
			loop: i % 2 === 0,
			weight: i % 9 === 0 ? .4 : 1,
			lane: i % 2 ? "event" : "timed"
		};
		fast.evaluate( layer.clip, layer.time, layer.loop, [ layer ] );
		// The zero-weight lane cannot contribute, but selects the unchanged general
		// event/timed accumulator used before the optimization.
		reference.evaluate( layer.clip, layer.time, layer.loop, [ layer, {
			clip: "",
			time: 0,
			loop: false,
			weight: 0,
			lane: "timed"
		} ] );
		const a = new Float32Array( 48 ), b = new Float32Array( 48 );
		fast.palette( primitive, a );
		reference.palette( primitive, b );
		assert.deepEqual( a, b, `sample ${i}` );
		for ( const node of nodes ) assert.deepEqual( fast.socket( node.name ), reference.socket( node.name ) );
	}
});
