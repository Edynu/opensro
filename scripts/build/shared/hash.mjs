import { createHash } from "node:crypto";

/** One-shot SHA-256 used by generated-asset manifests and content-addressed outputs. */
export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
