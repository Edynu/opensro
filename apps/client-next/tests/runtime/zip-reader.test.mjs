/*
===========================================================================

zip-reader.test.mjs - standard-tool compatibility and corruption rejection

The committed fixture comes from Python zipfile, with a stored UTF-8 named
entry and a deflated JSON entry. It is independent of the product writer.

Regenerate from the repository root with Python:
    from zipfile import ZipFile, ZipInfo, ZIP_STORED, ZIP_DEFLATED
    with ZipFile('apps/client-next/tests/fixtures/report-standard.zip', 'w') as z:
        for name, data, method in [('ñ.txt', b'123456789', ZIP_STORED),
                                   ('details.json', b'{"ok":true}', ZIP_DEFLATED)]:
            info = ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = method
            z.writestr(info, data)

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readZipEntries } from "../helpers/zip-reader.mjs";

const fixture = await readFile( new URL( "../fixtures/report-standard.zip", import.meta.url ) );

test("ZIP reader decodes stored and deflated Python zipfile entries", () => {
	const entries = readZipEntries( fixture );
	assert.equal( entries.size, 2 );
	assert.equal( entries.get( "ñ.txt" ).data.toString(), "123456789" );
	assert.equal( entries.get( "ñ.txt" ).method, 0 );
	assert.equal( entries.get( "details.json" ).data.toString(), '{"ok":true}' );
	assert.equal( entries.get( "details.json" ).method, 8 );
});

test("product ZIP local header matches the standard-tool UTF-8 stored header", async () => {
	const { zipStore } = await import( "../../src/engine/foundation/archive/zip.ts" );
	const zip = zipStore(
		[ { name: "ñ.txt", data: new TextEncoder().encode( "123456789" ) } ],
		new Date( 1980, 0, 1 )
	);
	const expected = "504b0304140000080000000021002639f4cb090000000900000006000000";
	assert.equal( fixture.subarray( 0, 30 ).toString( "hex" ), expected );
	assert.equal( Buffer.from( zip.subarray( 0, 30 ) ).toString( "hex" ), expected );
	assert.equal( readZipEntries( zip ).get( "ñ.txt" ).data.toString(), "123456789" );
});

test("ZIP reader rejects damaged payloads, inconsistent headers and truncated directories", () => {
	const payload = Buffer.from( fixture );
	payload[36] ^= 1;
	assert.throws( () => readZipEntries( payload ) );
	const header = Buffer.from( fixture );
	header[14] ^= 1;
	assert.throws( () => readZipEntries( header ) );
	assert.throws( () => readZipEntries( fixture.subarray( 0, fixture.length - 1 ) ) );
});
