#!/usr/bin/env node
// Bumps patch version in package.json, then stamps it into all web files.
// Usage: node scripts/bump-version.js        (auto-bump patch)
//        node scripts/bump-version.js 0.2.0  (set explicit version)

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_PATH = join(__dirname, "..", "package.json");
const WEB = join(__dirname, "..", "web");

const pkg = JSON.parse(readFileSync(PKG_PATH, "utf8"));
const oldVersion = pkg.version;

// Determine new version
let newVersion;
if (process.argv[2]) {
  newVersion = process.argv[2].replace(/^v/, "");
} else {
  const parts = oldVersion.split(".").map(Number);
  parts[2]++;
  newVersion = parts.join(".");
}

// 1. Update package.json
pkg.version = newVersion;
writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");

// 2. Stamp sw.js — CACHE_VERSION
const swPath = join(WEB, "sw.js");
let sw = readFileSync(swPath, "utf8");
sw = sw.replace(/const CACHE_VERSION = "v[^"]+";/, `const CACHE_VERSION = "v${newVersion}";`);
writeFileSync(swPath, sw);

// 3. Stamp index.html — all cache-bust params and version label
const htmlPath = join(WEB, "index.html");
let html = readFileSync(htmlPath, "utf8");
html = html.replace(/styles\.css\?v=[^"]+/g, `styles.css?v=${newVersion}`);
html = html.replace(/app\.js\?v=[^"]+/g, `app.js?v=${newVersion}`);
html = html.replace(/v\d+\.\d+\.\d+(<\/span>)/, `v${newVersion}$1`);
writeFileSync(htmlPath, html);

console.log(`Bumped: v${oldVersion} → v${newVersion}`);
console.log("  package.json ✓");
console.log("  web/sw.js    ✓");
console.log("  web/index.html (styles.css, app.js, footer) ✓");
