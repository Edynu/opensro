/*
===========================================================================

shared-memory.test.mjs - the character worker's shared strings, values and frame counters

The character worker and its host (CLIENT_WORKERS_PLAN.md 5.11) exchange
every frame through shared memory: interned strings
(foundation/workers/shared-strings.ts), tagged value blocks
(shared-values.ts) and two frame counters (shared-frame.ts). These tests
hold the strings and values to a lossless round trip, the writer to
refusing what is not plain data, and the protocol to a real second thread
that reads and answers while both sides grow their blocks.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";

const { createSharedStrings, createStringReader, createStringWriter } = await import(
	"../../src/engine/foundation/workers/shared-strings.ts"
);
const { createSharedBlock, createValueReader, createValueWriter } = await import(
	"../../src/engine/foundation/workers/shared-values.ts"
);
const { FRAME, OUTPUT, answered, createFrameControl, postFrame } = await import(
	"../../src/engine/foundation/workers/shared-frame.ts"
);

const ECHO = new URL( "../helpers/shared-echo-worker.mjs", import.meta.url );
const ANSWER_LIMIT_MS = 10000;

/*
================
values

A writer and reader over one block and string table.
================
*/
function values() {
	const block = createSharedBlock(), strings = createSharedStrings();
	return {
		block,
		writer: createValueWriter( block, createStringWriter( strings ) ),
		reader: createValueReader( block, createStringReader( strings ) )
	};
}

/*
================
roundTrip

Writes each value as one frame and reads them back.
================
*/
function roundTrip( { writer, reader }, items ) {
	writer.begin();
	for ( const item of items ) writer.value( item );
	writer.end();
	reader.begin();
	const read = [];
	while ( reader.more() ) read.push( reader.value() );
	return read;
}

// Every tag: the constants, numbers at their edges, strings with
// surrogate pairs, nesting, and each typed array kind.
const SAMPLES = [
	undefined,
	null,
	false,
	true,
	0,
	-0,
	NaN,
	Infinity,
	-Infinity,
	Number.MAX_VALUE,
	Number.MIN_VALUE,
	2 ** 53 + 2,
	"",
	"stand",
	"\u{1F525} fire \uD800",
	[],
	[ 1, [ 2, [ "three" ] ], {} ],
	{ a: 1, b: { c: [ null, undefined ] }, "": "empty key", 7: "integer key" },
	Float32Array.of( .1, -0, NaN, 3e38 ),
	Float64Array.of( Math.PI, -0 ),
	Int8Array.of( -128, 127 ),
	Uint8Array.of( 0, 255 ),
	Uint8ClampedArray.of( 0, 255 ),
	Int16Array.of( -32768, 32767 ),
	Uint16Array.of( 65535 ),
	Int32Array.of( -(2 ** 31), 2 ** 31 - 1 ),
	Uint32Array.of( 2 ** 32 - 1 ),
	{ nested: { typed: new Float32Array( 0 ), list: [ Uint8Array.of( 1 ) ] } }
];

test("strings intern once and read back exactly, past the table's first size", () => {
	const memory = createSharedStrings();
	const writer = createStringWriter( memory ), reader = createStringReader( memory );
	const long = "x".repeat( 100000 ) + "\u{1F525}";
	const texts = [ "", "stand", "\u{1F525}\uDC00", long, ...Array.from( { length: 5000 }, ( _, i ) => `bone ${i}` ) ];
	const ids = texts.map( text => writer.intern( text ) );
	assert.deepEqual( ids, texts.map( ( _, i ) => i ) );
	assert.equal( writer.intern( "stand" ), 1, "the same id for the same string" );
	for ( let i = 0; i < texts.length; i++ ) assert.equal( reader.text( ids[i] ), texts[i] );
	// A second reader decodes from the shared memory alone.
	assert.equal( createStringReader( memory ).text( 3 ), long );
	assert.throws( () => reader.text( texts.length ), /Unknown shared string/ );
	assert.throws( () => reader.text( -1 ), /Unknown shared string/ );
	assert.throws( () => reader.text( 1.5 ), /Unknown shared string/ );
});

test("values round trip with their types, frame after frame", () => {
	const pair = values();
	for ( let frame = 0; frame < 3; frame++ ) {
		const read = roundTrip( pair, SAMPLES );
		assert.equal( read.length, SAMPLES.length );
		for ( let i = 0; i < SAMPLES.length; i++ ) assert.deepStrictEqual( read[i], SAMPLES[i], `sample ${i}` );
		// Read back as new storage, never the writer's.
		assert.notEqual( read[16], SAMPLES[16] );
	}
	// A frame's raw words: a reader that knows the layout reads them bare.
	const { writer, reader } = pair;
	writer.begin();
	writer.number( 4.5 );
	writer.text( "attack" );
	writer.value( { kind: "retain" } );
	writer.end();
	reader.begin();
	assert.equal( reader.number(), 4.5 );
	assert.equal( reader.text(), "attack" );
	assert.deepEqual( reader.value(), { kind: "retain" } );
	assert.equal( reader.more(), false );
	assert.throws( () => reader.value(), /overrun/ );
});

test("a block grows to hold a large frame and a smaller frame after it", () => {
	const pair = values();
	const names = Array.from( { length: 2000 }, ( _, i ) => `assembly:${i}` );
	const large = { samples: Float64Array.from( { length: 200000 }, ( _, i ) => i / 3 ), names };
	const before = pair.block.byteLength;
	assert.deepStrictEqual( roundTrip( pair, [ large ] ), [ large ] );
	assert.ok( pair.block.byteLength > before );
	assert.deepStrictEqual( roundTrip( pair, [ 1, "a" ] ), [ 1, "a" ] );
});

test("the writer refuses what is not plain data", () => {
	const { writer } = values();
	class Pose {
		x = 1;
	}
	let deep = {};
	for ( let i = 0; i < 40; i++ ) deep = { deep };
	for (
		const [value, expected] of [
			[ new Pose(), /not plain data/ ],
			[ new Map(), /not plain data/ ],
			[ new Date( 0 ), /not plain data/ ],
			[ Object.create( null ), /not plain data/ ],
			[ () => 1, /not plain data/ ],
			[ Symbol( "s" ), /not plain data/ ],
			[ 1n, /not plain data/ ],
			[ new DataView( new ArrayBuffer( 4 ) ), /not plain data/ ],
			[ new BigInt64Array( 1 ), /unsupported typed array/ ],
			[ deep, /nests too deep/ ]
		]
	) {
		writer.begin();
		assert.throws( () => writer.value( value ), expected );
	}
});

/*
================
answer

Posts frame and waits for the echo thread's answer.
================
*/
function answer( control, frame ) {
	postFrame( control, frame );
	const started = Date.now();
	while ( !answered( control, frame ) ) {
		if ( Date.now() - started > ANSWER_LIMIT_MS ) throw Error( `frame ${frame} was not answered` );
	}
}

test("a second thread answers every frame through shared memory as both sides grow", async () => {
	const memory = {
		control: createFrameControl(),
		inboxStrings: createSharedStrings(),
		inbox: createSharedBlock(),
		outboxStrings: createSharedStrings(),
		outbox: createSharedBlock()
	};
	const worker = new Worker( ECHO, { workerData: memory } );
	const control = new Int32Array( memory.control );
	const inbox = createValueWriter( memory.inbox, createStringWriter( memory.inboxStrings ) );
	const outbox = createValueReader( memory.outbox, createStringReader( memory.outboxStrings ) );
	try {
		let strings = 0;
		for ( let frame = 1; frame <= 40; frame++ ) {
			// Every tenth frame outgrows the blocks and string tables the
			// other thread holds views of.
			const large = frame % 10 === 0;
			const items = [
				...SAMPLES,
				{ frame, names: Array.from( { length: large ? 3000 : 3 }, () => `name ${strings++}` ) },
				large ? Float32Array.from( { length: 100000 + frame }, ( _, i ) => i ) : frame
			];
			inbox.begin();
			for ( const item of items ) inbox.value( item );
			inbox.end();
			answer( control, frame );
			assert.equal( Atomics.load( control, OUTPUT ), frame );
			outbox.begin();
			assert.equal( outbox.number(), frame );
			const read = [];
			while ( outbox.more() ) read.push( outbox.value() );
			assert.deepStrictEqual( read, items, `frame ${frame}` );
		}
		assert.ok( memory.inbox.byteLength > 65536 && memory.outbox.byteLength > 65536 );
	} finally {
		postFrame( control, -1 );
		await worker.terminate();
	}
	assert.equal( Atomics.load( control, FRAME ), -1 );
});
