#!/usr/bin/env node
"use strict";
/**
 * Runs the Raid Board locally.
 *
 *   node board.js                 read the default EFT log folder, serve on 127.0.0.1:8778
 *   node board.js --port 9000     use another port
 *   node board.js --logs "D:/..." point at a different EFT Logs folder
 *   node board.js --no-open       do not launch a browser
 *
 * Reads the game's logs only — it never writes to them and never talks to BSG.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { LogWatcher, defaultLogRoot } = require("./lib/logs");


const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const PORT = parseInt(opt("port", "8778"), 10);
const LOGS = opt("logs", defaultLogRoot());
const OPEN = !argv.includes("--no-open");

/**
 * The site is served either from the dist/ folder next to this script, or from a bundle baked
 * into the executable. One function so the routes never have to care which.
 */
let BAKED = null;
try {
  const sea = require("node:sea");
  if (sea.isSea()) {
    BAKED = JSON.parse(require("zlib").gunzipSync(Buffer.from(sea.getAsset("site"))).toString("utf8"));
  }
} catch (e) { /* running from source, which is the normal case */ }

function readAsset(rel) {
  if (BAKED) return BAKED[rel] ? Buffer.from(BAKED[rel], "base64") : null;
  const f = path.join(__dirname, "dist", rel);
  try { return fs.readFileSync(f); } catch (e) { return null; }
}

if (!readAsset("index.html")) {
  console.error("Missing dist/index.html — run `node build.js` first.");
  process.exit(1);
}

const watcher = new LogWatcher(LOGS);
if (!fs.existsSync(LOGS)) {
  console.error(`\n  Log folder not found: ${LOGS}`);
  console.error(`  Pass the right one with:  node board.js --logs "C:/path/to/Escape from Tarkov/Logs"\n`);
}

console.log(`Reading logs from ${LOGS}`);
const applied = watcher.scanAll();
const snap = watcher.snapshot();
console.log(
  `  ${snap.sessions} sessions, ${applied} quest events -> ` +
  `${snap.counts.active} active, ${snap.counts.done} completed` +
  (snap.range.from ? `, back to ${new Date(snap.range.from).toISOString().slice(0, 10)}` : "")
);
watcher.start(2000);

// ---- live clients ----
const clients = new Set();
function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(frame); } catch (e) { clients.delete(res); } }
}
watcher.on("quest", (q) => { if (q.fresh) broadcast("quest", q); });
watcher.on("raid", (r) => broadcast("raid", r));

const server = http.createServer((req, res) => {

  const url = req.url.split("?")[0];

  if (url === "/api/state") {
    // ?rescan=1 re-reads every session folder, not just the one the game is writing to
    if (/[?&]rescan=1/.test(req.url)) watcher.scanAll();
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify(watcher.snapshot()));
  }

  if (url === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });
    res.write("retry: 3000\n\n");
    clients.add(res);
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch (e) {} }, 25000);
    req.on("close", () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  // one guide file per quest, fetched when you open a Guide button
  const guide = url.match(/^\/guides\/([A-Za-z0-9]+\.json)$/);
  if (guide) {
    const body = readAsset("guides/" + guide[1]);
    if (body) {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(body);
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end('{"o":{},"x":{}}');
  }

  const map = url.match(/^\/maps\/([A-Za-z0-9_.-]+\.svg)$/);
  if (map) {
    const body = readAsset("maps/" + map[1]);
    if (body) {
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=86400" });
      return res.end(body);
    }
  }

  if (url === "/" || url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(readAsset("index.html"));
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`\n  Raid Board running at ${url}`);
  console.log(`  Watching for quest and raid events. Ctrl+C to stop.\n`);
  if (OPEN) exec(`start "" "${url}"`, { shell: "cmd.exe" }, () => {});
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use — try: node board.js --port ${PORT + 1}`);
    process.exit(1);
  }
  throw e;
});
