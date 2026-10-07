/*
===========================================================================

zip-reader.mjs - independent validation of the report writer's ZIP subset

Node supplies inflation and CRC checks. Read the central directory as an
extractor does, cross-check local headers, and reject incomplete archives.

===========================================================================
*/
import assert from "node:assert/strict";
import { crc32, inflateRawSync } from "node:zlib";

/*
================
readZipEntries

Reports use single-disk ZIPs without comments, encryption or descriptors.
================
*/
export function readZipEntries( input ) {
	const bytes = Buffer.from( input );
	const end = bytes.length - 22;
	assert.ok( end >= 0, "ZIP end record missing" );
	assert.equal( bytes.readUInt32LE( end ), 0x06054b50 );
	assert.equal( bytes.readUInt16LE( end + 4 ), 0 );
	assert.equal( bytes.readUInt16LE( end + 6 ), 0 );
	const count = bytes.readUInt16LE( end + 10 );
	assert.equal( bytes.readUInt16LE( end + 8 ), count );
	assert.equal( bytes.readUInt16LE( end + 20 ), 0 );
	const centralStart = bytes.readUInt32LE( end + 16 );
	assert.equal( centralStart + bytes.readUInt32LE( end + 12 ), end );
	const entries = new Map();
	let offset = centralStart, localEnd = 0;
	for ( let index = 0; index < count; index++ ) {
		assert.equal( bytes.readUInt32LE( offset ), 0x02014b50 );
		const version = bytes.readUInt16LE( offset + 6 );
		assert.ok( version <= 20 );
		const flags = bytes.readUInt16LE( offset + 8 );
		assert.equal( flags & ~0x0800, 0 );
		const method = bytes.readUInt16LE( offset + 10 );
		assert.ok( method === 0 || method === 8 );
		const checksum = bytes.readUInt32LE( offset + 16 );
		const packedSize = bytes.readUInt32LE( offset + 20 );
		const expandedSize = bytes.readUInt32LE( offset + 24 );
		const nameSize = bytes.readUInt16LE( offset + 28 );
		const nameBytes = bytes.subarray( offset + 46, offset + 46 + nameSize );
		const name = nameBytes.toString( "utf8" );
		assert.ok( !entries.has( name ), "duplicate ZIP entry" );
		assert.equal( bytes.readUInt16LE( offset + 34 ), 0 );
		const local = bytes.readUInt32LE( offset + 42 );
		assert.equal( local, localEnd, "local entries are contiguous" );
		assert.equal( bytes.readUInt32LE( local ), 0x04034b50 );
		assert.equal( bytes.readUInt16LE( local + 4 ), version );
		assert.equal( bytes.readUInt16LE( local + 6 ), flags );
		assert.equal( bytes.readUInt16LE( local + 8 ), method );
		assert.equal( bytes.readUInt32LE( local + 14 ), checksum );
		assert.equal( bytes.readUInt32LE( local + 18 ), packedSize );
		assert.equal( bytes.readUInt32LE( local + 22 ), expandedSize );
		assert.equal( bytes.readUInt16LE( local + 26 ), nameSize );
		assert.deepEqual( bytes.subarray( local + 30, local + 30 + nameSize ), nameBytes );
		const start = local + 30 + nameSize + bytes.readUInt16LE( local + 28 );
		localEnd = start + packedSize;
		assert.ok( localEnd <= centralStart );
		const packed = bytes.subarray( start, localEnd );
		const data = method === 8 ? inflateRawSync( packed ) : packed;
		assert.equal( data.length, expandedSize );
		assert.equal( crc32( data ), checksum );
		entries.set( name, { data, method } );
		offset += 46 + nameSize + bytes.readUInt16LE( offset + 30 ) + bytes.readUInt16LE( offset + 32 );
	}
	assert.equal( localEnd, centralStart );
	assert.equal( offset, end );
	return entries;
}
