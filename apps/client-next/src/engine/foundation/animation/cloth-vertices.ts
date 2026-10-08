/*
===========================================================================

cloth-vertices.ts - one mesh instance's retained dynamic vertex stream

===========================================================================
*/
import type { Geometry } from "@/engine/contracts/geometry";
import type { ClothData } from "./cloth";
import { createCloth } from "@/engine/foundation/animation/cloth";
import { packGeometryVertices } from "@/engine/foundation/rendering/geometry-vertices";

/*
================
createClothVertices

Keep separate state per actor, even when actors share the same asset.
================
*/
export function createClothVertices( primitive: { geometry: Geometry; cloth?: ClothData; }, random: () => number ) {
	const mesh = primitive.geometry, data = primitive.cloth!;
	const simulation = createCloth( data, mesh.positions );
	const anchors = new Float32Array( mesh.positions.length );
	const vertices = packGeometryVertices( mesh );
	const skinned = !!mesh.joints && !!mesh.weights;
	// The GPU-skinned stream between solver steps: pins at rest (the shader
	// skins them), free vertices at their simulated model-space positions and
	// normals, refreshed after every CPU update. Free vertices get no bone
	// weight, so a clothPins draw passes them through unskinned.
	const pinned = packGeometryVertices( mesh );
	let freeWeights: Float32Array | null | undefined;
	let lastTime: number | undefined, lastEnabled = false;
	return {
		/*
		================
		restart

		The next update starts from the anchors as the first did: the GPU cloth
		moved this cloth while it ran, so the CPU state is stale.
		================
		*/
		restart() {
			lastTime = undefined;
			simulation.restart();
		},
		/*
		================
		cpuDue

		True when this frame needs the CPU update: the first one, a change of
		enabled, or a solver step falling due. Otherwise the last update's free
		vertices stand and pinnedVertices draws the pins on the GPU.
		================
		*/
		cpuDue( seconds: number, enabled: boolean ): boolean {
			if ( lastTime === undefined || enabled !== lastEnabled || !enabled ) return true;
			return simulation.stepDue( Math.trunc( seconds * 1000 ) - Math.trunc( lastTime * 1000 ) );
		},
		/*
		================
		pinnedVertices

		The GPU-skinned stream as of the last update.
		================
		*/
		pinnedVertices(): Float32Array {
			return pinned;
		},
		/*
		================
		pinnedWeights

		The mesh's bone weights with every free vertex's zeroed; undefined when
		the pins cannot be skinned on the GPU exactly. The CPU skins a pin with
		no weight to the origin, where the pins draw would pass it through.
		================
		*/
		pinnedWeights(): Float32Array | undefined {
			if ( !mesh.joints || !mesh.weights ) return undefined;
			if ( freeWeights === undefined ) {
				const weights = new Float32Array( mesh.weights );
				let exact = true;
				for ( let i = 0; i < data.pins.length; i++ ) {
					const at = i * 4;
					if ( data.pins[i] === 0 ) weights.fill( 0, at, at + 4 );
					else if ( !weights[at] && !weights[at + 1] && !weights[at + 2] && !weights[at + 3] ) exact = false;
				}
				freeWeights = exact ? weights : null;
			}
			return freeWeights ?? undefined;
		},
		/*
		================
		hold

		True when update would return exactly the last vertices, given that
		the palette has not changed since, so the caller may skip it. Enabled,
		no step may fall due and the skipped time stays owed: deltaMs is
		measured from the last real update, so the accumulator sees the same
		sum. Disabled, an update resets the accumulator, so the frame's time
		passes here instead.
		================
		*/
		hold( seconds: number, enabled: boolean ): boolean {
			if ( lastTime === undefined || enabled !== lastEnabled ) return false;
			if ( !enabled ) {
				lastTime = seconds;
				return true;
			}
			return !simulation.due( Math.trunc( seconds * 1000 ) - Math.trunc( lastTime * 1000 ), anchors );
		},

		/*
		================
		update

		AEADE0 refreshes pinned vertices from the skeleton before simulation.
		================
		*/
		update(
			palette: Float32Array,
			seconds: number,
			enabled: boolean,
			motion: { direction: readonly number[]; speed: number; }
		) {
			// Unskinned meshes have immutable model-space anchors. Option changes
			// still reset the simulation below, using those original anchors.
			for ( let i = 0; (skinned || lastTime === undefined) && i < mesh.positions.length / 3; i++ ) {
				// Once initialized, free vertices belong to the simulation. Their
				// skeleton anchors and normals are unused until animation is disabled.
				if ( enabled && lastTime !== undefined && data.pins[i] === 0 ) continue;
				const at = i * 3;
				const x = mesh.positions[at]!, y = mesh.positions[at + 1]!, z = mesh.positions[at + 2]!;
				const nx = mesh.normals?.[at] ?? 0, ny = mesh.normals?.[at + 1] ?? 1, nz = mesh.normals?.[at + 2] ?? 0;
				let px = x, py = y, pz = z, normalX = nx, normalY = ny, normalZ = nz;
				if ( mesh.joints && mesh.weights ) {
					px =
						py =
						pz =
						normalX =
						normalY =
						normalZ =
							0;
					for ( let joint = 0; joint < 4; joint++ ) {
						const weight = mesh.weights[i * 4 + joint]!;
						if ( !weight ) continue;
						const base = mesh.joints[i * 4 + joint]! * 16;
						let ax = palette[base + 12]!, ay = palette[base + 13]!, az = palette[base + 14]!;
						let bx = 0, by = 0, bz = 0;
						// Each axis retains its original double-precision accumulation
						// order. Share the influence lookup, not intermediate rounding.
						ax += palette[base]! * x;
						ay += palette[base + 1]! * x;
						az += palette[base + 2]! * x;
						bx += palette[base]! * nx;
						by += palette[base + 1]! * nx;
						bz += palette[base + 2]! * nx;
						ax += palette[base + 4]! * y;
						ay += palette[base + 5]! * y;
						az += palette[base + 6]! * y;
						bx += palette[base + 4]! * ny;
						by += palette[base + 5]! * ny;
						bz += palette[base + 6]! * ny;
						ax += palette[base + 8]! * z;
						ay += palette[base + 9]! * z;
						az += palette[base + 10]! * z;
						bx += palette[base + 8]! * nz;
						by += palette[base + 9]! * nz;
						bz += palette[base + 10]! * nz;
						px += ax * weight;
						py += ay * weight;
						pz += az * weight;
						normalX += bx * weight;
						normalY += by * weight;
						normalZ += bz * weight;
					}
				}
				anchors[at] = px;
				anchors[at + 1] = py;
				anchors[at + 2] = pz;
				if ( !enabled || data.pins[i] !== 0 || lastTime === undefined ) {
					vertices[i * 14 + 3] = normalX;
					vertices[i * 14 + 4] = normalY;
					vertices[i * 14 + 5] = normalZ;
				}
			}
			const positions = simulation.advance( {
				anchors,
				deltaMs: lastTime === undefined ? 0 : Math.trunc( seconds * 1000 ) - Math.trunc( lastTime * 1000 ),
				enabled,
				direction: motion.direction,
				speed: motion.speed,
				random
			} );
			lastTime = seconds;
			lastEnabled = enabled;
			for ( let i = 0; i < positions.length / 3; i++ ) {
				vertices[i * 14] = positions[i * 3]!;
				vertices[i * 14 + 1] = positions[i * 3 + 1]!;
				vertices[i * 14 + 2] = positions[i * 3 + 2]!;
				if ( data.pins[i] !== 0 ) continue;
				// Free vertices: the simulated position and the normal they carry.
				for ( let c = 0; c < 6; c++ ) pinned[i * 14 + c] = vertices[i * 14 + c]!;
			}
			return vertices;
		}
	};
}
