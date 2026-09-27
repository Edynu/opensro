/*
===========================================================================

Terrain Association Masks

Reconstructs the native per-block terrain texture passes, including the
partial masks and one-cell influence fringe that blend adjacent tile
associations.

===========================================================================
*/

const MAPM_TEXTURE_ID_MASK = 0x03ff;
const MAPM_TEXTURE_SCALE_SHIFT = 13;
const NATIVE_ASSOCIATION_CAPACITY = 0x31;

export type NativeTerrainAssociationSource = {
	verticesPerBlockAxis: number;
	tilesPerBlockAxis: number;
	textureData: ArrayLike<number>;
	textureIds?: ArrayLike<number>;
};

export type NativeTerrainAssociationPass = {
	tileX: number;
	tileZ: number;
	associationKey: number;
	associationWord: number;
	/** TL/TR/BL/BR mask texels in bits 0/1/2/3. */
	cornerMask: number;
	/** Pixel-equivalent opaque underlay retained after native-pass pruning. */
	opaque: boolean;
};

type RawNativeTerrainAssociationPass = Omit<NativeTerrainAssociationPass, "opaque"> & {
	tileIndex: number;
};

/*
================
terrainAssociationKey
================
*/
export function terrainAssociationKey( word: number ): number {
	// Native std::map key (sub_8b3aa0 @008b3f0c):
	// (uint16)(word << 6) | (word >> 13) = textureId << 6 | scale.
	return ( ( word & MAPM_TEXTURE_ID_MASK ) << 6 ) | ( ( word >>> MAPM_TEXTURE_SCALE_SHIFT ) & 0x7 );
}

/*
================
buildNativeTerrainAssociationPasses

Native sub_8b3aa0 builds association keys in a std::map
(@008b3f00..008b3f27), then visits them in ascending order. Matching
vertices set their A1R5G5B5 mask texel to 0xffff and mark the four touching
temporary cells with value 2 (@008b438c..008b43ab).

A persistent 16x16 claim map is cleared once before the association loop
(@008b3f51..008b3f66). During each association, a direct cell that has not
been claimed forces its four mask texels opaque, claims the cell, and ORs
bit 0 into its eight temporary neighbors (@008b4426..008b4467). The later
geometry loop tests the per-association temporary cell byte itself
(@008b44aa..008b44de), not the persistent claim byte. Consequently both
already-claimed direct cells and the influence fringe are still drawn with
their partial masks.

The browser can safely discard every pass before a tile's last fully
opaque pass: that pass overwrites the same pixel footprint before all later
partial passes blend over it. This preserves the native final pixels while
keeping one opaque underlay plus only the visible later blends.
================
*/
export function buildNativeTerrainAssociationPasses(
	source: NativeTerrainAssociationSource
): NativeTerrainAssociationPass[] {
	const { verticesPerBlockAxis, tilesPerBlockAxis } = source;
	if (
		!Number.isInteger( verticesPerBlockAxis ) ||
		!Number.isInteger( tilesPerBlockAxis ) ||
		tilesPerBlockAxis <= 0 ||
		verticesPerBlockAxis !== tilesPerBlockAxis + 1
	) {
		throw new Error(
			`Invalid terrain association grid ${verticesPerBlockAxis}x${verticesPerBlockAxis} vertices ` +
			`for ${tilesPerBlockAxis}x${tilesPerBlockAxis} tiles.`
		);
	}

	const	vertexCount = verticesPerBlockAxis * verticesPerBlockAxis;
	const	tileCount = tilesPerBlockAxis * tilesPerBlockAxis;
	const	words = new Uint16Array( vertexCount );
	const	associationKeySet = new Set<number> ();
	for ( let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1 ) {
		const	word = source.textureData[vertexIndex] ?? source.textureIds?.[vertexIndex];
		if ( !Number.isFinite( word ) ) {
			throw new Error( `Terrain association vertex ${vertexIndex} has no texture word.` );
		}
		words[vertexIndex] = word;
		associationKeySet.add( terrainAssociationKey( word ) );
	}

	const	associationKeys = [...associationKeySet].sort( ( left, right ) => left - right );
	const	claimedCells = new Uint8Array( tileCount );
	const	rawPasses: RawNativeTerrainAssociationPass[] = [];
	const	paddedCellAxis = tilesPerBlockAxis + 2;

	for ( const associationKey of associationKeys.slice( 0, NATIVE_ASSOCIATION_CAPACITY ) ) {
		const	associationWord = associationWordFromKey( associationKey );
		const	temporaryCells = new Uint8Array( paddedCellAxis * paddedCellAxis );
		const	vertexMask = new Uint8Array( vertexCount );

		for ( let vertexZ = 0; vertexZ < verticesPerBlockAxis; vertexZ += 1 ) {
			for ( let vertexX = 0; vertexX < verticesPerBlockAxis; vertexX += 1 ) {
				const	vertexIndex = vertexZ * verticesPerBlockAxis + vertexX;
				if ( words[vertexIndex] !== associationWord ) {
					continue;
				}

				vertexMask[vertexIndex] = 1;
				const	topLeftCell = vertexZ * paddedCellAxis + vertexX;
				temporaryCells[topLeftCell] = 2;
				temporaryCells[topLeftCell + 1] = 2;
				temporaryCells[topLeftCell + paddedCellAxis] = 2;
				temporaryCells[topLeftCell + paddedCellAxis + 1] = 2;
			}
		}

		// The persistent claim map only decides which direct cells force an
		// opaque mask quad and grow the one-cell temporary influence fringe.
		for ( let tileZ = 0; tileZ < tilesPerBlockAxis; tileZ += 1 ) {
			for ( let tileX = 0; tileX < tilesPerBlockAxis; tileX += 1 ) {
				const	tileIndex = tileZ * tilesPerBlockAxis + tileX;
				const	paddedCellIndex = ( tileZ + 1 ) * paddedCellAxis + tileX + 1;
				if (
					( temporaryCells[paddedCellIndex] & 0xfe ) === 0 ||
					claimedCells[tileIndex] !== 0
				) {
					continue;
				}

				const	topLeft = tileZ * verticesPerBlockAxis + tileX;
				vertexMask[topLeft] = 1;
				vertexMask[topLeft + 1] = 1;
				vertexMask[topLeft + verticesPerBlockAxis] = 1;
				vertexMask[topLeft + verticesPerBlockAxis + 1] = 1;
				for ( let neighborZ = -1; neighborZ <= 1; neighborZ += 1 ) {
					for ( let neighborX = -1; neighborX <= 1; neighborX += 1 ) {
						if ( neighborX === 0 && neighborZ === 0 ) {
							continue;
						}
						temporaryCells[
							paddedCellIndex + neighborZ * paddedCellAxis + neighborX
						] |= 1;
					}
				}
				claimedCells[tileIndex] = 1;
			}
		}

		// Native geometry emission tests any non-zero temporary cell byte, so
		// it includes direct cells even when already persistently claimed and
		// the bit-0 fringe cells created above.
		for ( let tileZ = 0; tileZ < tilesPerBlockAxis; tileZ += 1 ) {
			for ( let tileX = 0; tileX < tilesPerBlockAxis; tileX += 1 ) {
				const	tileIndex = tileZ * tilesPerBlockAxis + tileX;
				const	paddedCellIndex = ( tileZ + 1 ) * paddedCellAxis + tileX + 1;
				if ( temporaryCells[paddedCellIndex] === 0 ) {
					continue;
				}

				const	topLeft = tileZ * verticesPerBlockAxis + tileX;
				const	cornerMask =
					vertexMask[topLeft] |
					( vertexMask[topLeft + 1] << 1 ) |
					( vertexMask[topLeft + verticesPerBlockAxis] << 2 ) |
					( vertexMask[topLeft + verticesPerBlockAxis + 1] << 3 );
				if ( cornerMask === 0 ) {
					continue;
				}
				rawPasses.push( {
					tileX,
					tileZ,
					associationKey,
					associationWord,
					cornerMask,
					tileIndex
				} );
			}
		}
	}

	// A later all-opaque mask replaces every earlier pass on the same tile.
	// Retain that last underlay and the partial native passes after it.
	const	lastOpaquePassByTile = new Int32Array( tileCount );
	lastOpaquePassByTile.fill( -1 );
	for ( let passIndex = 0; passIndex < rawPasses.length; passIndex += 1 ) {
		const	pass = rawPasses[passIndex];
		if ( pass.cornerMask === 0x0f ) {
			lastOpaquePassByTile[pass.tileIndex] = passIndex;
		}
	}

	const	passes: NativeTerrainAssociationPass[] = [];
	for ( let passIndex = 0; passIndex < rawPasses.length; passIndex += 1 ) {
		const	rawPass = rawPasses[passIndex];
		const	opaquePassIndex = lastOpaquePassByTile[rawPass.tileIndex];
		if ( opaquePassIndex >= 0 && passIndex < opaquePassIndex ) {
			continue;
		}
		const	{ tileIndex: _tileIndex, ...pass } = rawPass;
		passes.push( {
			...pass,
			opaque: passIndex === opaquePassIndex
		} );
	}
	return passes;
}

/*
================
associationWordFromKey
================
*/
function associationWordFromKey( associationKey: number ): number {
	const	textureId = ( associationKey >>> 6 ) & MAPM_TEXTURE_ID_MASK;
	const	scale = associationKey & 0x7;
	return textureId | ( scale << MAPM_TEXTURE_SCALE_SHIFT );
}
