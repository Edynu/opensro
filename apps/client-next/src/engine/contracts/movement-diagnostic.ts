/*
===========================================================================

movement-diagnostic.ts - movement evidence carried in ordered world batches

Worker timestamps are simulation milliseconds, not browser performance.now.
The journal records main-thread receipt time separately. Request IDs belong to
the replacement transport envelope, never to the native 0x7738 body.

===========================================================================
*/
import type { Pose } from "./gameplay";

/*
================
MovementDiagnostic
================
*/
export interface MovementDiagnostic {
	readonly kind: "movement-diagnostic";
	readonly event: "request" | "receipt" | "correction";
	readonly simulationAtMs: number;
	readonly requestId?: number;
	readonly serverTimeMs?: number;
	/** Receipt age on the simulation clock; not measured network-only RTT. */
	readonly simulationRoundTripMs?: number;
	readonly accepted?: boolean;
	readonly stale?: boolean;
	readonly target?: Pose;
	readonly serverGoal?: Pose;
	readonly serverFrom?: Pose;
	readonly serverDepartAtMs?: number;
	readonly serverArriveAtMs?: number;
	readonly before?: Pose;
	readonly after?: Pose;
	readonly heading?: number;
	readonly distance?: number;
	readonly source?: string;
}
