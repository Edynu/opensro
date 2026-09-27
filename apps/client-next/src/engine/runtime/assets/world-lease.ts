import type {PreparedWorldScene,WorldSceneLease} from '@/engine/contracts/world-admission';

// Only the asset message owner calls this after receiving the isolated worker
// publication. A consumed lease retains no scene and cannot be replayed.
export function createWorldLease(prepared: PreparedWorldScene): WorldSceneLease {
    let pending: PreparedWorldScene | null = prepared;
    function takeWorld(): PreparedWorldScene {
        if (!pending) throw new Error('World scene lease already consumed');
        const result = pending; pending = null; return result;
    }
    return Object.freeze({sceneId:prepared.scene.id,takeWorld});
}
