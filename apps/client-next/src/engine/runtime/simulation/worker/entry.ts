import { createSimulation } from "./simulation";
import type { HostMessage, WorkerMessage } from "@/engine/contracts/simulation";
const port = globalThis as unknown as {
    onmessage: ((event: MessageEvent<HostMessage>) => void) | null;
    postMessage(message: WorkerMessage, transfer: Transferable[]): void;
};
const simulation = createSimulation(function sendToHost(message, transfer) { port.postMessage(message, transfer); });
port.onmessage = event => simulation.receive(event.data);
