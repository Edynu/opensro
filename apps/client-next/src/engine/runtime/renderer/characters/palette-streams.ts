/*
===========================================================================

palette-streams.ts - batch-owned palettes shared by exact bone bindings

Pose revisions own matrix contents. Appending an animation catalog changes
the GPU sampling source, not the binding layout or retained buffer identity.

===========================================================================
*/
import type { CharacterModel } from "@/engine/contracts/character";
import type { createCharacterPose } from "@/engine/foundation/animation/animation-pose";
import { paletteBindings } from "@/engine/foundation/animation/palette-bindings";
import type { GeometryCommands } from "../internal/gpu-contract";
/*
================
Pose
================
*/
type Pose = ReturnType<typeof createCharacterPose>;

/*
================
createPaletteStreams

Exact pose identity and identical inverse-bind tables share a stream;
no clock quantization or sampled matrix comparison.
================
*/
export function createPaletteStreams( model: CharacterModel, capacity: number ) {
	const bindings = paletteBindings( model );
	const unique = new Map<Pose, number>(), ordered: Pose[] = [];
	const canonical = new Map<CharacterModel["primitives"][number], {
		primitive: CharacterModel["primitives"][number];
		data: Float32Array;
		offsets: Uint32Array;
		previous: Pose[];
		versions: number[];
		length: number;
		revision: number;
		mappingChanged: boolean;
		cpuValid: boolean;
	}>();
	const streams = model.primitives.map( primitive => {
		const key = bindings.get( primitive ) ?? primitive;
		let stream = canonical.get( key );
		if ( !stream ) {
			stream = {
				primitive: key,
				data: new Float32Array( capacity * key.joints.length * 16 ),
				offsets: new Uint32Array( capacity ),
				previous: [],
				versions: [],
				length: 0,
				revision: 0,
				mappingChanged: true,
				cpuValid: true
			};
			canonical.set( key, stream );
		}
		return stream;
	} );
	return {
		streams,
		/*
 ================
 update

 Use the current animation catalog for GPU admission while preserving the
 batch's original skeleton bindings, shared storage and palette revisions.
 ================
 */
		update( poses: readonly Pose[], gpu?: GeometryCommands["prepareGpuBones"], source: CharacterModel = model ) {
			if ( poses.length > capacity ) throw Error( "Palette stream capacity exceeded" );
			unique.clear();
			ordered.length = 0;
			for ( const pose of poses ) {
				if ( !unique.has( pose ) ) {
					unique.set( pose, ordered.length );
					ordered.push( pose );
				}
			}
			const samples = gpu ? ordered.map( pose => pose.gpuSample() ) : [];
			const eligible = !!gpu && samples.some( sample => sample !== null );
			for ( const stream of canonical.values() ) {
				const stride = stream.primitive.joints.length * 16;
				let changed = stream.previous.length !== ordered.length;
				for ( let i = 0; i < ordered.length; i++ ) {
					if ( stream.previous[i] !== ordered[i] || stream.versions[i] !== ordered[i]!.revision() ) {
						changed = true;
						break;
					}
				}
				// A layered pose owns only its slot, never the entire model batch.
				if ( changed && eligible ) {
					for ( let i = 0; i < ordered.length; i++ ) {
						if ( samples[i] === null ) {
							ordered[i]!.palette( stream.primitive, stream.data, i * stride );
						}
					}
				}
				const onGpu = changed && eligible &&
					gpu!( stream.data, source, stream.primitive, samples, stream.revision + 1 );
				for ( let i = 0; i < ordered.length; i++ ) {
					const pose = ordered[i]!, version = pose.revision();
					if (
						changed && !onGpu &&
						(!stream.cpuValid || stream.previous[i] !== pose || stream.versions[i] !== version)
					) pose.palette( stream.primitive, stream.data, i * stride );
					stream.previous[i] = pose;
					stream.versions[i] = version;
				}
				if ( changed ) stream.cpuValid = !onGpu;
				stream.previous.length = stream.versions.length = ordered.length;
				stream.mappingChanged = false;
				for ( let i = 0; i < poses.length; i++ ) {
					const offset = unique.get( poses[i]! )! * stream.primitive.joints.length;
					if ( stream.offsets[i] !== offset ) {
						stream.offsets[i] = offset;
						stream.mappingChanged = true;
					}
				}
				stream.length = ordered.length * stride;
				if ( changed ) stream.revision++;
			}
		}
	};
}
