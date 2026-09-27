import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import config from "../../vite.config.mjs";
import { relaySameOrigin } from "../../tools/dev/edge.mjs";
import { defined } from "../helpers/defined.mjs";

// Restores the listed variables after the test; returns a setter for them.
function isolateEnv( t, keys ) {
	const set = values => {
		for ( const [key, value] of Object.entries( values ) ) {
			if ( value === undefined ) delete process.env[key];
			else process.env[key] = value;
		}
	};
	const old = Object.fromEntries( keys.map( key => [ key, process.env[key] ] ) );
	t.after( () => set( old ) );
	return set;
}
const scratch = () => mkdtempSync( path.join( tmpdir(), "hosting-config-" ) );

test("development and preview share a configurable same-origin Agent proxy", t => {
	isolateEnv( t, [ "SRO_AGENT_PROXY_TARGET" ] )( { SRO_AGENT_PROXY_TARGET: "http://agent.internal:9876" } );
	for ( const mode of [ "development", "production" ] ) {
		const value = config( { mode } ), proxy = defined( defined( value.server ).proxy )["/api"];
		assert.equal( proxy.target, "http://agent.internal:9876" );
		assert.equal( defined( defined( value.preview ).proxy )["/api"], proxy );
		assert.equal( proxy.changeOrigin, false, "preserve the browser host for host-only cookie policy" );
		assert.equal( proxy.xfwd, true, "forward HTTPS scheme to cookie policy" );
		assert.equal( proxy.rewrite( "/api/title/session" ), "/title/session" );
		assert.equal( defined( value.server ).https, undefined, "plain development stays HTTP" );
	}
});

test("the edge routes each catalog transport route to that shard and leaves direct shards alone", t => {
	const catalog = path.join( scratch(), "shards.json" );
	writeFileSync(
		catalog,
		JSON.stringify( {
			shards: [
				{ id: "a", transportUrl: "http://127.0.0.1:8788", publicTransportUrl: "/shards/a" },
				{ id: "ab", transportUrl: "http://127.0.0.1:8793", publicTransportUrl: "/shards/ab" },
				{
					id: "direct",
					transportUrl: "https://play.example.com",
					publicTransportUrl: "https://eu.play.example.com"
				},
				{ id: "legacy", transportUrl: "http://127.0.0.1:8799" }
			]
		} )
	);
	const env = isolateEnv( t, [ "SRO_SHARD_CATALOG" ] );
	env( { SRO_SHARD_CATALOG: catalog } );
	const { server: { proxy } } = config( { mode: "development" } );
	assert.deepEqual( Object.keys( proxy ).sort(), [ "/api", "/shards/a/transport", "/shards/ab/transport" ] );
	for (
		const [route, target] of [ [ "/shards/a", "http://127.0.0.1:8788" ], [ "/shards/ab", "http://127.0.0.1:8793" ] ]
	) {
		const entry = proxy[route + "/transport"];
		assert.equal( entry.target, target );
		assert.equal( entry.ws, true );
		assert.equal( entry.rewrite( route + "/transport/ws" ), "/transport/ws" );
		assert.equal( entry.rewrite( route + "/transport/references/x.json" ), "/transport/references/x.json" );
	}
	env( { SRO_SHARD_CATALOG: path.join( scratch(), "missing.json" ) } );
	assert.throws( () => config( { mode: "development" } ), /SRO_SHARD_CATALOG/ );
});

test("the edge relays its own pages without Origin and forwards foreign origins untouched", () => {
	const proxy = new EventEmitter();
	relaySameOrigin( proxy );
	const forward = ( event, req ) => {
		const headers = { origin: req.headers.origin };
		proxy.emit( event, { removeHeader: name => delete headers[name] }, req );
		return headers.origin;
	};
	const h1 = ( origin, host, encrypted ) => ({ headers: { origin, host }, socket: { encrypted } });
	const h2 = ( origin, authority ) => ({
		headers: { origin, ":authority": authority, ":scheme": "https" },
		socket: {}
	});
	assert.equal( forward( "proxyReqWs", h1( "https://192.168.1.20:5180", "192.168.1.20:5180", true ) ), undefined );
	assert.equal( forward( "proxyReq", h2( "https://192.168.1.20:5180", "192.168.1.20:5180" ) ), undefined );
	assert.equal( forward( "proxyReq", h1( "http://localhost:5180", "localhost:5180", false ) ), undefined );
	assert.equal(
		forward( "proxyReqWs", h1( "https://evil.example", "192.168.1.20:5180", true ) ),
		"https://evil.example"
	);
	assert.equal(
		forward( "proxyReq", h1( "http://192.168.1.20:5180", "192.168.1.20:5180", true ) ),
		"http://192.168.1.20:5180",
		"scheme is part of the origin"
	);
});

test("HTTPS mode serves an explicit certificate pair or a generated one", t => {
	const dir = scratch(), cert = path.join( dir, "dev.pem" ), key = path.join( dir, "dev-key.pem" );
	writeFileSync( cert, "cert" );
	writeFileSync( key, "key" );
	const env = isolateEnv( t, [ "SRO_DEV_TLS_CERT", "SRO_DEV_TLS_KEY" ] );
	env( { SRO_DEV_TLS_CERT: cert, SRO_DEV_TLS_KEY: key } );
	let value = config( { mode: "https" } );
	assert.equal( String( defined( defined( value.server ).https ).cert ), "cert" );
	assert.equal( defined( value.preview ).https, defined( value.server ).https );
	assert.ok( !defined( value.plugins ).some( plugin => defined( plugin ).name === "vite:basic-ssl" ) );
	env( { SRO_DEV_TLS_CERT: undefined, SRO_DEV_TLS_KEY: undefined } );
	value = config( { mode: "https" } );
	assert.equal( defined( value.server ).https, undefined );
	assert.ok( defined( value.plugins ).some( plugin => defined( plugin ).name === "vite:basic-ssl" ) );
	env( { SRO_DEV_TLS_CERT: cert } );
	assert.throws( () => config( { mode: "https" } ), /SRO_DEV_TLS_KEY/ );
});
