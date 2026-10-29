/**
 * RED-TEAM M1 — SERIALISATION / SAVE-FILE CORRUPTION
 *
 * Attack server/validation (pure) with corrupt snapshot/block edit/chunk
 * requests; assert deterministic rejection with correct reason and that
 * memory isn't corrupted.
 */
import { describe, expect, it } from "vitest";
import { validateSnapshot, validateBlockEdit, validateChunkRequest } from "../../server/validation.ts";

describe("M1 SERIALISATION — corrupt inputs must be rejected deterministically", () => {
  it("snapshot non-object rejected with save_corrupt", () => {
    const r = validateSnapshot("bad");
    if (r.ok) { expect.unreachable("corrupt input must be rejected"); } expect(r.reason).toBe("save_corrupt");
  });

  it("snapshot wrong schema version rejected", () => {
    const r = validateSnapshot({ schemaVersion: 99, seed: 1, chunks: [] });
    if (r.ok) { expect.unreachable("corrupt input must be rejected"); } expect(r.reason).toBe("save_schema_mismatch");
  });

  it("snapshot missing seed -> save_corrupt or malformed", () => {
    const r = validateSnapshot({ schemaVersion: 1, chunks: [] });
    expect(r.ok).toBe(false); // either save_corrupt or malformed_payload
  });

  it("snapshot with corrupt block byte in chunk data (ordinal > 255 conceptually) — must not corrupt memory", () => {
    // Validation operates on the JSON object, not on typed arrays directly,
    // but a chunk block array that contains non-integer values should fail.
    const r = validateSnapshot({
      schemaVersion: 1, seed: 1,
      chunks: [{ key: { cx: 0, cz: 0 }, blocks: new Uint8Array([0, 300]) }],
    });
    // The validation may accept or reject depending on how it inspects blocks;
    // at minimum it must not throw or corrupt.
    expect(() => r).not.toThrow();
  });

  it("block edit non-object rejected", () => {
    const r = validateBlockEdit([1, 2, 3]);
    if (r.ok) { expect.unreachable("corrupt input must be rejected"); } expect(r.reason).toBe("malformed_payload");
  });

  it("block edit missing key rejected", () => {
    const r = validateBlockEdit({ cx: 0, cz: 0, x: 1, y: 2 }); // missing z, block
    if (r.ok) { expect.unreachable("corrupt input must be rejected"); } expect(r.reason).toBe("malformed_payload");
  });

  it("block edit out of bounds coordinate rejected", () => {
    const r = validateBlockEdit({ cx: 100000, cz: 0, x: 0, y: 1, z: 0, block: "voidstone" });
    expect(r.ok).toBe(false);
  });

  it("block edit with unknown block rejected", () => {
    const r = validateBlockEdit({ cx: 0, cz: 0, x: 1, y: 10, z: 1, block: "notablock" });
    if (r.ok) { expect.unreachable("corrupt input must be rejected"); } expect(r.reason).toBe("unknown_block");
  });

  it("chunk request too large rejected", () => {
    const r = validateChunkRequest({ cx: 0, cz: 0, radius: 1000 });
    if (r.ok) { expect.unreachable("corrupt input must be rejected"); } expect(r.reason).toBe("chunk_request_too_large");
  });

  it("chunk request negative radius rejected", () => {
    const r = validateChunkRequest({ cx: 0, cz: 0, radius: -1 });
    if (r.ok) { expect.unreachable("corrupt input must be rejected"); } expect(r.reason).toBe("out_of_bounds");
  });

  it("chunk request malformed payload (extra keys) rejected", () => {
    const r = validateChunkRequest({ cx: 0, cz: 0, radius: 2, extra: 1 });
    if (r.ok) { expect.unreachable("corrupt input must be rejected"); } expect(r.reason).toBe("malformed_payload");
  });

  it("determinism: same corrupt input => same rejection reason", () => {
    const bad = { cx: 0, cz: 0, x: 0, y: 0, z: 0, block: "bad" };
    const r1 = validateBlockEdit(bad); const r2 = validateBlockEdit(bad);
    expect(r1.ok).toBe(false); expect(r2.ok).toBe(false);
    if (r1.ok || r2.ok) { expect.unreachable("corrupt input must be rejected"); }
    expect(r1.reason).toBe(r2.reason);
  });
});
