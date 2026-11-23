#!/usr/bin/env node
// Splits Pass-1 cleaned session exports into bounded, overlapping shards for parallel Agent Privacy Hunters.
// Shard size = max(ceil(totalBytes * maxRatio), minBytes), default max(20%, 20 KB), with line/slice overlap.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function optionValue(flag, fallback = null) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function splitOversizedSegment(text, maxBytes, overlapBytes) {
  const slices = [];
  const step = Math.max(1, maxBytes - overlapBytes);
  let pos = 0;
  while (pos < text.length) {
    const end = Math.min(text.length, pos + maxBytes);
    slices.push(text.slice(pos, end));
    if (end >= text.length) break;
    pos += step;
  }
  return slices;
}

export function buildHunterShards(inputDir, outDir, opts = {}) {
  const minBytes = Number(opts.minBytes ?? 20_000);
  const maxRatio = Number(opts.maxRatio ?? 0.20);
  const overlapRatio = Number(opts.overlapRatio ?? 0.10);

  const absIn = resolve(inputDir);
  const absOut = resolve(outDir);
  const files = readdirSync(absIn)
    .filter((f) => /\.(jsonl|json)$/i.test(f) && f !== "manifest.json")
    .sort();

  const records = [];
  let totalBytes = 0;
  for (const f of files) {
    const raw = readFileSync(join(absIn, f), "utf8");
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const tagged = `[${f}:L${i + 1}] ${lines[i]}\n`;
      const bytes = Buffer.byteLength(tagged, "utf8");
      totalBytes += bytes;
      records.push({ file: f, line: i + 1, text: tagged, bytes });
    }
  }

  const targetShardBytes = Math.max(Math.ceil(totalBytes * maxRatio), minBytes);
  const overlapBytes = totalBytes <= targetShardBytes
    ? 0
    : Math.min(Math.max(Math.ceil(targetShardBytes * overlapRatio), 2_000), Math.floor(targetShardBytes * 0.25));

  // Normalize records so no single entry exceeds targetShardBytes
  const units = [];
  for (const rec of records) {
    if (rec.bytes <= targetShardBytes) {
      units.push(rec);
    } else {
      const parts = splitOversizedSegment(rec.text, targetShardBytes, Math.max(overlapBytes, 2_000));
      parts.forEach((part, idx) => {
        const text = `[${rec.file}:L${rec.line}:part${idx + 1}/${parts.length}] ${part}\n`;
        units.push({ file: rec.file, line: rec.line, text, bytes: Buffer.byteLength(text, "utf8") });
      });
    }
  }

  const shards = [];
  let current = [];
  let currentBytes = 0;

  const flushShard = (withNextOverlap) => {
    if (current.length === 0) return;
    const text = current.map((u) => u.text).join("");
    const sourceFiles = [...new Set(current.map((u) => u.file))].sort();
    shards.push({
      id: `shard_${String(shards.length + 1).padStart(3, "0")}`,
      text,
      bytes: Buffer.byteLength(text, "utf8"),
      source_files: sourceFiles,
      unit_count: current.length,
    });
    if (withNextOverlap && overlapBytes > 0) {
      const tail = [];
      let tailBytes = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        if (tailBytes + current[i].bytes > overlapBytes && tail.length > 0) break;
        tail.unshift(current[i]);
        tailBytes += current[i].bytes;
        if (tailBytes >= overlapBytes) break;
      }
      current = tail;
      currentBytes = tailBytes;
    } else {
      current = [];
      currentBytes = 0;
    }
  };

  for (const unit of units) {
    if (current.length > 0 && currentBytes + unit.bytes > targetShardBytes) {
      flushShard(true);
      // If overlap + unit alone still exceeds targetShardBytes + overlapBytes, keep overlap bounded
      if (currentBytes + unit.bytes > targetShardBytes + overlapBytes) {
        current = [];
        currentBytes = 0;
      }
    }
    current.push(unit);
    currentBytes += unit.bytes;
  }
  flushShard(false);

  rmSync(absOut, { recursive: true, force: true });
  mkdirSync(absOut, { recursive: true });

  const manifestShards = [];
  for (const s of shards) {
    const file = join(absOut, `${s.id}.txt`);
    writeFileSync(file, s.text);
    manifestShards.push({
      id: s.id,
      file,
      bytes: s.bytes,
      source_files: s.source_files,
      unit_count: s.unit_count,
    });
  }

  const manifest = {
    total_bytes: totalBytes,
    target_shard_bytes: targetShardBytes,
    overlap_bytes: overlapBytes,
    shard_count: manifestShards.length,
    shards: manifestShards,
  };
  writeFileSync(join(absOut, "shards_manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const inputDir = optionValue("--input-dir");
  const outDir = optionValue("--out-dir");
  if (!inputDir || !outDir) {
    throw new Error("Usage: chunk_for_hunter.mjs --input-dir <session-export> --out-dir <tmp-shards> [--min-bytes 20000] [--max-ratio 0.20] [--overlap-ratio 0.10]");
  }
  const manifest = buildHunterShards(inputDir, outDir, {
    minBytes: optionValue("--min-bytes", 20_000),
    maxRatio: optionValue("--max-ratio", 0.20),
    overlapRatio: optionValue("--overlap-ratio", 0.10),
  });
  console.log(JSON.stringify(manifest, null, 2));
}
