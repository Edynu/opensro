/**
 * Shared Alpha-envelope primitives for Node-side transport probes.
 *
 * Keep raw probes on the same HELLO wire contract as GoTransportSession:
 * protocol v2, no resume token for a fresh probe, and one authenticated
 * admission ticket. Centralizing this prevents a diagnostic from silently
 * falling behind the live transport protocol.
 */
export const PROBE_ALPHA_PROTOCOL_VERSION = 2;

export function encodeProbeAlphaFrame(opcode, payload = new Uint8Array()) {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const frame = new Uint8Array(2 + bytes.byteLength);
  new DataView(frame.buffer).setUint16(0, opcode, true);
  frame.set(bytes, 2);
  return frame;
}

export function decodeProbeAlphaFrame(bytes) {
  const frame = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (frame.byteLength < 2) {
    throw new Error(`Alpha frame is only ${frame.byteLength} byte(s)`);
  }
  return {
    opcode: new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint16(0, true),
    payload: frame.slice(2)
  };
}

export function encodeProbeAlphaHello(admissionTicket) {
  const ticket = new TextEncoder().encode(admissionTicket);
  if (ticket.byteLength === 0 || ticket.byteLength > 512) {
    throw new Error(`transport admission ticket has invalid length ${ticket.byteLength}`);
  }
  const payload = new Uint8Array(4 + ticket.byteLength);
  payload[0] = PROBE_ALPHA_PROTOCOL_VERSION;
  payload[1] = 0; // fresh session: zero-length resume token
  new DataView(payload.buffer).setUint16(2, ticket.byteLength, true);
  payload.set(ticket, 4);
  return payload;
}

export function encodeProbeLengthPrefixedUtf8(...values) {
  const encoder = new TextEncoder();
  const encoded = values.map((value) => encoder.encode(value));
  const byteLength = encoded.reduce((total, value) => total + 2 + value.byteLength, 0);
  const payload = new Uint8Array(byteLength);
  const view = new DataView(payload.buffer);
  let offset = 0;

  for (const value of encoded) {
    if (value.byteLength > 0xffff) {
      throw new Error("length-prefixed field exceeds u16");
    }
    view.setUint16(offset, value.byteLength, true);
    offset += 2;
    payload.set(value, offset);
    offset += value.byteLength;
  }
  return payload;
}
