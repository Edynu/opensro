export type TrainingState = {
    readonly phase: 'idle';
} | {
    readonly phase: 'waiting' | 'uncertain';
    readonly opcode: number;
    readonly id: number;
    readonly deadline: number;
};
export type TrainingEvent = {
    type: 'sent';
    opcode: number;
    id: number;
    now: number;
} | {
    type: 'receipt';
    opcode: number;
    id?: number;
} | {
    type: 'tick';
    now: number;
} | {
    type: 'reset';
};
// Low-level dependency exception: the engine ownership gate forbids external packages.
// This closed reducer is domain logic, not a second general-purpose statechart library.
export function trainingTransition(state: TrainingState, event: TrainingEvent): TrainingState {
    switch (event.type) {
        case 'reset': return { phase: 'idle' };
        case 'sent':
            if (state.phase !== 'idle')
                throw Error('Training acknowledgement pending');
            return { phase: 'waiting', opcode: event.opcode, id: event.id, deadline: event.now + 10000 };
        case 'receipt': return state.phase !== 'idle' && state.opcode === event.opcode && (event.id === undefined || event.id === state.id) ? { phase: 'idle' } : state;
        case 'tick': return state.phase === 'waiting' && event.now >= state.deadline ? { ...state, phase: 'uncertain' } : state;
    }
}
