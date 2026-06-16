import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { init, load_pk, prove, verify, CircuitKind } from "openac-rsa-x509";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, "..", "assets");
const _require = createRequire(import.meta.url);

const inputJson = JSON.parse(
  await readFile(join(HERE, "fixtures", "user_sig_rs2048_input.json"), "utf8"),
);

test("userSigRS2048: spartan2 wasm module initializes", async () => {
  await init();
});

async function calculateWtns() {
  const wasmBytes = await readFile(join(ASSETS, "user_sig_rs2048.wasm"));
  const builder = _require("../assets/witness_calculator.js");
  const calc = await builder(wasmBytes.buffer);
  return calc.calculateWTNSBin(inputJson, false);
}

test("userSigRS2048: witness generation produces valid wtns bytes", async () => {
  const wtns = await calculateWtns();

  assert.ok(wtns instanceof Uint8Array, "output is Uint8Array");
  assert.ok(wtns.length > 12, "output has more than header bytes");
  assert.equal(
    String.fromCharCode(wtns[0], wtns[1], wtns[2], wtns[3]),
    "wtns",
    'first 4 bytes are the "wtns" magic',
  );
  // version field (bytes 4-7, little-endian) must be 2
  const version = wtns[4] | (wtns[5] << 8) | (wtns[6] << 16) | (wtns[7] << 24);
  assert.equal(version, 2, "wtns version is 2");
});

// Shared across the prove/verify tests below so verify doesn't redo proving.
let proveResult;

test("userSigRS2048: prove returns a proof and public values", { timeout: 10 * 60 * 1000 }, async () => {
  const pkBytes = await readFile(join(ASSETS, "user_sig_rs2048_proving.key"));
  await load_pk(CircuitKind.UserSigRs2048, pkBytes);

  const wtns = await calculateWtns();
  proveResult = await prove(CircuitKind.UserSigRs2048, wtns);

  // prove() returns { proof: number[], instance: number[], public_values: string[] }
  // (worker.ts wraps proof in new Uint8Array(certProofOut.proof))
  assert.ok(Array.isArray(proveResult.proof), "proof is an Array");
  assert.ok(proveResult.proof.length > 0, "proof is non-empty");
  assert.ok(Array.isArray(proveResult.public_values), "public_values is array");
  assert.ok(proveResult.public_values.length > 0, "public_values is non-empty");
  // Spot-check: all public_values are hex strings
  for (const v of proveResult.public_values) {
    assert.match(v, /^0x[0-9a-f]+$/, `public value is hex: ${v}`);
  }
});

test("userSigRS2048: verify accepts the proof from prove()", { timeout: 2 * 60 * 1000 }, async () => {
  assert.ok(proveResult, "prove() must have run first");
  const vkBytes = await readFile(join(ASSETS, "user_sig_rs2048_verifying.key"));
  const proofBytes = new Uint8Array(proveResult.proof);

  const result = await verify(proofBytes, vkBytes);

  assert.equal(result.valid, true, "proof verifies");
  assert.deepEqual(
    result.public_values,
    proveResult.public_values,
    "verify's public_values match prove's",
  );
});
