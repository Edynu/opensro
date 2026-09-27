import { trainingTransition, type TrainingState } from '@/engine/foundation/gameplay/training';
import type { WireFrame } from '@/engine/contracts/network';
// Unnumbered acknowledgements cannot safely authorize automatic retry after timeout.
export function createTraining(send: (frame: WireFrame) => void) {
    let state: TrainingState = { phase: 'idle' };
    return {
        request(frame: WireFrame, id: number, now: number) { const next = trainingTransition(state, { type: 'sent', opcode: frame.opcode === 0x72cb ? 0xb2cb : 0xb165, id, now }); send(frame); state = next; return frame; },
        receipt(opcode: number, id?: number) { state = trainingTransition(state, { type: 'receipt', opcode, id }); },
        step(now: number) { const next = trainingTransition(state, { type: 'tick', now }); if (next === state)
            return false; state = next; return true; },
        state() { return { trainingPending: state.phase !== 'idle', trainingError: state.phase === 'uncertain' ? 'Training result is unknown. Reconnect before trying again.' : null }; },
        reset() { state = trainingTransition(state, { type: 'reset' }); }, dispose() { state = { phase: 'idle' }; }
    };
}
