#!/usr/bin/env node
// Downloads and decompresses proving keys needed for tests.
// Run with: node scripts/fetch-proving-keys.mjs
// Skips files that are already up-to-date (ETag + content-length match).

import { createGunzip } from "node:zlib";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, stat, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, "..");
const ASSETS = join(PKG_DIR, "assets");
const MANIFEST = join(ASSETS, ".proving-keys-manifest.json");

const RELEASE_BASE =
  process.env.ZKID_RELEASE_BASE ??
  "https://github.com/privacy-ethereum/zkID/releases/download/RSA-X.509-Cert-latest";

const PROVING_KEYS = [
  {
    src: "cert_chain_rs2048_proving.key.gz",
    out: join(ASSETS, "cert_chain_rs2048_proving.key"),
  },
  {
    src: "cert_chain_rs4096_proving.key.gz",
    out: join(ASSETS, "cert_chain_rs4096_proving.key"),
  },
  {
    src: "user_sig_rs2048_proving.key.gz",
    out: join(ASSETS, "user_sig_rs2048_proving.key"),
  },
];

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

async function headMeta(url) {
  const res = await fetch(url, { method: "HEAD", redirect: "follow" });
  return {
    etag: res.headers.get("etag") ?? "",
    len: res.headers.get("content-length") ?? "",
  };
}

async function fetchToFile(url, outPath) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  await mkdir(dirname(outPath), { recursive: true });
  const tmpPath = `${outPath}.partial`;
  await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(tmpPath));
  await rename(tmpPath, outPath);
  return {
    etag: res.headers.get("etag") ?? "",
    len: res.headers.get("content-length") ?? "",
  };
}

async function main() {
  console.log(`fetch-proving-keys: source = ${RELEASE_BASE}`);
  await mkdir(ASSETS, { recursive: true });
  const manifest = await loadManifest();

  for (const { src, out } of PROVING_KEYS) {
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
    manifest[src] = await fetchToFile(url, out);
    console.log("ok");
  }

  await saveManifest(manifest);
  console.log("fetch-proving-keys: done");
}

main().catch((err) => {
  console.error(`fetch-proving-keys: ${err.message}`);
  process.exit(1);
});
