/*
===========================================================================

batch-census.ts - how many character draws one batch per item would need

The character renderer batches by assembled model: every outfit combination
is its own model, so an item worn across a crowd is drawn once for each
outfit that holds it. Effects are the same: each caster's effect is its own
one-row assembly of the effect model. The census counts one frame's live
character draws by kind, with the distinct items behind them: a geometry
and its texture, both shared by every assembly that wears the part or
casts the effect. The item count is the draws a batch per item would issue.
Effects are also listed by name: their draws, casters, items and particles.

Developer panel only (frame-report.ts formats it). Owns one frame's counts.

===========================================================================
*/

// Count names of the per-effect table: census-fx-<stat>:<effect name>.
export const EFFECT_COUNT_PREFIX = "census-fx-";
// The effect name of particles and ribbons on worn items, not effect models.
export const ITEM_EFFECT = "(particles on items)";

/*
================
CensusKind

mesh: skinned or static item meshes. cloth: meshes whose vertices each
player simulates. effect: effect models' draws, and particles and ribbons.
================
*/
export type CensusKind = "mesh" | "cloth" | "effect";

/*
================
CensusDraw

One live draw: its kind, the item it draws (geometry and texture), its
instances, and for an effect draw the effect's name and live particles.
================
*/
export interface CensusDraw {
	kind: CensusKind;
	geometry: object;
	texture: unknown;
	instances: number;
	effect: string | undefined;
	particles: number;
}

/*
================
CensusItem

One item's draws this frame and the instances they hold.
================
*/
type CensusItem = { draws: number; instances: number; };

/*
================
CensusEffect

One effect's draws, casters and live particles, and its distinct items.
================
*/
type CensusEffect = { draws: number; casters: number; particles: number; items: Map<object, Set<unknown>>; };

/*
================
BatchCensus
================
*/
export interface BatchCensus {
	add( draw: CensusDraw ): void;
	// count actors casting effect this frame (one batch's rows).
	casters( effect: string, count: number ): void;
	// census-<kind>-draws, -items and -instances for each kind, the most worn
	// mesh item's census-top-instances and census-top-draws, and per effect
	// EFFECT_COUNT_PREFIX + draws, casters, items and particles.
	counts(): Record<string, number>;
}

/*
================
censusKinds

The kinds in report order.
================
*/
export function censusKinds(): readonly CensusKind[] {
	return [ "mesh", "cloth", "effect" ];
}

/*
================
effectStats

The per-effect counts, in the panel's column order.
================
*/
export function effectStats(): readonly ("draws" | "casters" | "items" | "particles")[] {
	return [ "draws", "casters", "items", "particles" ];
}

/*
================
createBatchCensus
================
*/
export function createBatchCensus(): BatchCensus {
	const items = new Map<CensusKind, Map<object, Map<unknown, CensusItem>>>();
	const draws = new Map<CensusKind, number>(), instances = new Map<CensusKind, number>();
	const effects = new Map<string, CensusEffect>();
	/*
	================
	effectOf
	================
	*/
	function effectOf( name: string ): CensusEffect {
		let effect = effects.get( name );
		if ( !effect ) {
			effect = { draws: 0, casters: 0, particles: 0, items: new Map() };
			effects.set( name, effect );
		}
		return effect;
	}
	return {
		add( draw ) {
			const { kind, geometry, texture } = draw;
			draws.set( kind, (draws.get( kind ) ?? 0) + 1 );
			instances.set( kind, (instances.get( kind ) ?? 0) + draw.instances );
			let byGeometry = items.get( kind );
			if ( !byGeometry ) {
				byGeometry = new Map();
				items.set( kind, byGeometry );
			}
			let byTexture = byGeometry.get( geometry );
			if ( !byTexture ) {
				byTexture = new Map();
				byGeometry.set( geometry, byTexture );
			}
			const item = byTexture.get( texture );
			if ( item ) {
				item.draws++;
				item.instances += draw.instances;
			} else byTexture.set( texture, { draws: 1, instances: draw.instances } );
			if ( draw.effect === undefined ) return;
			const effect = effectOf( draw.effect );
			effect.draws++;
			effect.particles += draw.particles;
			let textures = effect.items.get( geometry );
			if ( !textures ) {
				textures = new Set();
				effect.items.set( geometry, textures );
			}
			textures.add( texture );
		},
		casters( name, count ) {
			effectOf( name ).casters += count;
		},
		counts() {
			const result: Record<string, number> = {};
			let top: CensusItem = { draws: 0, instances: 0 };
			for ( const kind of censusKinds() ) {
				let distinct = 0;
				for ( const byTexture of items.get( kind )?.values() ?? [] ) {
					distinct += byTexture.size;
					if ( kind !== "mesh" ) continue;
					for ( const item of byTexture.values() ) if ( item.instances > top.instances ) top = item;
				}
				result[`census-${kind}-draws`] = draws.get( kind ) ?? 0;
				result[`census-${kind}-items`] = distinct;
				result[`census-${kind}-instances`] = instances.get( kind ) ?? 0;
			}
			result["census-top-instances"] = top.instances;
			result["census-top-draws"] = top.draws;
			for ( const [name, effect] of effects ) {
				let distinct = 0;
				for ( const textures of effect.items.values() ) distinct += textures.size;
				result[`${EFFECT_COUNT_PREFIX}draws:${name}`] = effect.draws;
				result[`${EFFECT_COUNT_PREFIX}casters:${name}`] = effect.casters;
				result[`${EFFECT_COUNT_PREFIX}items:${name}`] = distinct;
				result[`${EFFECT_COUNT_PREFIX}particles:${name}`] = effect.particles;
			}
			return result;
		}
	};
}
