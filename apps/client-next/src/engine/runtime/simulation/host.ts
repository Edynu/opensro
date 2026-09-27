import type { SessionState } from "@/engine/contracts/session";
import { PROTOCOL_VERSION, readSnapshot } from "@/engine/contracts/simulation";
import type { WorkerMessage, HostMessage } from "@/engine/contracts/simulation";
import type { SimulationHost, SimulationObservation } from "@/engine/contracts/runtime";
export function createSimulationHost(): SimulationHost {
    const worker = new Worker(new URL("./worker/entry.ts", import.meta.url), { type: "module", name: "sro-simulation" });
    let disposed = false, failure: string | null = null, pending: ArrayBuffer | null = null, sequence = 0;
    let worldBatch:import("@/engine/contracts/world").WorldBatch|null=null,worldSequence=0;
    let sessionState: SessionState | null = null;
    let lastInputSent = 0, lastInputAccepted = 0;
    let receivedAtMs=0, clock:import("@/engine/contracts/runtime").ClockSample|undefined;
    const send = (message: HostMessage, transfer: Transferable[] = []) => worker.postMessage(message, transfer);
    const recycle = (buffer: ArrayBuffer) => send({ kind: "recycle", buffer }, [buffer]);
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        if (disposed)
            return;
        if(event.data.kind==="world"){
            if(worldBatch||event.data.batch.sequence!==worldSequence+1){failure="World journal delivery sequence violation";return;}
            worldBatch=event.data.batch;return;
        }
        if (event.data.kind === "failure") {
            failure = event.data.message;
            return;
        }
        if (event.data.kind === "session") {
            sessionState = event.data.state;
            return;
        }
        if (pending)
            recycle(pending);
        pending = event.data.buffer;
        clock=event.data.clock;
        receivedAtMs=performance.timeOrigin+performance.now();
    };
    worker.onerror = event => { failure = event.message; };
    worker.onmessageerror = () => { failure = "Simulation message could not be decoded"; };
    send({ kind: "start", version: PROTOCOL_VERSION });
    return {
        pollWorld:()=>worldBatch,
        ackWorld(sequence){if(!worldBatch||worldBatch.sequence!==sequence)throw new Error("World journal acknowledgement mismatch");worldSequence=sequence;worldBatch=null;send({kind:"world-ack",sequence});},
        session(command) { if (!disposed && !failure)
            send({ kind: "session", command }); },
        pollSession() { const result = sessionState; sessionState = null; return result; },
        sendInput(batch) {
            if (disposed || failure)
                return;
            if (batch.first !== lastInputSent + 1 || batch.last - lastInputAccepted > 2048) {
                failure = "Simulation input backlog or sequence violation";
                return;
            }
            lastInputSent = batch.last;
            send({ kind: "input", batch });
        },
        poll(): SimulationObservation | null {
            if (!pending || disposed)
                return null;
            const buffer = pending;
            pending = null;
            try {
                const data = readSnapshot(buffer);
                if (data.sequence <= sequence)
                    return null;
                if (data.acceptedInputSequence < lastInputAccepted || data.acceptedInputSequence > lastInputSent)
                    throw new Error("Invalid input acknowledgement");
                lastInputAccepted = data.acceptedInputSequence;
                sequence = data.sequence;
                return { ...data, ...(clock?{clock}:{}), receivedAtMs, appliedAtMs:performance.timeOrigin+performance.now() };
            }
            catch (error) {
                failure = String(error);
                return null;
            }
            finally {
                recycle(buffer);
            }
        },
        error: () => failure,
        dispose() {
            if (disposed)
                return;
            disposed = true;
            pending = null;
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
            worker.terminate();
        }
    };
}
