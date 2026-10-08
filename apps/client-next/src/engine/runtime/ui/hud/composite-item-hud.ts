/*
===========================================================================

composite-item-hud.ts - a premium package's window of limited uses

CIFCompositeItemWnd (GDR_COMPOSITE_ITEM, window 0x24) opens when the
player clicks a package's slot on the magic-state board (6E2840, slot
kind 5, through 69F0F0). 6AF780 fills it for that package: one
sys_button per limited item, labelled "%s(%d)" with the item name and its
uses left and disabled at zero, then a cancel button, and it grows the
frame, the background tile and the window to the button count. A button
(6AFB40) runs its row and closes the window; so do cancel, the close
button and Escape (69F450).

The window owns only which package is open; the rows come from the
gameplay state every frame, so a package whose rows end closes it.

===========================================================================
*/
import type { UiRect } from "@/engine/contracts/ui";

// 6AF780: buttons at bounds + (0x1F, 0x3A), 150 x 25, 0x22 apart.
const BUTTON_LEFT = 0x1f;
const BUTTON_TOP = 0x3a;
const BUTTON_WIDTH = 0x96;
const BUTTON_HEIGHT = 0x19;
const BUTTON_PITCH = 0x22;
// Per button, the background tile grows 0x14, the frame 0x22 and the
// window 0x24, from 0, 0x0F and 0x46.
const TILE_STEP = 0x14;
const FRAME_BASE = 0x0f;
const FRAME_STEP = 0x22;
const WINDOW_BASE = 0x46;
const WINDOW_STEP = 0x24;

/*
================
CompositeItemLayout

Rects relative to the window's top left. width and the frame and tile
x/width come from the authored layout; 6AF780 changes only heights.
================
*/
export interface CompositeItemLayout {
	readonly height: number;
	readonly frameHeight: number;
	readonly tileHeight: number;
	readonly buttons: readonly UiRect[];
}

/*
================
compositeItemLayout

The geometry for a package with rows limited items (rows + 1 buttons).
================
*/
export function compositeItemLayout( rows: number ): CompositeItemLayout {
	const count = rows + 1;
	return {
		height: WINDOW_BASE + WINDOW_STEP * count,
		frameHeight: FRAME_BASE + FRAME_STEP * count,
		tileHeight: TILE_STEP * count,
		buttons: Array.from(
			{ length: count },
			( _, i ) => [ BUTTON_LEFT, BUTTON_TOP + i * BUTTON_PITCH, BUTTON_WIDTH, BUTTON_HEIGHT ] as UiRect
		)
	};
}

/*
================
compositeItemCaption

6AF780's "%s(%d)": the item name and its uses left.
================
*/
export function compositeItemCaption( name: string, uses: number ): string {
	return name + "(" + uses + ")";
}

/*
================
createCompositeItemHud
================
*/
export function createCompositeItemHud() {
	let open: number | null = null;
	return {
		/*
		================
		open

		The board slot's package; a second click on another package
		refills the same window (6AF780 runs again).
		================
		*/
		open( packageRefObjId: number ) {
			open = packageRefObjId;
		},
		/*
		================
		close
		================
		*/
		close() {
			open = null;
		},
		/*
		================
		packageId
		================
		*/
		packageId(): number | null {
			return open;
		}
	};
}
