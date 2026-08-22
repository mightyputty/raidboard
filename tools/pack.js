#!/usr/bin/env node
"use strict";
/**
 * Builds raidboard.exe — the whole board in one file you double-click.
 *
 *   node tools/pack.js
 *
 * Node's single-executable support takes one script and a set of assets, so this inlines the
 * log watcher into board.js, packs dist/ into a single gzipped blob, and injects both into a
 * copy of node.exe. No install, no Node on the player's machine, no terminal.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(ROOT, "build");
const DIST = path.join(ROOT, "dist");
const EXE = path.join(BUILD, "raidboard.exe");

function walk(dir, base) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = base ? base + "/" + e.name : e.name;
    if (e.isDirectory()) out = out.concat(walk(full, rel));
    else out.push(rel);
  }
  return out;
}

function main() {
  if (!fs.existsSync(path.join(DIST, "index.html"))) {
    console.error("No dist/index.html — run `node build.js` first.");
    process.exit(1);
  }
  fs.rmSync(BUILD, { recursive: true, force: true });
  fs.mkdirSync(BUILD, { recursive: true });

  // 1. one script: the watcher inlined into the server
  const board = fs.readFileSync(path.join(ROOT, "board.js"), "utf8");
  const logs = fs.readFileSync(path.join(ROOT, "lib", "logs.js"), "utf8");
  const requireLine = 'const { LogWatcher, defaultLogRoot } = require("./lib/logs");';
  if (board.indexOf(requireLine) < 0) throw new Error("board.js no longer requires lib/logs the expected way");
  const inlined = board.replace(requireLine,
    "const { LogWatcher, defaultLogRoot } = (function () {\n" +
    "  const module = { exports: {} }; const exports = module.exports;\n" +
    logs + "\n  return module.exports;\n})();");
  fs.writeFileSync(path.join(BUILD, "raidboard.js"), inlined);

  // 2. the site as one asset
  const files = walk(DIST, "");
  const bundle = {};
  for (const rel of files) bundle[rel] = fs.readFileSync(path.join(DIST, rel)).toString("base64");
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(bundle)), { level: 9 });
  fs.writeFileSync(path.join(BUILD, "site.json.gz"), gz);
  console.log(`  ${files.length} files packed into ${(gz.length / 1048576).toFixed(1)} MB`);

  // 3. the blob
  fs.writeFileSync(path.join(BUILD, "sea-config.json"), JSON.stringify({
    main: path.join(BUILD, "raidboard.js"),
    output: path.join(BUILD, "raidboard.blob"),
    disableExperimentalSEAWarning: true,
    assets: { site: path.join(BUILD, "site.json.gz") }
  }, null, 2));
  execFileSync(process.execPath,
    ["--experimental-sea-config", path.join(BUILD, "sea-config.json")],
    { stdio: "inherit" });

  // 4. a copy of node with the blob injected into it
  fs.copyFileSync(process.execPath, EXE);
  const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
  // postject ships as a .cmd on Windows and Node refuses to execFileSync those, so call its
  // JS entry point directly through this same Node binary
  const postject = require.resolve("postject/dist/cli.js");
  execFileSync(process.execPath,
    [postject, EXE, "NODE_SEA_BLOB", path.join(BUILD, "raidboard.blob"), "--sentinel-fuse", FUSE],
    { stdio: "inherit" });

  console.log(`\n  build/raidboard.exe  ${(fs.statSync(EXE).size / 1048576).toFixed(0)} MB`);
  console.log("  Double-click it. No Node, no install, no terminal.\n");
}

main();
