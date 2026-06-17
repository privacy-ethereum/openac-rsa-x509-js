// Browser entry point — re-exports wasm-bindgen symbols directly.
// Vite selects this via the "browser" exports condition instead of index.mjs,
// avoiding the node:fs / node:url APIs that don't exist in the browser.
//
// init() here is the wasm-bindgen default initialiser; it accepts a URL,
// Response, or nothing (auto-derives the .wasm URL from import.meta.url).
export {
  default as init,
  CircuitKind,
  initThreadPool,
  load_pk,
  prove,
  verify,
  build_split_inputs,
  cert_modulus_bits,
  cert_serial_hex,
  link_verify,
  wasm_init,
} from "./wasm/spartan2_wasm.js";
