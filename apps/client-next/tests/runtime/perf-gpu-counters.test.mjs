/*
===========================================================================

perf-gpu-counters.test.mjs - count retained bundle playback and upload bytes

Runs the serialized browser installer against fake WebGPU entry points, so
counting cannot silently depend on a Node-side closure or consume iterables.

===========================================================================
*/
import "../helpers/native-source-loader.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { instrument } from "../../tools/perf/core/client.mjs";

/*
================
fixture
================
*/
function fixture() {
	const submitted = [];
	/*
	================
	BundleEncoder
	================
	*/
	class BundleEncoder {
		draw() {}
		drawIndexed() {}
		drawIndirect() {}
		setPipeline() {}
		setBindGroup() {}
		finish() {
			return {};
		}
	}
	/*
	================
	PassEncoder
	================
	*/
	class PassEncoder {
		drawIndexed() {}
		setPipeline() {}
		setBindGroup() {}
		executeBundles( bundles ) {
			submitted.push( Array.from( bundles ) );
			return "submitted";
		}
	}
	/*
	================
	Queue
	================
	*/
	class Queue {
		writeBuffer( ..._args ) {
			return "written";
		}
	}
	/*
	================
	CommandEncoder
	================
	*/
	class CommandEncoder {
		beginRenderPass( _descriptor ) {
			return new PassEncoder();
		}
	}
	const target = /** @type {any} */ ({
		performance: { now: () => 0, timeOrigin: 0 },
		GPURenderBundleEncoder: BundleEncoder,
		GPURenderPassEncoder: PassEncoder,
		GPUCommandEncoder: CommandEncoder,
		GPUQueue: Queue
	});
	runInContext( `(${instrument.toString()})({ counts: true, spans: false })`, createContext( target ) );
	return {
		target,
		submitted,
		tally: target.__benchTally,
		encoder: new BundleEncoder(),
		pass: new PassEncoder(),
		queue: new Queue(),
		command: new CommandEncoder()
	};
}

test("batch census keeps overlapping fragments and exclusive combinations without actor-key growth", () => {
	const f = fixture(), probe = f.target.__worldProbeFrameProfiler;
	probe.characterBatch( "\0cloth:42\0glow:true\0modifier:42:3:false", 1, 15 );
	probe.characterBatch( "\0cloth:99\0glow:true\0modifier:99:8:false", 1, 12 );
	probe.characterBatch( "", 32, 3 );
	assert.equal( f.tally["character-batch groups all"], 3 );
	assert.equal( f.tally["character-batch actors all"], 34 );
	assert.equal( f.tally["character-batch draws all"], 30 );
	assert.equal( f.tally["character-batch groups cloth"], 2 );
	assert.equal( f.tally["character-batch draws modifier"], 27 );
	assert.equal( f.tally["character-batch draws combination:cloth+modifier+glow"], 27 );
	assert.equal( f.tally["character-batch actors plain"], 32 );
	assert.ok( Object.keys( f.tally ).every( key => !/42|99|true|false/.test( key ) ) );
	f.target.__worldProbeFrameProfiler.begin();
	assert.equal( f.tally["character-batch groups all"], 0 );
});

test("shadow census counts actual silhouette draw commands, not filter or ordinary draws", () => {
	const f = fixture();
	const shadow = f.command.beginRenderPass( { label: "character-shadow-generate" } );
	const filter = f.command.beginRenderPass( { label: "character-shadow-filter" } );
	shadow.drawIndexed();
	shadow.drawIndexed();
	filter.drawIndexed();
	f.pass.drawIndexed();
	assert.equal( f.tally["shadow silhouette draws"], 2 );
	assert.equal( f.tally["pass draws"], 4 );
});

test("ordinary frame timing does not install the batch census", () => {
	const target = /** @type {any} */ ({ performance: { now: () => 0, timeOrigin: 0 } });
	runInContext( `(${instrument.toString()})({ counts: false, spans: false })`, createContext( target ) );
	assert.equal( target.__worldProbeFrameProfiler.characterBatch, undefined );
});

test("retained bundles charge their draws and state commands on every execution, across frame resets", () => {
	const f = fixture();
	f.encoder.setPipeline();
	f.encoder.setBindGroup();
	f.encoder.draw();
	f.encoder.drawIndexed();
	f.encoder.drawIndirect();
	const bundle = f.encoder.finish();
	assert.equal( f.tally["bundle draws recorded"], 3 );
	f.target.__worldProbeFrameProfiler.begin();
	assert.equal( f.tally["bundle draws recorded"], 0 );
	assert.equal( f.pass.executeBundles( [ bundle, bundle ] ), "submitted" );
	assert.equal( f.tally["bundle draws executed"], 6 );
	assert.equal( f.tally["bundle pipelines executed"], 2 );
	assert.equal( f.tally["bundle bind groups executed"], 2 );
	assert.equal( f.tally["bundles executed"], 2 );
	assert.equal( f.tally["executeBundles"], 1 );
	f.target.__worldProbeFrameProfiler.begin();
	f.pass.executeBundles( [ bundle ] );
	assert.equal( f.tally["bundle draws executed"], 3 );
	assert.equal( f.tally["bundle draws recorded"], 0 );
});

test("one-shot bundle iterables reach the underlying API once and unknown bundles remain visible", () => {
	const f = fixture(), bundle = f.encoder.finish(), unknown = {};
	let yields = 0;
	/*
	================
	bundles
	================
	*/
	function* bundles() {
		yields++;
		yield bundle;
		yields++;
		yield unknown;
	}
	f.pass.executeBundles( bundles() );
	assert.equal( yields, 2 );
	assert.deepEqual( f.submitted, [ [ bundle, unknown ] ] );
	assert.equal( f.tally["bundles executed"], 2 );
	assert.equal( f.tally["untracked bundles executed"], 1 );
	assert.equal( f.tally["bundle draws executed"], 0 );
});

test("writeBuffer respects element offsets for typed arrays and byte offsets for buffers and DataView", () => {
	const f = fixture(), buffer = new ArrayBuffer( 16 );
	assert.equal( f.queue.writeBuffer( {}, 0, new Float32Array( buffer ), 1 ), "written" );
	assert.equal( f.tally["writeBuffer bytes"], 12 );
	f.queue.writeBuffer( {}, 0, new Float32Array( buffer ), 0, 2 );
	assert.equal( f.tally["writeBuffer bytes"], 20 );
	f.queue.writeBuffer( {}, 0, buffer, 4 );
	assert.equal( f.tally["writeBuffer bytes"], 32 );
	f.queue.writeBuffer( {}, 0, new DataView( buffer, 4, 8 ), 2 );
	assert.equal( f.tally["writeBuffer bytes"], 38 );
	f.queue.writeBuffer( {}, 0, new Uint16Array( buffer, 4, 4 ), 1, 2 );
	assert.equal( f.tally["writeBuffer bytes"], 42 );
	assert.equal( f.tally.writeBuffer, 5 );
});
