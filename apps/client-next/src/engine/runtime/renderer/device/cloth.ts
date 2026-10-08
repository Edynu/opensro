/*
===========================================================================

cloth.ts - GPU cloth: per-mesh statics, per-draw solver state, encoding

Port-only, not native (Experimental "GPU cloth"). The CPU keeps the solver
clock and the native gust numbers (foundation/animation/cloth.ts
createClothSchedule); this owner keeps each cloth draw's positions on the
GPU and encodes the solver (cloth-shader.ts) after the skeletal pass that
fills the palettes it skins from. A cloth's state lives as long as its
pins draw: release forgets it with the draw.

===========================================================================
*/
import type { ClothData } from "@/engine/foundation/animation/cloth";
import type { Geometry } from "@/engine/contracts/geometry";
import type { GpuTimingFrame } from "../internal/gpu-contract";
import { clothShader } from "./cloth-shader";
import { destroyNow, type Retire } from "./retirement";

// The Job uniform of cloth-shader.ts: five vec4s.
const JOB_BYTES = 80;

/*
================
GpuClothJob

One frame's solver work for a cloth draw. reset starts it from its anchors;
steps run with gusts (bit s of a vertex: a gust on step s). paletteAt is
the matrix index of the actor's palette in palettes.
================
*/
export interface GpuClothJob {
	readonly cloth: ClothData;
	readonly mesh: Geometry;
	readonly palettes: GPUBuffer;
	readonly paletteAt: number;
	readonly reset: boolean;
	readonly steps: number;
	readonly gusts: Uint32Array;
	readonly direction: readonly number[];
	readonly wind: number;
}

/*
================
Statics
================
*/
type Statics = { buffer: GPUBuffer; refs: number; vertices: number; constraints: number; };

/*
================
Instance
================
*/
type Instance = {
	statics: Statics;
	cloth: ClothData;
	state: GPUBuffer;
	job: GPUBuffer;
	gusts: GPUBuffer;
	palettes: GPUBuffer;
	output: GPUBuffer;
	binding: GPUBindGroup;
	values: Float32Array<ArrayBuffer>;
	words: Uint32Array;
};

/*
================
staticsData

A mesh's solver inputs in the shader's layout.
================
*/
function staticsData( cloth: ClothData, mesh: Geometry ): Float32Array<ArrayBuffer> {
	const n = mesh.positions.length / 3, m = cloth.order.length;
	const data = new Float32Array( (n * 4 + m) * 4 );
	for ( let i = 0; i < n; i++ ) {
		for ( let c = 0; c < 3; c++ ) {
			data[i * 4 + c] = mesh.positions[i * 3 + c]!;
			data[(n + i) * 4 + c] = mesh.normals?.[i * 3 + c] ?? (c === 1 ? 1 : 0);
		}
		data[i * 4 + 3] = cloth.pins[i]!;
		data[(n + i) * 4 + 3] = cloth.mobility[i]!;
		for ( let c = 0; c < 4; c++ ) {
			data[(n * 2 + i) * 4 + c] = mesh.joints![i * 4 + c]!;
			data[(n * 3 + i) * 4 + c] = mesh.weights![i * 4 + c]!;
		}
	}
	for ( let e = 0; e < m; e++ ) {
		const constraint = cloth.constraints[cloth.order[e]!]!;
		data[(n * 4 + e) * 4] = constraint[0];
		data[(n * 4 + e) * 4 + 1] = constraint[1];
		data[(n * 4 + e) * 4 + 2] = constraint[2];
	}
	return data;
}

/*
================
createGpuCloth
================
*/
export function createGpuCloth( device: GPUDevice, retire: Retire = destroyNow ) {
	let pipeline: GPUComputePipeline | undefined, disposed = false, dispatches = 0;
	const statics = new Map<ClothData, Statics>();
	const instances = new Map<GPUBuffer, Instance>();
	const pending = new Set<Instance>();
	const ready = device.createComputePipelineAsync( {
		label: "gpu-cloth",
		layout: "auto",
		compute: { module: device.createShaderModule( { label: "gpu-cloth", code: clothShader } ), entryPoint: "main" }
	} ).then( value => {
		if ( !disposed ) pipeline = value;
	} ).catch( error => {
		console.error( "[SRO renderer] GPU cloth unavailable:", error );
	} );

	/*
	================
	staticsFor
	================
	*/
	function staticsFor( cloth: ClothData, mesh: Geometry ): Statics {
		let entry = statics.get( cloth );
		if ( !entry ) {
			const data = staticsData( cloth, mesh );
			const buffer = device.createBuffer( {
				label: "gpu-cloth-statics",
				size: data.byteLength,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			} );
			device.queue.writeBuffer( buffer, 0, data );
			entry = { buffer, refs: 0, vertices: mesh.positions.length / 3, constraints: cloth.order.length };
			statics.set( cloth, entry );
		}
		return entry;
	}

	/*
	================
	release

	Forget the cloth drawn from output (its pins draw's vertex stream).
	================
	*/
	function release( output: GPUBuffer ) {
		const instance = instances.get( output );
		if ( !instance ) return;
		pending.delete( instance );
		instances.delete( output );
		retire( instance.state );
		retire( instance.job );
		retire( instance.gusts );
		if ( !--instance.statics.refs ) {
			retire( instance.statics.buffer );
			statics.delete( instance.cloth );
		}
	}

	return {
		ready,
		available: () => !!pipeline && !disposed,
		/*
		================
		step

		Queue job for the cloth drawn from output. A cloth seen for the first
		time, or bound to new palettes, starts from its anchors.
		================
		*/
		step( output: GPUBuffer, job: GpuClothJob ) {
			if ( !pipeline || disposed ) throw Error( "GPU cloth unavailable" );
			let instance = instances.get( output );
			if ( instance && (instance.cloth !== job.cloth || instance.palettes !== job.palettes) ) {
				release( output );
				instance = undefined;
			}
			const fresh = !instance;
			if ( !instance ) {
				const shared = staticsFor( job.cloth, job.mesh );
				const state = device.createBuffer( {
					label: "gpu-cloth-state",
					size: shared.vertices * 32,
					usage: GPUBufferUsage.STORAGE
				} );
				const uniform = device.createBuffer( {
					label: "gpu-cloth-job",
					size: JOB_BYTES,
					usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
				} );
				const gusts = device.createBuffer( {
					label: "gpu-cloth-gusts",
					size: Math.max( 16, shared.vertices * 4 ),
					usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
				} );
				const binding = device.createBindGroup( {
					layout: pipeline.getBindGroupLayout( 0 ),
					entries: [ shared.buffer, state, uniform, gusts, job.palettes, output ].map( (
						buffer,
						binding
					) => ({
						binding,
						resource: { buffer }
					}) )
				} );
				const values = new Float32Array( JOB_BYTES / 4 );
				instance = {
					statics: shared,
					cloth: job.cloth,
					state,
					job: uniform,
					gusts,
					palettes: job.palettes,
					output,
					binding,
					values,
					words: new Uint32Array( values.buffer )
				};
				shared.refs++;
				instances.set( output, instance );
			}
			const { values, words, cloth } = instance;
			words[0] = instance.statics.vertices;
			words[1] = instance.statics.constraints;
			words[2] = job.reset || fresh ? 1 : 0;
			words[3] = job.steps;
			words[4] = job.paletteAt;
			words[5] = cloth.force ? 1 : 0;
			for ( let c = 0; c < 3; c++ ) {
				values[8 + c] = cloth.force?.[c] ?? 0;
				values[12 + c] = job.direction[c]!;
			}
			values[15] = job.wind;
			values[16] = cloth.damping;
			values[17] = cloth.gravity;
			values[18] = cloth.gravityMobility;
			values[19] = cloth.windMobility;
			device.queue.writeBuffer( instance.job, 0, values );
			if ( job.steps ) {
				device.queue.writeBuffer(
					instance.gusts,
					0,
					job.gusts as Uint32Array<ArrayBuffer>,
					0,
					instance.statics.vertices
				);
			}
			pending.add( instance );
		},
		release,
		/*
		================
		encode

		After the skeletal pass: the palettes this frame's jobs skin from.
		================
		*/
		encode( encoder: GPUCommandEncoder, timing?: GpuTimingFrame ) {
			if ( !pending.size || !pipeline ) return;
			const pass = encoder.beginComputePass( {
				label: "gpu-cloth",
				timestampWrites: timing?.pass( "gpu-cloth" )
			} );
			pass.setPipeline( pipeline );
			for ( const instance of pending ) {
				pass.setBindGroup( 0, instance.binding );
				pass.dispatchWorkgroups( 1 );
				dispatches++;
			}
			pass.end();
			pending.clear();
		},
		stats: () => ({ instances: instances.size, dispatches }),
		/*
		================
		dispose
		================
		*/
		dispose() {
			if ( disposed ) return;
			disposed = true;
			for ( const output of [ ...instances.keys() ] ) release( output );
			pending.clear();
			pipeline = undefined;
		}
	};
}
