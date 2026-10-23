/*
===========================================================================

draw-bundles.ts - a pass's geometry draws as retained render bundles

Records a pass's geometry draws as render bundles in bounded contiguous
runs, each re-recorded only when one of its draws changed (the draw, its
binding or its counts): an unchanged run replays as one executeBundles
entry instead of a command per state change and draw. A run starts where
one started the frame before when it can, so a changed draw re-records
its own run alone. Individual bundles add submission overhead; one
bundle for the whole pass would re-record everything for any change.
The frame owner (frame.ts) keeps one for the world pass and one for the
water reflection, whose target follows the scene's format.

===========================================================================
*/

/*
================
BundledDraw

What a run records of a geometry draw (renderer/internal/gpu-contract.ts
GeometryDraw).
================
*/
export interface BundledDraw {
	readonly pipeline: GPURenderPipeline;
	readonly binding: GPUBindGroup;
	readonly vertices: GPUBuffer;
	readonly indices: GPUBuffer;
	readonly indexCount: number;
	readonly instanceCount: number;
	readonly firstIndex?: number;
	readonly baseVertex?: number;
}

// A run's draws: at least, unless the draws end, and at most.
const MIN_RUN = 16;
const MAX_RUN = 32;

/*
================
RecordedRun

A run's bundle and what it recorded: its draws, their counts and bindings.
================
*/
interface RecordedRun {
	readonly draws: readonly BundledDraw[];
	readonly counts: readonly number[];
	readonly bindings: readonly GPUBindGroup[];
	readonly bundle: GPURenderBundle;
}

/*
================
createDrawBundles

bundleEncoder makes a bundle encoder for the pass's target formats.
================
*/
export function createDrawBundles( bundleEncoder: () => GPURenderBundleEncoder ) {
	const runs = new WeakMap<BundledDraw, RecordedRun>();
	let anchors = new Set<BundledDraw>(), nextAnchors = new Set<BundledDraw>();
	/*
	================
	current

	True when run still records draws[start..end): the same draws, with the
	same counts and bindings.
	================
	*/
	function current( run: RecordedRun, draws: readonly BundledDraw[], start: number, end: number ): boolean {
		if ( run.draws.length !== end - start ) return false;
		for ( let i = 0; i < end - start; i++ ) {
			const draw = draws[start + i]!;
			if (
				draw !== run.draws[i] || draw.binding !== run.bindings[i] ||
				draw.indexCount !== run.counts[i * 2] || draw.instanceCount !== run.counts[i * 2 + 1]
			) return false;
		}
		return true;
	}
	/*
	================
	recordRun

	One run's bundle, skipping state equal to the previous draw's.
	================
	*/
	function recordRun( draws: readonly BundledDraw[] ): RecordedRun {
		const counts: number[] = [], encoder = bundleEncoder();
		let pipeline: GPURenderPipeline | undefined, binding: GPUBindGroup | undefined;
		let vertices: GPUBuffer | undefined, indices: GPUBuffer | undefined;
		for ( const draw of draws ) {
			counts.push( draw.indexCount, draw.instanceCount );
			if ( pipeline !== draw.pipeline ) {
				encoder.setPipeline( draw.pipeline );
				pipeline = draw.pipeline;
			}
			if ( binding !== draw.binding ) {
				encoder.setBindGroup( 0, draw.binding );
				binding = draw.binding;
			}
			if ( vertices !== draw.vertices ) {
				encoder.setVertexBuffer( 0, draw.vertices );
				vertices = draw.vertices;
			}
			if ( indices !== draw.indices ) {
				encoder.setIndexBuffer( draw.indices, "uint32" );
				indices = draw.indices;
			}
			encoder.drawIndexed( draw.indexCount, draw.instanceCount, draw.firstIndex ?? 0, draw.baseVertex ?? 0, 0 );
		}
		return { draws, counts, bindings: draws.map( draw => draw.binding ), bundle: encoder.finish() };
	}
	return {
		/*
		================
		record

		The bundles that draw draws in order, appended to out. Every draw
		has indices and instances: the caller leaves out empty ones.
		================
		*/
		record( draws: readonly BundledDraw[], out: GPURenderBundle[] ) {
			nextAnchors.clear();
			for ( let start = 0; start < draws.length; ) {
				let end = start + 1;
				while (
					end < draws.length && end - start < MAX_RUN &&
					(end - start < MIN_RUN || !anchors.has( draws[end]! ))
				) {
					end++;
				}
				const first = draws[start]!;
				let run = runs.get( first );
				if ( !run || !current( run, draws, start, end ) ) {
					run = recordRun( draws.slice( start, end ) );
					runs.set( first, run );
				}
				out.push( run.bundle );
				nextAnchors.add( first );
				start = end;
			}
			const previous = anchors;
			anchors = nextAnchors;
			nextAnchors = previous;
		}
	};
}
