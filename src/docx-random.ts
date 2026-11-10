// html-to-docx 1.8.0 uses only crypto.randomFillSync(buffer) for image relationship IDs.
// Vite browser adapter, not a general Node crypto implementation.
export function randomFillSync<T extends Uint8Array>(buffer:T):T {
  for(let offset=0;offset<buffer.byteLength;offset+=65536) globalThis.crypto.getRandomValues(buffer.subarray(offset,offset+65536));
  return buffer;
}
export default {randomFillSync};
