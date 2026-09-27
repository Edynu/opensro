import type {SkillTooltipRowView,TooltipSkillCatalog} from './skill-tooltip-data';
export function decodeTooltipSkills(value:unknown):TooltipSkillCatalog{
// Native 84B2F0 parameter cursor and 7F9310 published column projection.
type SkillPaneParamDisposition = "display" | "runtime" | "get-value" | "set-value" | "requirement" | "marker" | "terminal";

interface SkillPaneParamSpec {
	arity: number;
	offset: number | null;
	disposition: SkillPaneParamDisposition;
}

/*
================
SkillPane_ParamTag
================
*/
function SkillPane_ParamTag( value: string ): number {
	let tag = 0;

	for ( const character of value ) {
		tag = ( ( tag << 8 ) | character.charCodeAt( 0 ) ) >>> 0;
	}
	return tag;
}

/*
================
SkillPane_ParamSpec
================
*/
function SkillPane_ParamSpec(
	name: string,
	arity: number,
	offset: number | null,
	disposition: SkillPaneParamDisposition = "display"
): readonly [ number, SkillPaneParamSpec ] {
	return [ SkillPane_ParamTag( name ), { arity, offset, disposition } ] as const;
}

/*
 * Native sub_84b2f0's authored-tag frontier.  Keeping arity and destination
 * together is important: walking with indexOf made a numeric value which
 * happened to equal a tag steal ownership from its real enclosing block.
 * Runtime-only entries are retained so the cursor still advances exactly.
 */
const SKILL_PANE_PARAM_SPECS: ReadonlyMap<number, SkillPaneParamSpec> = new Map ( [
	SkillPane_ParamSpec( "att", 5, 0x004 ), SkillPane_ParamSpec( "pdmg", 1, 0x008 ),
	// sub_84b2f0 @0x84c5d4 installs one value at +0x0c; the complete
	// sub_7f9bd0 direct-tooltip body has no corresponding read.
	SkillPane_ParamSpec( "pdm2", 1, 0x00c, "runtime" ),
	SkillPane_ParamSpec( "ko", 2, 0x010 ),
	SkillPane_ParamSpec( "da", 1, 0x014 ), SkillPane_ParamSpec( "cr", 2, 0x018 ),
	// `gdr` is parsed to CSkillData+0x20 but sub_7f9bd0 has no read/string
	// branch for that pointer; the authored long description owns its UI.
	SkillPane_ParamSpec( "ck", 1, 0x01c ), SkillPane_ParamSpec( "gdr", 1, 0x020, "runtime" ),
	SkillPane_ParamSpec( "hr", 2, 0x024 ), SkillPane_ParamSpec( "ru", 1, 0x028 ),
	SkillPane_ParamSpec( "kb", 2, 0x02c ), SkillPane_ParamSpec( "saps", 2, 0x030 ),
	SkillPane_ParamSpec( "defp", 3, 0x034 ), SkillPane_ParamSpec( "defr", 3, 0x038 ),
	SkillPane_ParamSpec( "ar", 2, 0x03c ), SkillPane_ParamSpec( "dar", 2, 0x040 ),
	SkillPane_ParamSpec( "odar", 2, 0x044 ), SkillPane_ParamSpec( "br", 2, 0x04c ),
	SkillPane_ParamSpec( "er", 2, 0x050 ), SkillPane_ParamSpec( "dura", 1, 0x054 ),
	SkillPane_ParamSpec( "onff", 2, 0x058 ), SkillPane_ParamSpec( "mc", 2, 0x05c ),
	// efr chooses +0x60/+0x64/+0x68 from values[0]; resolved by the walker.
	SkillPane_ParamSpec( "efr", 6, null ), SkillPane_ParamSpec( "eshp", 0, 0x06c, "marker" ),
	SkillPane_ParamSpec( "stns", 3, 0x070 ),
	SkillPane_ParamSpec( "esht", 2, 0x074 ), SkillPane_ParamSpec( "fitp", 2, 0x078 ),
	SkillPane_ParamSpec( "cnsm", 3, 0x07c, "runtime" ), SkillPane_ParamSpec( "rhru", 2, 0x080 ),
	SkillPane_ParamSpec( "dcmp", 1, 0x084 ), SkillPane_ParamSpec( "hpi", 2, 0x088 ),
	SkillPane_ParamSpec( "mpi", 2, 0x08c ), SkillPane_ParamSpec( "pw", 4, 0x090 ),
	SkillPane_ParamSpec( "hste", 1, 0x094 ), SkillPane_ParamSpec( "hst2", 1, 0x098 ),
	SkillPane_ParamSpec( "hst3", 1, 0x09c ), SkillPane_ParamSpec( "irgc", 2, 0x0ac ),
	SkillPane_ParamSpec( "apru", 2, 0x0b0 ), SkillPane_ParamSpec( "apau", 2, 0x0b4 ),
	SkillPane_ParamSpec( "terd", 1, 0x0b8 ), SkillPane_ParamSpec( "thrd", 1, 0x0bc ),
	SkillPane_ParamSpec( "tpdd", 1, 0x0c0 ), SkillPane_ParamSpec( "tpad", 1, 0x0c4 ),
	SkillPane_ParamSpec( "tele", 2, 0x0c8 ), SkillPane_ParamSpec( "tel2", 2, 0x0cc ),
	SkillPane_ParamSpec( "tel3", 2, 0x0d0, "runtime" ), SkillPane_ParamSpec( "reat", 2, 0x0d4 ),
	SkillPane_ParamSpec( "bgra", 2, 0x0d8 ), SkillPane_ParamSpec( "real", 3, 0x0dc ),
	SkillPane_ParamSpec( "pola", 2, 0x0e0 ), SkillPane_ParamSpec( "summ", 5, 0x0e4 ),
	SkillPane_ParamSpec( "fz", 2, 0x0e8 ), SkillPane_ParamSpec( "fb", 2, 0x0ec ),
	SkillPane_ParamSpec( "es", 3, 0x0f0 ), SkillPane_ParamSpec( "bu", 3, 0x0f4 ),
	SkillPane_ParamSpec( "ps", 3, 0x0f8 ), SkillPane_ParamSpec( "zb", 2, 0x0fc ),
	SkillPane_ParamSpec( "heal", 4, 0x100 ), SkillPane_ParamSpec( "resu", 2, 0x104 ),
	SkillPane_ParamSpec( "cura", 1, 0x108 ), SkillPane_ParamSpec( "pmhp", 4, 0x10c ),
	SkillPane_ParamSpec( "pmmp", 4, 0x110 ), SkillPane_ParamSpec( "pmdp", 4, 0x114 ),
	SkillPane_ParamSpec( "pmdg", 4, 0x118 ), SkillPane_ParamSpec( "pao", 1, 0x124 ),
	// sub_84b2f0 @0x84b906: cbuf consumes only its tag and stores the next
	// stream pointer at +0x12c, parallel to nbuf/bbuf.
	SkillPane_ParamSpec( "cbuf", 0, 0x12c, "marker" ),
	SkillPane_ParamSpec( "nbuf", 0, 0x130, "marker" ), SkillPane_ParamSpec( "bbuf", 0, 0x134, "marker" ),
	SkillPane_ParamSpec( "pcdu", 1, 0x138 ), SkillPane_ParamSpec( "chcr", 1, 0x13c ),
	SkillPane_ParamSpec( "cmcr", 1, 0x140 ), SkillPane_ParamSpec( "lnks", 4, 0x144 ),
	SkillPane_ParamSpec( "lks2", 0, 0x148, "marker" ),
	SkillPane_ParamSpec( "lkcp", 1, 0x14c ), SkillPane_ParamSpec( "ovl2", 1, 0x150, "runtime" ),
	SkillPane_ParamSpec( "scls", 1, 0x154, "runtime" ), SkillPane_ParamSpec( "puls", 1, 0x158, "runtime" ),
	SkillPane_ParamSpec( "reqc", 1, 0x170 ), SkillPane_ParamSpec( "reqi", 2, 0x174, "requirement" ),
	SkillPane_ParamSpec( "reqn", 0, 0x188, "marker" ),
	SkillPane_ParamSpec( "atca", 2, 0x190, "runtime" ), SkillPane_ParamSpec( "tant", 2, 0x194, "runtime" ),
	SkillPane_ParamSpec( "tnt2", 2, 0x198 ), SkillPane_ParamSpec( "dtnt", 2, 0x19c ),
	SkillPane_ParamSpec( "dmgt", 2, 0x1a0 ), SkillPane_ParamSpec( "dru", 2, 0x1a4 ),
	SkillPane_ParamSpec( "dru2", 2, 0x1a8 ), SkillPane_ParamSpec( "stri", 2, 0x1ac ),
	// sub_84b2f0 @0x84bbec consumes tag + two values for +0x1b4. The direct
	// tooltip formatter does not read it; growth-potion prose is authored.
	SkillPane_ParamSpec( "spda", 2, 0x1b0 ), SkillPane_ParamSpec( "expi", 2, 0x1b4, "runtime" ),
	SkillPane_ParamSpec( "inti", 2, 0x1b8 ), SkillPane_ParamSpec( "abir", 1, 0x1bc ),
	SkillPane_ParamSpec( "tkss", 1, 0x1c0 ), SkillPane_ParamSpec( "lfst", 1, 0x1c4 ),
	SkillPane_ParamSpec( "tran", 3, 0x1c8 ), SkillPane_ParamSpec( "curt", 2, 0x1cc ),
	SkillPane_ParamSpec( "curl", 3, 0x1d0 ), SkillPane_ParamSpec( "rcur", 1, 0x1d4, "runtime" ),
	SkillPane_ParamSpec( "dmgr", 4, 0x1d8 ), SkillPane_ParamSpec( "dgmp", 1, 0x1dc ),
	// +0x1e0 is gameplay-only: the complete sub_7f9bd0 body has no read of
	// this pointer (TC crown-buff text comes from its authored description).
	SkillPane_ParamSpec( "hwir", 1, 0x1e0, "runtime" ), SkillPane_ParamSpec( "abnb", 1, 0x1e4 ),
	SkillPane_ParamSpec( "dtt", 2, 0x1e8 ), SkillPane_ParamSpec( "dttp", 2, 0x1ec ),
	SkillPane_ParamSpec( "hide", 3, 0x1f0 ), SkillPane_ParamSpec( "dcri", 1, 0x1f4, "runtime" ),
	SkillPane_ParamSpec( "se", 3, 0x1f8 ), SkillPane_ParamSpec( "rt", 3, 0x1fc ),
	SkillPane_ParamSpec( "sl", 3, 0x200 ), SkillPane_ParamSpec( "fe", 3, 0x204 ),
	SkillPane_ParamSpec( "my", 4, 0x208 ), SkillPane_ParamSpec( "bl", 5, 0x20c ),
	SkillPane_ParamSpec( "dn", 4, 0x210 ), SkillPane_ParamSpec( "st", 3, 0x214 ),
	SkillPane_ParamSpec( "ds", 4, 0x218 ), SkillPane_ParamSpec( "ca", 3, 0x21c ),
	SkillPane_ParamSpec( "cssr", 4, 0x220 ), SkillPane_ParamSpec( "csit", 4, 0x224 ),
	SkillPane_ParamSpec( "cspd", 4, 0x228 ), SkillPane_ParamSpec( "csmd", 4, 0x22c ),
	SkillPane_ParamSpec( "cshp", 6, 0x230 ), SkillPane_ParamSpec( "csmp", 6, 0x234 ),
	SkillPane_ParamSpec( "tb", 4, 0x238 ), SkillPane_ParamSpec( "lkdr", 3, 0x23c ),
	SkillPane_ParamSpec( "lkag", 2, 0x240 ), SkillPane_ParamSpec( "lkdd", 1, 0x244 ),
	SkillPane_ParamSpec( "thld", 1, 0x248 ), SkillPane_ParamSpec( "tcmd", 2, 0x24c ),
	SkillPane_ParamSpec( "skc", 3, 0x254, "runtime" ), SkillPane_ParamSpec( "pchr", 1, 0x25c ),
	// sub_84b2f0 @0x84c75e consumes tag + four values and stores +0x260;
	// sub_7f9bd0 never reads it, so it remains an explicit runtime family.
	SkillPane_ParamSpec( "qest", 4, 0x260, "runtime" ), SkillPane_ParamSpec( "msch", 2, 0x268 ),
	SkillPane_ParamSpec( "mcap", 2, 0x26c ), SkillPane_ParamSpec( "rmut", 1, 0x270, "runtime" ),
	SkillPane_ParamSpec( "alcu", 1, 0x278 ), SkillPane_ParamSpec( "luck", 1, 0x27c ),
	SkillPane_ParamSpec( "pwtt", 1, 0x280 ), SkillPane_ParamSpec( "mwtt", 1, 0x284 ),
	SkillPane_ParamSpec( "pwdt", 1, 0x288 ), SkillPane_ParamSpec( "mwdt", 1, 0x28c ),
	SkillPane_ParamSpec( "mwhh", 1, 0x290 ), SkillPane_ParamSpec( "mwmh", 1, 0x294 ),
	SkillPane_ParamSpec( "mwhs", 1, 0x298 ), SkillPane_ParamSpec( "mstc", 1, 0x29c ),
	SkillPane_ParamSpec( "mscc", 1, 0x2a0 ), SkillPane_ParamSpec( "lkdh", 3, 0x2a4 ),
	SkillPane_ParamSpec( "hitm", 0, 0x0a4, "marker" ), SkillPane_ParamSpec( "hntp", 0, 0x250, "marker" ),
	SkillPane_ParamSpec( "trap", 0, 0x264, "marker" ), SkillPane_ParamSpec( "efta", 0, 0x274, "marker" ),
	// Pointer markers: sub_84b2f0 consumes tag only, then stores the following
	// stream address (+0x48 @0x84b39d for `ao`, +0xa8 @0x84c844 for `rpkt`).
	SkillPane_ParamSpec( "ao", 0, 0x048, "marker" ),
	SkillPane_ParamSpec( "rpkt", 0, 0x0a8, "marker" ),
	// sub_84b2f0 @0x84c9a8: `ssou` breaks the parameter loop immediately;
	// following dwords are not tags and must never be independently decoded.
	SkillPane_ParamSpec( "ssou", 0, null, "terminal" ),
	SkillPane_ParamSpec( "getv", 1, null, "get-value" ), SkillPane_ParamSpec( "setv", 3, null, "set-value" )
] );

/*
================
SkillPane_GetParamTagDisposition
================
*/
function SkillPane_GetParamTagDisposition( tag: number ): SkillPaneParamDisposition | null {
	return SKILL_PANE_PARAM_SPECS.get( tag >>> 0 )?.disposition ?? null;
}

/*
================
SkillPane_WalkNativeParamTail
================
*/
function SkillPane_WalkNativeParamTail(
	encodedParamTail: number[],
	onBlock: ( block: { offset: number; tag: number; values: number[] } ) => void,
	onUnknown: ( token: number ) => void
): void {
	let requirementSlot = 0;
	let setValueSlot = 0;

	for ( let index = 0; index < encodedParamTail.length; ) {
		const tag = encodedParamTail[index]! >>> 0;

		if ( tag === 0 ) {
			index += 1;
			continue;
		}
		const spec = SKILL_PANE_PARAM_SPECS.get( tag );

		if ( !spec || index + spec.arity >= encodedParamTail.length ) {
			// Native advances one dword on an unrecognized token.
			onUnknown( tag );
			index += 1;
			continue;
		}
		if ( spec.disposition === "terminal" ) {
			return;
		}
		const values = encodedParamTail.slice( index + 1, index + 1 + spec.arity );
		let offset = spec.offset;

		if ( tag === SkillPane_ParamTag( "efr" ) ) {
			const selector = values[0] ?? 0;
			offset = selector >= 1 && selector <= 3 ? 0x60 + ( selector - 1 ) * 4 : null;
		} else if ( spec.disposition === "set-value" ) {
			offset = setValueSlot < 5 ? 0x15c + setValueSlot++ * 4 : null;
		} else if ( spec.disposition === "requirement" ) {
			offset = requirementSlot < 5 ? 0x174 + requirementSlot++ * 4 : null;
		}
		if ( offset !== null ) {
			onBlock( { offset, tag, values } );
		}
		index += 1 + spec.arity;
	}
}

/*
================
SkillPane_AuditEncodedParamTail
================
*/
function SkillPane_AuditEncodedParamTail( encodedParamTail: number[] ): number[] {
	const unknownTokens: number[] = [];
	SkillPane_WalkNativeParamTail( encodedParamTail, () => undefined, ( token ) => unknownTokens.push( token ) );
	return unknownTokens;
}

/*
================
SkillPane_DecodeNativeParamBlocks
================
*/
function SkillPane_DecodeNativeParamBlocks(
	encodedParamTail: number[]
): Array<{ offset: number; tag: number; values: number[] }> {
	const blocks: Array<{ offset: number; tag: number; values: number[] }> = [];
	SkillPane_WalkNativeParamTail( encodedParamTail, ( block ) => blocks.push( block ), () => undefined );
	return blocks;
}

/*
================
SkillPane_DecodeSkillRow

One projected skilldata row (buildSkillDataAsset.mjs column order) -> the
pane view. The icon column is icon-root relative and the native parse
lowercases it (sub_811890 flag 1 @0x7f97e2), so the decode roots and
lowercases it the same way; the "xxx" placeholder decodes to "".
================
*/
function SkillPane_DecodeSkillRow( line: string ): SkillTooltipRowView | null {
	const	cols = line.split( "\t" );

	if ( cols.length < 35 ) {
		return null;
	}

	const	id = Number( cols[0] );
	const	groupId = Number( cols[1] );

	if ( !Number.isFinite( id ) || !Number.isFinite( groupId ) ) {
		return null;
	}

	
	// v8 appends target-required after the unchanged 49-dword native tail;
	// keep the decoder's [Param2, Param50] boundary half-open and exact.
	const	encodedParamTail = cols.slice( 29, 78 ).map( ( value ) => Number( value ) | 0 );
	const	nativeParamBlocks = SkillPane_DecodeNativeParamBlocks( encodedParamTail );
	/*
	================
	readNativeBlock
	================
	*/
	const	readNativeBlock = ( offset: number ): number[] | null => {
		for ( let index = nativeParamBlocks.length - 1; index >= 0; index -= 1 ) {
			if ( nativeParamBlocks[index]!.offset === offset ) {
				return nativeParamBlocks[index]!.values;
			}
		}
		return null;
	};
	const	attackBlock = readNativeBlock( 0x004 );
	const	durationBlock = readNativeBlock( 0x054 );
	const	multiBlock = readNativeBlock( 0x05c );
	const	downAttackBlock = readNativeBlock( 0x014 );
	const	criticalBlock = readNativeBlock( 0x018 );
	// sub_7f9bd0 reads tnt2/+0x198. `tant` decodes to the distinct runtime
	// slot +0x194 and must never manufacture a visible taunt row.
	const	tauntBlock = readNativeBlock( 0x198 );
	const	knockoutBlock = readNativeBlock( 0x010 );
	const	rangeIncreaseBlock = readNativeBlock( 0x028 );
	const	knockbackBlock = readNativeBlock( 0x02c );
	const	defenseBlock = readNativeBlock( 0x034 );
	const	recoveryBlock = readNativeBlock( 0x100 );
	const	areas = [ 0x060, 0x064, 0x068 ].flatMap( ( offset ) => {
		const block = readNativeBlock( offset );

		return block ? [ {
			gate: block[0] ?? 0,
			kind: block[1] ?? 0,
			radiusDeci: block[2] ?? 0,
			targetCount: block[3] ?? 0,
			pierceDecrease: block[4] ?? 0,
			reserved: block[5] ?? 0
		} ] : [];
	} );
	const	area = areas.find( ( candidate ) => candidate.gate === 1 ) ?? null;
	const	setValueBlocks = nativeParamBlocks
		.filter( ( block ) => block.offset >= 0x15c && block.offset <= 0x16c )
		.sort( ( left, right ) => left.offset - right.offset )
		.map( ( block ) => block.values );

	return {
		id: id >>> 0,
		groupId: groupId >>> 0,
		basicLevel: Number( cols[2] ) >>> 0,
		basicActivity: Number( cols[3] ) >>> 0,
		masteryId: Number( cols[4] ) >>> 0,
		reqMasteryLevel: Number( cols[5] ) >>> 0,
		reqStr: Number( cols[6] ) >>> 0,
		reqInt: Number( cols[7] ) >>> 0,
		reqGroups: [
			{ groupId: Number( cols[8] ) >>> 0, level: Number( cols[11] ) >>> 0 },
			{ groupId: Number( cols[9] ) >>> 0, level: Number( cols[12] ) >>> 0 },
			{ groupId: Number( cols[10] ) >>> 0, level: Number( cols[13] ) >>> 0 }
		],
		reqLearnSp: Number( cols[14] ) >>> 0,




		nameSymbol: cols[19]?.trim() ?? "",
		chainNextSkillId: Number( cols[20] ) >>> 0,
		// v8 appends this field after the unchanged v7 parameter tail. Old test
		// fixtures omit it and correctly decode the native false/zero default.

		requiredWeaponKinds: [ Number( cols[21] ) >>> 0, Number( cols[22] ) >>> 0 ],
		requiredHp: Number( cols[23] ) | 0,
		requiredMp: Number( cols[24] ) | 0,
		requiredHpRatio: Number( cols[25] ) & 0xffff,
		requiredMpRatio: Number( cols[26] ) & 0xffff,
		tooltipDescriptionSymbol: cols[27]?.trim() === "xxx" ? "" : cols[27]?.trim() ?? "",
		studySymbol: cols[28]?.trim() === "xxx" ? "" : cols[28]?.trim() ?? "",

		directTooltipParams: {
			nativeParamBlocks,
			durationMs: durationBlock ? durationBlock[0]! >>> 0 : null,
			// sub_84b2f0's `mc` block is kind 2; the V1.150 server-side table
			// scan independently pins the same [tag, 2, count] shape.
			multiCount: multiBlock?.[0] === 2 && ( multiBlock[1] ?? 0 ) > 0
				? multiBlock[1]! >>> 0
				: null,
			downAttackRatio: downAttackBlock ? downAttackBlock[0]! | 0 : null,
			criticalFlat: criticalBlock?.[0] ?? 0,
			criticalRatio: criticalBlock?.[1] ?? 0,
			tauntFlat: tauntBlock?.[0] ?? 0,
			tauntRatio: tauntBlock?.[1] ?? 0,
			knockout: knockoutBlock ? {
				level: knockoutBlock[0] ?? 0,
				chance: knockoutBlock[1] ?? 0
			} : null,
			rangeIncreaseDeci: rangeIncreaseBlock ? rangeIncreaseBlock[0] ?? 0 : null,
			knockback: knockbackBlock ? {
				chance: knockbackBlock[0] ?? 0,
				distance: knockbackBlock[1] ?? 0
			} : null,
			defense: defenseBlock ? {
				physical: defenseBlock[0] ?? 0,
				magical: defenseBlock[1] ?? 0,
				applyLimit: defenseBlock[2] ?? 0
			} : null,
			recovery: recoveryBlock ? {
				hpFlat: recoveryBlock[0] ?? 0,
				hpRatio: recoveryBlock[1] ?? 0,
				mpFlat: recoveryBlock[2] ?? 0,
				mpRatio: recoveryBlock[3] ?? 0
			} : null,
			setValues: setValueBlocks.slice( 0, 5 ).map( ( block ) => ( {
				code: block[0] ?? 0,
				value: block[1] ?? 0
			} ) ),
			area,
			areas
		},
		attack: {
			present: attackBlock !== null,
			flags: ( attackBlock?.[0] ?? 0 ) >>> 0,
			percent: attackBlock?.[1] ?? 0,
			minimum: attackBlock?.[2] ?? 0,
			maximum: attackBlock?.[3] ?? 0,
			value5: attackBlock?.[4] ?? 0
		}
	};
}




 const raw=value as {format?:unknown;columns?:unknown;rows?:unknown};
 const columns=[1,2,7,8,34,36,38,39,40,41,42,43,44,45,46,57,59,60,61,62,9,50,51,52,53,54,55,64,65,...Array.from({length:49},(_,i)=>69+i),22];
 if(raw?.format!=='sro-skilldata'||!Array.isArray(raw.rows)||raw.rows.length>65536||JSON.stringify(raw.columns)!==JSON.stringify(columns))throw Error('Invalid tooltip skill catalogue');
 const result=new Map<number,SkillTooltipRowView>();
 for(const line of raw.rows){
  if(typeof line!=='string'||line.length>16384)throw Error('Invalid tooltip skill row');
  const cells=line.split('\t');
  if(cells.length!==columns.length||cells.some((c,i)=>![18,19,27,28].includes(i)&&(!/^-?\d+$/.test(c)||!Number.isSafeInteger(Number(c)))))throw Error('Invalid tooltip skill scalar');
  const row=SkillPane_DecodeSkillRow(line);
  if(!row||!row.id||result.has(row.id))throw Error('Duplicate tooltip skill');
  result.set(row.id,row);
 }
 for(const row of result.values())if(row.chainNextSkillId&&!result.has(row.chainNextSkillId))throw Error('Missing tooltip chain reference');
 const children=new Set([...result.values()].map(row=>row.chainNextSkillId)),groups=new Map<string,SkillTooltipRowView>();
 for(const row of result.values()){const key=row.groupId+':'+row.basicLevel;if(!children.has(row.id)&&!groups.has(key))groups.set(key,row);}
 return Object.assign(result,{groups});
}
