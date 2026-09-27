import { createLoader } from "./loader";
import type { AssetRequest, AssetWorkerMessage } from "@/engine/contracts/assets";
const port = globalThis as unknown as {
    onmessage: ((event: MessageEvent<AssetRequest>) => void) | null;
    postMessage(message: AssetWorkerMessage, transfer: Transferable[]): void;
};
const loader = createLoader(function sendToHost(message, transfer) { port.postMessage(message, transfer); });
port.onmessage = event => loader.receive(event.data);
