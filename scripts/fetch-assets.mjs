#!/usr/bin/env node
import { execFile as execFileCb } from "node:child_process";
import { createGunzip } from "node:zlib";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, rm, stat, rename } from "node:fs/promises";
const { glob } = await import("node:fs/promises").catch(() => ({ glob: undefined }));
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const execFile = promisify(execFileCb);

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, "..");
const SRC_WASM = join(PKG_DIR, "src", "wasm");
const ASSETS = join(PKG_DIR, "assets");
const MANIFEST = join(SRC_WASM, ".fetch-manifest.json");

const RELEASE_BASE =
  process.env.ZKID_RELEASE_BASE ??
  "https://github.com/privacy-ethereum/zkID/releases/download/RSA-X.509-Cert-latest";

// Gzipped single-file assets.
const DOWNLOADS = [
  { src: "spartan2_wasm.js.gz",            out: join(SRC_WASM, "spartan2_wasm.js") },
  { src: "spartan2_wasm_bg.wasm.gz",       out: join(SRC_WASM, "spartan2_wasm_bg.wasm") },
  { src: "spartan2_wasm.d.ts.gz",          out: join(SRC_WASM, "spartan2_wasm.d.ts") },
  { src: "spartan2_wasm_bg.wasm.d.ts.gz",  out: join(SRC_WASM, "spartan2_wasm_bg.wasm.d.ts") },
  { src: "certChainRS2048.wasm.gz",        out: join(ASSETS, "cert_chain_rs2048.wasm") },
  { src: "certChainRS4096.wasm.gz",        out: join(ASSETS, "cert_chain_rs4096.wasm") },
  { src: "userSigRS2048.wasm.gz",          out: join(ASSETS, "user_sig_rs2048.wasm") },
  { src: "witness_calculator.js.gz",       out: join(ASSETS, "witness_calculator.js") },
];

// tar.gz bundles extracted into `outDir`.
const TARBALLS = [
  { src: "snippets.tar.gz", outDir: SRC_WASM },
];

// Tiny stubs so wasm-bindgen ESM surface resolves in Node.js.
const STUBS = [
  { out: join(SRC_WASM, "package.json"), body: `{ "type": "module" }\n` },
  {
    out: join(SRC_WASM, "index.js"),
    body: `export { default } from "./spartan2_wasm.js";\nexport * from "./spartan2_wasm.js";\n`,
  },
];

// Replaces the browser-only wasm-bindgen-rayon helper with a Node.js stub so
// `spartan2_wasm.js` can be imported without browser Worker APIs.  The real
// startWorkers is never called because we never invoke initThreadPool() in Node.
const NODE_WORKER_HELPERS = `\
// Node.js stub for wasm-bindgen-rayon workerHelpers.
// startWorkers is wired into the wasm import object but is only invoked when
// initThreadPool() is called.  We do not call initThreadPool() in Node.js, so
// this is safe to leave unimplemented.
export function startWorkers(_module, _memory, _builder) {
  return Promise.reject(
    new Error("startWorkers: thread pool is not supported in Node.js; do not call initThreadPool()"),
  );
}
`;

async function loadManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST, "utf8"));
  } catch {
    return {};
  }
}

async function saveManifest(manifest) {
  await mkdir(dirname(MANIFEST), { recursive: true });
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function fetchToFile(url, outPath, { gunzip }) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  await mkdir(dirname(outPath), { recursive: true });
  const tmpPath = `${outPath}.partial`;
  const steps = [Readable.fromWeb(res.body)];
  if (gunzip) steps.push(createGunzip());
  steps.push(createWriteStream(tmpPath));
  await pipeline(...steps);
  await rename(tmpPath, outPath);
  return {
    etag: res.headers.get("etag") ?? "",
    len: res.headers.get("content-length") ?? "",
  };
}

async function headMeta(url) {
  const res = await fetch(url, { method: "HEAD", redirect: "follow" });
  return {
    etag: res.headers.get("etag") ?? "",
    len: res.headers.get("content-length") ?? "",
  };
}

async function fetchDownloads(manifest) {
  for (const { src, out } of DOWNLOADS) {
    const url = `${RELEASE_BASE}/${src}`;
    const prev = manifest[src];
    if (prev && (await fileExists(out))) {
      const head = await headMeta(url);
      if (head.etag === prev.etag && head.len === prev.len) {
        console.log(`  cached  ${src}`);
        continue;
      }
    }
    process.stdout.write(`  fetch   ${src} ... `);
    manifest[src] = await fetchToFile(url, out, { gunzip: true });
    console.log("ok");
  }
}

async function fetchTarballs(manifest) {
  for (const { src, outDir } of TARBALLS) {
    const url = `${RELEASE_BASE}/${src}`;
    const prev = manifest[src];
    const sentinel = join(outDir, ".tarball-stamp-" + src.replace(/\W+/g, "_"));
    if (prev && (await fileExists(sentinel))) {
      const head = await headMeta(url);
      if (head.etag === prev.etag && head.len === prev.len) {
        console.log(`  cached  ${src}`);
        continue;
      }
    }
    process.stdout.write(`  fetch   ${src} ... `);
    const tmp = join(outDir, `${src}.partial`);
    await mkdir(outDir, { recursive: true });
    manifest[src] = await fetchToFile(url, tmp, { gunzip: false });
    await execFile("tar", ["-xzf", tmp, "-C", outDir]);
    await rm(tmp);
    await writeFile(sentinel, manifest[src].etag || manifest[src].len || "");
    console.log("ok");
  }
}

async function writeStubs() {
  for (const { out, body } of STUBS) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, body);
  }
}

// After snippets extraction, replace the browser-only workerHelpers.js with a
// Node.js-compatible stub so spartan2_wasm.js can be imported in Node.js.
async function patchWorkerHelpers() {
  let patched = 0;
  try {
    // Node.js 22+ has fs/promises glob; fall back to find(1) on older runtimes.
    const files = [];
    if (typeof glob === "function") {
      for await (const f of glob("**/workerHelpers.js", { cwd: SRC_WASM })) {
        files.push(join(SRC_WASM, f));
      }
    } else {
      const { stdout } = await execFile("find", [
        SRC_WASM,
        "-name",
        "workerHelpers.js",
      ]);
      files.push(...stdout.trim().split("\n").filter(Boolean));
    }
    for (const f of files) {
      await writeFile(f, NODE_WORKER_HELPERS);
      patched++;
    }
  } catch {
    // No snippets yet (cached run skipped tarball) — nothing to patch.
  }
  if (patched > 0) console.log(`  patched ${patched} workerHelpers.js file(s) for Node.js`);
}

async function main() {
  console.log(`fetch-assets: source = ${RELEASE_BASE}`);
  await mkdir(SRC_WASM, { recursive: true });
  await mkdir(ASSETS, { recursive: true });
  const manifest = await loadManifest();
  await fetchDownloads(manifest);
  await fetchTarballs(manifest);
  await writeStubs();
  if (!process.env.SKIP_WORKER_HELPERS_PATCH) {
    await patchWorkerHelpers();
  }
  await saveManifest(manifest);
  console.log("fetch-assets: done");
}

main().catch((err) => {
  console.error(`fetch-assets: ${err.message}`);
  process.exit(1);
});
