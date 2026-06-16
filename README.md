# openac-rsa-x509-js

Node.js bindings for proving and verifying RSA X.509 certificate chains with the OpenAC Spartan2 circuits.

## Introduction

This package wraps the wasm bindings built from the
[`RSA-X.509-Cert`](https://github.com/privacy-ethereum/zkID/tree/RSA-X.509-Cert)
branch of [zkID](https://github.com/privacy-ethereum/zkID), exposing
`prove` / `verify` / `load_pk` and related circuit helpers to Node.js.

## Installation

```sh
npm add https://github.com/privacy-ethereum/openac-rsa-x509-js
```

or add it directly to `package.json`:

```json
{
  "dependencies": {
    "openac-rsa-x509": "github:privacy-ethereum/openac-rsa-x509-js"
  }
}
```

After installing, fetch the wasm assets (witness calculators + the
spartan2 wasm module) and, if you intend to prove/verify, the proving and
verifying keys:

```sh
npx --package=openac-rsa-x509 -- node node_modules/openac-rsa-x509/scripts/fetch-assets.mjs
npx --package=openac-rsa-x509 -- node node_modules/openac-rsa-x509/scripts/fetch-proving-keys.mjs
```

(When developing inside this repo, use `npm run fetch:assets` and
`npm run fetch:keys` instead.)

## Usage

```js
import { init, load_pk, prove, verify, CircuitKind } from 'openac-rsa-x509';

await init();

// Load the proving key for the circuit you're using.
const pkBytes = await readFile('cert_chain_rs2048_proving.key');
await load_pk(CircuitKind.CertChainRs2048, pkBytes);

// witnessBytes is a `.wtns` binary produced by the matching Circom witness
// calculator (see assets/witness_calculator.js) for your circuit inputs.
const { proof, public_values } = await prove(CircuitKind.CertChainRs2048, witnessBytes);

// Verify with the matching verifying key.
const vkBytes = await readFile('cert_chain_rs2048_verifying.key');
const { valid } = await verify(new Uint8Array(proof), vkBytes);
```

`CircuitKind` has three variants: `CertChainRs2048`, `CertChainRs4096`, and
`UserSigRs2048`. See `test/` for full end-to-end examples (witness
generation → prove → verify) for each circuit.

### Other exports

- `build_split_inputs(...)` — build split circuit inputs from raw cert /
  signature material.
- `cert_modulus_bits(certDer)` — RSA modulus bit width of a DER-encoded cert.
- `cert_serial_hex(certDer)` — trimmed-hex serial of a DER-encoded cert.
- `link_verify(certPubs, userSigPubs)` — assert `pk_commit` equality between
  a cert-chain proof's public values and a user-sig proof's public values.

All functions other than `init()` require `init()` to have been called
first.

## Development

```sh
git clone https://github.com/privacy-ethereum/openac-rsa-x509-js
cd openac-rsa-x509-js
npm install
npm run fetch:assets
npm run fetch:keys
npm test
```
