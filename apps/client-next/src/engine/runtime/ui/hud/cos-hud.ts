/*
===========================================================================

cos-hud.ts - the COS HUD's state: selected companion, bar and Clean prompt

CIFCOSManager shares one status icon across guild soldiers; other companions
have individual status icons. The worker publishes their bindings and selected
GID. The HUD owns one command panel, shown for the selected companion (CIFCOSManager_SelectCompanion
6F21F0). This module mirrors selection and owns the panel's open/close toggle
(CIFCOSCommand_OnToggleOpen 6A3750) and the transport Clean confirmation
the executor raises (6A2350 case 5). The UI draws from it every frame.

===========================================================================
*/
import type { GameplayCommand, InventoryItem, CosRecord } from "@/engine/contracts/gameplay";
import { cosClass } from "@/engine/foundation/ui/cos-command";

const COMPANION_LEASE_CURSOR = 0xa6;

/*
================
createCosHud
================
*/
export function createCosHud() {
	let selected = 0, open = true, cleanConfirm: number | null = null;
	let clock: InventoryItem | null = null, renewal: GameplayCommand | null = null;
	return {
		/*
		================
		armClock

		561D50 stores the selected inventory slot (596B50), then sets cursor A6
		at 5621D4. Arming never sends item use or chooses a pet automatically.
		================
		*/
		armClock( item: InventoryItem ) {
			clock = item;
			renewal = null;
		},
		/*
		================
		clockCursor
		================
		*/
		clockCursor(): 0xa6 | null {
			return clock && !renewal ? COMPANION_LEASE_CURSOR : null;
		},
		/*
		================
		chooseClockTarget

		567372 checks cursor A6: any occupied inventory or equipment slot opens
		the type-1F confirmation (5673A7) and clears the cursor. On confirmation,
		the worker applies the client's target checks from 6968BA before sending.
		================
		*/
		chooseClockTarget( item: InventoryItem | undefined ) {
			if ( !clock || !item || renewal ) return false;
			renewal = { kind: "item-use", slot: clock.slot, summonerSlot: item.slot };
			return true;
		},
		/*
		================
		renewal
		================
		*/
		renewal() {
			return renewal;
		},
		/*
		================
		takeRenewal
		================
		*/
		takeRenewal() {
			const command = renewal;
			clock = null;
			renewal = null;
			return command;
		},
		/*
		================
		reconcileClock

		The native cursor is global: hotbar use can arm it with inventory closed.
		A changed source slot or departure from the world cancels the selection.
		================
		*/
		reconcileClock( items: readonly InventoryItem[], visible: boolean ) {
			const source = clock;
			if (
				!source ||
				visible && items.some( item =>
						item.slot === source.slot && item.refObjId === source.refObjId &&
						item.typeFlags === source.typeFlags && item.quantity > 0
					)
			) return false;
			clock = null;
			renewal = null;
			return true;
		},

		/*
		================
		reconcile

		The manager selects a newly added companion (CIFCOSManager_AddCompanion
		6F2710 calls SelectCompanion) and falls back to the first remaining one
		when the selected companion is removed (6F2900). Returns whether the
		state changed.
		================
		*/
		reconcile( records: readonly CosRecord[], selectedGid?: number ) {
			const shown = records.filter( r => cosClass( r.band ) !== null );
			let changed = selectedGid !== undefined && selected !== selectedGid;
			if ( selectedGid !== undefined ) selected = selectedGid;
			if ( selectedGid === undefined && !shown.some( r => r.gid === selected ) ) {
				const next = shown.at( -1 )?.gid ?? 0;
				changed = next !== selected;
				selected = next;
			}
			if ( cleanConfirm !== null && !shown.some( r => r.gid === cleanConfirm ) ) {
				cleanConfirm = null;
				changed = true;
			}
			return changed;
		},
		/*
================
reset
================
		*/
		reset() {
			selected = 0;
			open = true;
			cleanConfirm = null;
			clock = null;
			renewal = null;
		},
		/*
================
select
================
		*/
		select( gid: number ) {
			selected = gid;
		},
		/*
================
selected
================
		*/
		selected() {
			return selected;
		},
		/*
================
toggle
================
		*/
		toggle() {
			open = !open;
		},
		/*
================
open
================
		*/
		open() {
			return open;
		},
		/*
================
askClean
================
		*/
		askClean( gid: number ) {
			cleanConfirm = gid;
		},
		/*
================
cleanConfirm
================
		*/
		cleanConfirm() {
			return cleanConfirm;
		},
		/*
================
takeClean
================
		*/
		takeClean() {
			const gid = cleanConfirm;
			cleanConfirm = null;
			return gid;
		}
	};
}
