import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { devUpdates } from "../../tools/dev/updates-plugin.mjs";
import { defined } from "../helpers/defined.mjs";

test("dev policy disables HMR and conservatively tracks worker dependencies and history gaps", () => {
	const plugin = devUpdates(), watcher = new EventEmitter(), httpServer = new EventEmitter();
	let middleware;
	const worker = { url: "/src/worker/entry.ts", importers: new Set() },
		shared = { url: "/src/shared.ts", importers: new Set( [ worker ] ) };
	const ordinary = { url: "/src/ordinary.ts", importers: new Set() };
	const server = {
		config: { root: "/fixture" },
		watcher,
		httpServer,
		moduleGraph: {
			getModulesByFile: file => new Set( [ file.endsWith( "shared.ts" ) ? shared : ordinary ] ),
			onFileChange() {}
		},
		middlewares: {
			use( fn ) {
				middleware = fn;
			}
		}
	};
	plugin.configureServer( server );
	assert.equal( plugin.config().server.hmr, false );
	assert.equal( plugin.apply, "serve" );
	const html = plugin.transformIndexHtml.handler( '<script type="module" src="/@vite/client"></script><body/>' );
	assert.equal( html.html, "<body/>" );
	function poll( since ) {
		let result;
		middleware( { url: "/__client-next-dev-session?since=" + since }, {
			setHeader() {},
			end( value ) {
				result = JSON.parse( value );
			}
		}, () => assert.fail( "endpoint fell through" ) );
		return result;
	}
	watcher.emit( "change", "/fixture/src/ordinary.ts" );
	assert.deepEqual( defined( poll( 0 ) ).changed, [ "/src/ordinary.ts" ] );
	watcher.emit( "change", "/fixture/src/shared.ts" );
	assert.equal(
		defined( poll( 1 ) ).changed,
		null,
		"worker dependency cannot be filtered by document resource timing"
	);
	for ( let i = 0; i < 501; i++ ) watcher.emit( "change", "/fixture/src/ordinary.ts" );
	assert.equal( defined( poll( 0 ) ).changed, null );
	assert.deepEqual( defined( poll( 502 ) ).changed, [ "/src/ordinary.ts" ] );
	assert.equal( defined( poll( 9000 ) ).changed, null );
	httpServer.emit( "close" );
	assert.equal( watcher.listenerCount( "change" ), 0 );
	assert.equal( watcher.listenerCount( "unlink" ), 0 );
	assert.equal( watcher.listenerCount( "add" ), 0 );
});
