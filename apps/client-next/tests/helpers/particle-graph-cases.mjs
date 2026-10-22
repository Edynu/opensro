/*
===========================================================================

particle-graph-cases.mjs - seeded particle graphs that use every feature

Random EFP element trees for the particle kernel's differential tests:
root and child emitters, scheduled births with shared parents, emissions
with capacities and loops, commands of every kind (rotations in all four
bases, BAN rotations, positions in every origin mode, vectors, local and
shape rotations, attraction, cone, sphere and scale samples), programs
with vector, rotation, spin, attraction and scale frames, every depth
link, kept matrices and origins, local and shape motion, authored
matrices and scale, position and rotation tracks; and the frames to drive
them through (catch-up ticks, held frames, region crossings, stops).

===========================================================================
*/

/*
================
quaternionMatrix

A column-major 4x4 rotation from a random unit quaternion, times scale.
================
*/
export function quaternionMatrix( random, scale = 1 ) {
	let x = random() - .5, y = random() - .5, z = random() - .5, w = random() - .5;
	const length = Math.hypot( x, y, z, w );
	x /= length;
	y /= length;
	z /= length;
	w /= length;
	return [
		(1 - 2 * (y * y + z * z)) * scale,
		2 * (x * y + z * w) * scale,
		2 * (x * z - y * w) * scale,
		0,
		2 * (x * y - z * w) * scale,
		(1 - 2 * (x * x + z * z)) * scale,
		2 * (y * z + x * w) * scale,
		0,
		2 * (x * z + y * w) * scale,
		2 * (y * z - x * w) * scale,
		(1 - 2 * (x * x + y * y)) * scale,
		0,
		0,
		0,
		0,
		1
	];
}

/*
================
pick
================
*/
function pick( random, values ) {
	return values[Math.floor( random() * values.length )];
}

/*
================
vector3
================
*/
function vector3( random, size = 2 ) {
	return [ (random() - .5) * size, (random() - .5) * size, (random() - .5) * size ];
}

/*
================
frames

Some frames below total.
================
*/
function frames( random, total ) {
	const out = [];
	for ( let f = 0; f < total; f++ ) if ( random() < .3 ) out.push( f );
	return out.length ? out : [ 0 ];
}

/*
================
program

A program using a random subset of the ops; total its emitter's frames.
================
*/
function program( random, total, sibling ) {
	const p = {};
	if ( random() < .5 ) {
		p.vectors = Array.from( { length: 1 + Math.floor( random() * 3 ) }, () => {
			const name = pick( random, [ "SetPosition", "SetVelocity", "Force" ] );
			return {
				name,
				flags: Math.floor( random() * (name === "SetPosition" ? (sibling ? 12 : 8) : sibling ? 4 : 3) ),
				value: vector3( random, .5 ),
				frames: frames( random, total )
			};
		} );
	}
	if ( random() < .3 ) {
		p.rVelocity = quaternionMatrix( random );
		if ( random() < .5 ) p.rotationFrames = frames( random, total );
	}
	if ( random() < .3 ) {
		p.spin = quaternionMatrix( random );
		if ( random() < .5 ) p.spinFrames = frames( random, total );
	}
	if ( random() < .2 ) p.shape = quaternionMatrix( random );
	if ( random() < .3 ) {
		p.attraction = (random() - .5) * .2;
		if ( random() < .5 ) p.attractionFrames = frames( random, total );
	}
	if ( random() < .4 ) {
		p.cone = [ random() * .2, .2 + random() * .3, random() * 1.5 ];
		if ( random() < .7 ) p.coneFlags = Math.floor( random() * (sibling ? 4 : 3) );
	}
	if ( random() < .3 ) {
		p.coneForce = [ random() * .1, .1 + random() * .1, random() ];
		if ( random() < .7 ) p.coneForceFlags = Math.floor( random() * (sibling ? 4 : 3) );
	}
	if ( random() < .3 ) {
		p.conePos = [ random() * .5, .5 + random(), random() * 2 ];
		p.conePosFlags = pick( random, [ 0, 2, 7 ] );
	}
	if ( random() < .4 ) {
		p.sphere = vector3( random, 3 );
		if ( random() < .7 ) p.sphereFlags = Math.floor( random() * (sibling ? 3 : 2) );
	}
	if ( random() < .4 ) {
		p.scale = [ { time: 0, value: vector3( random, 2 ) }, { time: .4, value: vector3( random, 2 ) }, {
			time: 1,
			value: vector3( random, 2 )
		} ];
		if ( random() < .6 ) p.scaleFrames = random() < .5 ? [ 0, 1 ] : [ 0 ];
	}
	if ( random() < .4 ) {
		const ops = [ "SetSpherePos", "SetGraphRandomScale", "SetConeVel", "ConeForce", "SetConePos", "SetShapeRot" ];
		p.order = ops.filter( () => random() < .6 );
	}
	return p;
}

/*
================
commands

An emitter's command list: each a rotation track, a position track or a
program, on some of its frames.
================
*/
function commands( random, total, sibling ) {
	return Array.from( { length: 1 + Math.floor( random() * 4 ) }, () => {
		const kind = random(),
			base = {
				name: random() < .3 ? "SetBANRot" : "Command",
				frames: frames( random, total ),
				program: program( random, total, sibling )
			};
		if ( kind < .3 ) {
			return {
				...base,
				flags: Math.floor( random() * (sibling ? 4 : 3) ),
				rotations: Array.from( { length: 1 + Math.floor( random() * 3 ) }, () => quaternionMatrix( random ) )
			};
		}
		if ( kind < .55 ) {
			return {
				...base,
				flags: Math.floor( random() * (sibling ? 12 : 9) ),
				positions: Array.from( { length: 1 + Math.floor( random() * 3 ) }, () => vector3( random, 2 ) )
			};
		}
		return random() < .5 ? { ...base, flags: Math.floor( random() * 4 ) } : base;
	} );
}

/*
================
particleGraphCase

A graph of 2..6 emitters, each a child of the root or an earlier
emitter, with scheduled births or an emission.
================
*/
export function particleGraphCase( random ) {
	const count = 2 + Math.floor( random() * 5 ), graph = [];
	for ( let n = 0; n < count; n++ ) {
		const parent = n === 0 || random() < .35 ? -1 : Math.floor( random() * n );
		const parentSlots = parent < 0 ? 1 : graph[parent].capacity ?? graph[parent].births.length;
		const total = 3 + Math.floor( random() * 14 );
		const emits = random() < .45;
		const def = {
			parent,
			frames: total,
			keepMatrix: random() < .4,
			keepOrigin: random() < .4,
			positionDepth: pick( random, [ 0, 0, 1, 2, 3 ] ),
			matrixDepth: pick( random, [ 0, 0, 1, 2, -1 ] ),
			velocityDepth: pick( random, [ 0, 0, 1, 2 ] ),
			followDepth: pick( random, [ 0, 0, 1, 2 ] ),
			scales: random() < .4 ?
				Array.from( { length: 1 + Math.floor( random() * 4 ) }, () => vector3( random, 2 ) ) :
				[],
			positions: random() < .3 ?
				Array.from( { length: 1 + Math.floor( random() * 3 ) }, () => vector3( random, 1 ) ) :
				[],
			rotations: random() < .3 ?
				Array.from( { length: 1 + Math.floor( random() * 3 ) }, () => quaternionMatrix( random ) ) :
				[],
			parents: /** @type {number[]} */ ([]),
			births: /** @type {number[]} */ ([])
		};
		if ( random() < .3 ) def.loop = true;
		if ( random() < .25 ) def.localMotion = true;
		if ( random() < .25 ) def.shapeMotion = true;
		if ( random() < .2 ) def.matrix = quaternionMatrix( random, .5 + random() );
		if ( emits ) {
			const limit = 1 + Math.floor( random() * 4 );
			def.emission = {
				start: Math.floor( random() * 3 ),
				duration: 4 + Math.floor( random() * 20 ),
				period: 1 + Math.floor( random() * 3 ),
				limit,
				rate: Math.fround( .5 + random() * 2 )
			};
			// Dead elements whose children live on keep their slots past the
			// emission limit, so capacity has room for them.
			def.capacity = limit * parentSlots * 3 + 8;
			def.births = Array.from( { length: Math.min( 8, def.capacity ) }, ( _, i ) => i );
			def.parents = def.births.map( () => 0 );
		} else {
			// A parent index names one of the parent emitter's births, as
			// admission requires (character-budget.ts); a parent born later
			// leaves its children waiting.
			const births = 1 + Math.floor( random() * 6 );
			const parentBirths = parent < 0 ? 1 : graph[parent].births.length;
			def.births = Array.from( { length: births }, () => Math.floor( random() * 12 ) );
			def.parents = def.births.map( () => Math.floor( random() * parentBirths ) );
			// Neighbours share a parent now and then, so they are siblings.
			for ( let b = 1; b < births; b++ ) if ( random() < .4 ) def.parents[b] = def.parents[b - 1];
		}
		const sibling = emits ? random() < .5 : true;
		if ( random() < .4 ) def.commands = commands( random, total, sibling );
		else if ( random() < .8 ) def.program = program( random, total, sibling );
		graph.push( def );
	}
	return graph;
}

/*
================
particleFrames

frames inputs for advanceParticleGraph: time, the holder transform (a
rotation, a scale and a translation), a region shift now and then.
================
*/
export function particleFrames( random, count ) {
	let time = random() * .2;
	const out = [];
	for ( let frame = 0; frame < count; frame++ ) {
		time += pick( random, [ 0, .016, .033, .05, .05, .1, .17, .4 ] );
		const transform = Float32Array.from( quaternionMatrix( random, .8 + random() * .4 ) );
		transform[12] = (random() - .5) * 20;
		transform[13] = random() * 4;
		transform[14] = (random() - .5) * 20;
		const crossing = random() < .05;
		out.push( {
			time,
			transform,
			shiftX: crossing ? pick( random, [ -192, 192, 0 ] ) : 0,
			shiftZ: crossing ? pick( random, [ 192, -192 ] ) : 0
		} );
	}
	return out;
}
