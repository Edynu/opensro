/*
===========================================================================

bug-report-upload.test.mjs - bounded, replayable technical report attachments

Read the actual ZIP bytes with Node's independent inflater. Shared reports
retain movement identities and clocks without exporting chat or credentials.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
const { createDiagnosticUpload } = await import( "../../src/engine/runtime/bug-report/archive.ts" );
const OPTIONS = { id: "BR-261007-0125-52FC", clip: { start: 3, end: 8 }, maxBytes: 2 * 1024 * 1024 };

/*
================
readZip
================
*/
async function readZip( blob ) {
	const bytes = Buffer.from( await blob.arrayBuffer() );
	const documents = {}, methods = [];
	let offset = 0;
	while ( bytes.readUInt32LE( offset ) === 0x04034b50 ) {
		const method = bytes.readUInt16LE( offset + 8 );
		const size = bytes.readUInt32LE( offset + 18 ), expanded = bytes.readUInt32LE( offset + 22 );
		const nameSize = bytes.readUInt16LE( offset + 26 ), extraSize = bytes.readUInt16LE( offset + 28 );
		const name = bytes.subarray( offset + 30, offset + 30 + nameSize ).toString();
		const start = offset + 30 + nameSize + extraSize;
		const packed = bytes.subarray( start, start + size );
		assert.ok( method === 0 || method === 8 );
		const data = method === 8 ? inflateRawSync( packed ) : packed;
		assert.equal( data.length, expanded );
		documents[name] = JSON.parse( data.toString() );
		methods.push( method );
		offset = start + size;
	}
	assert.equal( bytes.readUInt32LE( offset ), 0x02014b50 );
	return { documents, methods };
}

/*
================
fixture
================
*/
function fixture() {
	return {
		"movement.json": JSON.stringify( {
			mainTimeOriginMs: 100,
			simulationOriginMs: 80,
			localGid: 7,
			events: [ { kind: "movement", atMs: 120, token: 9, revision: 2, pose: { x: 12, y: 0, z: 4 } } ]
		} ),
		"timeline.json": JSON.stringify( {
			events: [ { kind: "chat", text: "PRIVATE_CHAT" }, {
				kind: "sample",
				t: 3,
				hp: 200,
				targetName: "PRIVATE_NAME"
			} ]
		} ),
		"state.json": JSON.stringify( {
			session: { accessToken: "PRIVATE_TOKEN", account: "PRIVATE_ACCOUNT" },
			entities: 12,
			gameplay: {
				localGid: 7,
				pose: { x: 12, y: 0, z: 4 },
				casts: [ { token: 9, caster: 7 } ],
				chat: { lines: [ "PRIVATE_CHAT" ] },
				social: { guild: "PRIVATE_GUILD" }
			}
		} ),
		"environment.json": JSON.stringify( {
			cpuThreads: 8,
			preferences: { token: "PRIVATE_STORAGE" },
			userAgent: "test"
		} )
	};
}

test("shared diagnostic ZIP preserves replay clocks and cast IDs, omitting private fields", async () => {
	const input = fixture(), before = JSON.stringify( input );
	const blob = await createDiagnosticUpload( input, OPTIONS );
	assert.equal( blob.type, "application/zip" );
	const { documents, methods } = await readZip( blob );
	assert.ok( methods.includes( 8 ), "native DEFLATE entries are decoded independently" );
	assert.equal( documents["manifest.json"].reportId, OPTIONS.id );
	assert.equal( documents["manifest.json"].videoTimelineOffsetSeconds, 3 );
	assert.equal( documents["movement.json"].simulationOriginMs, 80 );
	assert.equal( documents["movement.json"].events[0].token, 9 );
	assert.equal( documents["state.json"].gameplay.casts[0].caster, 7 );
	assert.equal( documents["timeline.json"].events.length, 1 );
	assert.ok( !JSON.stringify( documents ).includes( "PRIVATE_" ) );
	assert.equal( JSON.stringify( input ), before, "the full local archive is preserved" );
});

test("attachment budget retains the newest events and declares truncation", async () => {
	const input = fixture();
	input["movement.json"] = JSON.stringify( {
		mainTimeOriginMs: 100,
		events: Array.from( { length: 2000 }, ( _, revision ) => ({
			revision,
			event: "receipt",
			x: [ ...createHash( "sha256" ).update( String( revision ) ).digest() ]
		}) )
	} );

	const blob = await createDiagnosticUpload( input, { ...OPTIONS, maxBytes: 4096 } );
	assert.ok( blob.size <= 4096 );
	const { documents } = await readZip( blob );
	assert.equal( documents["movement.json"].events.at( -1 ).revision, 1999 );
	assert.ok( documents["manifest.json"].omissions.length > 0 );
});

test("unknown identity fields and free-form strings never enter shared technical documents", async () => {
	const input = fixture();
	input["movement.json"] = JSON.stringify( {
		localGid: 7,
		events: [ {
			kind: "movement",
			event: "receipt",
			reason: "correction",
			atMs: 100,
			sender: "PRIVATE_SENDER",
			nick: "PRIVATE_NICK",
			label: "PRIVATE_LABEL",
			from: "PRIVATE_CHAT",
			target: { PRIVATE_NAME: 7 },
			source: "PRIVATE_PATH",
			pose: { x: 1, y: 2, z: 3 },
			token: 123
		} ]
	} );
	const { documents } = await readZip( await createDiagnosticUpload( input, OPTIONS ) );
	assert.ok( !JSON.stringify( documents ).includes( "PRIVATE_" ) );
	const event = documents["movement.json"].events[0];
	assert.equal( event.reason, "correction" );
	assert.equal( event.token, 123 );
	assert.deepEqual( event.pose, { x: 1, y: 2, z: 3 } );
});

test("a browser without raw DEFLATE still sends a bounded stored ZIP", async t => {
	t.mock.method( globalThis, "CompressionStream", function unavailable() {
		throw Error( "unsupported" );
	} );
	const blob = await createDiagnosticUpload( fixture(), OPTIONS );
	const { documents, methods } = await readZip( blob );
	assert.ok( methods.every( method => method === 0 ) );
	assert.equal( documents["movement.json"].localGid, 7 );
});

test("an invalid attachment budget rejects instead of sending an oversized ZIP", async () => {
	for ( const maxBytes of [ 0, -1, NaN, Infinity, 4095 ] ) {
		await assert.rejects( createDiagnosticUpload( fixture(), { ...OPTIONS, maxBytes } ), /budget/ );
	}
});

test("a bulky state snapshot cannot discard the only movement receipt", async () => {
	const input = fixture();
	input["state.json"] = JSON.stringify( {
		gameplay: {
			inventory: Array.from( { length: 2000 }, ( _, id ) => ({
				id,
				value: [ ...createHash( "sha256" ).update( String( id ) ).digest() ]
			}) )
		}
	} );
	const { documents } = await readZip( await createDiagnosticUpload( input, { ...OPTIONS, maxBytes: 4096 } ) );
	assert.equal( documents["movement.json"].events.length, 1 );
	assert.equal( documents["movement.json"].events[0].token, 9 );
	assert.ok( documents["manifest.json"].omissions.some( text => text.includes( "inventory" ) ) );
});
