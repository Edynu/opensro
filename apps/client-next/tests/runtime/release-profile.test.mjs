import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { root } from "../../tools/project.mjs";
import { buildReleaseProfile } from "../../tools/lib/release-profile.mjs";
import { defined } from "../helpers/defined.mjs";

test("release probe freezes both worker and main sources and rejects transformed executable code", async () => {
	const fixture = await mkdtemp( path.join( root, "temp/artifacts/release-fixture-" ) );
	const source = path.join( fixture, "app" ), artifact = path.join( fixture, "capture" );
	await mkdir( path.join( source, "src/engine/foundation/rendering" ), { recursive: true } );
	await writeFile( path.join( source, "index.html" ), '<script type="module" src="/src/bootstrap.ts"></script>' );
	const bootstrap =
		'export const runtime={worker:new Worker(new URL("./worker.ts",import.meta.url),{type:"module"})};';
	await writeFile( path.join( source, "src/bootstrap.ts" ), bootstrap );
	await writeFile( path.join( source, "src/worker.ts" ), 'self.postMessage("frozen worker");' );
	for ( const [file, name] of [ [ "dock-slots", "dockSlot" ], [ "screen-point", "screenPoint" ] ] ) {
		await writeFile(
			path.join( source, `src/engine/foundation/rendering/${file}.ts` ),
			`export const ${name}=()=>1;`
		);
	}
	const frozen = await buildReleaseProfile( source, artifact );
	await writeFile( path.join( source, "src/bootstrap.ts" ), 'throw Error("later workspace edit");' );
	const archive = JSON.parse( await readFile( path.join( artifact, "release-sources.json" ), "utf8" ) );
	assert.equal( archive["src/bootstrap.ts"], bootstrap );
	assert.ok( Object.keys( frozen.manifest.outputs ).filter( name => name.endsWith( ".js" ) ).length >= 2 );
	for ( const [name, text] of Object.entries( archive ) ) {
		assert.equal( frozen.manifest.sources[name], createHash( "sha256" ).update( text ).digest( "hex" ) );
	}
	let predicate, handler;
	const context = {
		request: {
			async get( url ) {
				const file = decodeURIComponent( new URL( url ).pathname.slice( "/@fs/".length ) );
				return { ok: () => true, text: () => readFile( file, "utf8" ) };
			}
		},
		async route( p, h ) {
			predicate = p;
			handler = h;
		}
	};
	await frozen.install( context, "http://localhost" );
	const script = Object.keys( frozen.manifest.outputs ).find( name => name.endsWith( ".js" ) );
	assert.equal( defined( predicate )( new URL( "http://localhost" + script ) ), true );
	assert.equal( defined( predicate )( new URL( "http://localhost/assets/game.png" ) ), false );
	let destination;
	await defined( handler )( {
		request: () => ({ url: () => ("http://localhost" + script) }),
		continue: async value => {
			destination = value.url;
		}
	} );
	assert.ok( defined( destination ).startsWith( "http://localhost/@fs/" ) );
	assert.ok( defined( destination ).endsWith( script ) );
	await assert.rejects(
		frozen.install( {
			...context,
			request: {
				get: async () => ({
					ok: () => true,
					text: async () => "altered executable"
				})
			}
		}, "http://localhost" ),
		/transformed release executable/
	);
});

test("release archive replay preserves Unicode and freezes an explicit presentation seed", async () => {
	const fixture = await mkdtemp( path.join( root, "temp/artifacts/release-replay-fixture-" ) );
	const source = path.join( fixture, "app" ), artifact = path.join( fixture, "capture" );
	await mkdir( source, { recursive: true } );
	const archive = {
		"index.html":
			'<!doctype html><html><head><style>body{color:red}</style></head><body><script type="module" src="/src/bootstrap.ts"></script></body></html>',
		"src/bootstrap.ts":
			'const canvas=1,status=2;function startRuntime(a,b,seed){return {label:"?? ? Silkroad",seed};}export const runtime=startRuntime(canvas,status);',
		"src/engine/foundation/rendering/dock-slots.ts": "export const dockSlot=()=>1;",
		"src/engine/foundation/rendering/screen-point.ts": "export const screenPoint=()=>1;"
	};
	const sourceArchivePath = path.join( fixture, "input.json" );
	await writeFile( sourceArchivePath, JSON.stringify( archive ), "utf8" );
	const frozen = await buildReleaseProfile( source, artifact, { sourceArchivePath, presentationSeed: 1234 } );
	assert.deepEqual( frozen.sourceArchive, archive );
	assert.equal( frozen.manifest.presentationSeed, 1234 );
	const html = await readFile( path.join( artifact, "release/index.html" ), "utf8" );
	assert.equal( (html.match( /<!doctype html>/g ) ?? []).length, 1 );
	assert.ok( !html.includes( 'src="/src/bootstrap.ts"' ) );
	assert.ok( html.includes( "body{color:red}" ) );
	const script = Object.keys( frozen.manifest.outputs ).find( name => name.endsWith( ".js" ) );
	const program = await readFile( path.join( artifact, "release", defined( script ).slice( 1 ) ), "utf8" );
	assert.ok( program.includes( "1234" ) );
	assert.ok( !program.includes( "later workspace edit" ) );
	const saved = JSON.parse( await readFile( path.join( artifact, "release-sources.json" ), "utf8" ) );
	assert.equal( saved["src/bootstrap.ts"], archive["src/bootstrap.ts"] );
	await assert.rejects(
		buildReleaseProfile( source, artifact, { sourceArchivePath, presentationSeed: -1 } ),
		/Invalid release presentation seed/
	);
	await writeFile( sourceArchivePath, JSON.stringify( { ...archive, "src/../escape.ts": "throw Error()" } ) );
	await assert.rejects(
		buildReleaseProfile( source, artifact, { sourceArchivePath } ),
		/Invalid release source archive entry/
	);
});
