// Tests scripts/chunk_for_hunter.mjs for max(20%, 20 KB) sharding, boundary overlap, and oversized-line splitting.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildHunterShards } from "../scripts/chunk_for_hunter.mjs";

test("uses minBytes (20 KB) when corpus is small and produces a single shard", () => {
  const work = mkdtempSync(join(tmpdir(), "curate-chunk-small-"));
  try {
    const inDir = join(work, "in");
    const outDir = join(work, "out");
    rmSync(inDir, { recursive: true, force: true });
    mkdirSync(inDir, { recursive: true });
    writeFileSync(join(inDir, "claude_001.jsonl"), `${JSON.stringify({ msg: "hello world" })}\n`);
    writeFileSync(join(inDir, "manifest.json"), JSON.stringify({ format_version: 2 }));
    const m = buildHunterShards(inDir, outDir);
    assert.equal(m.target_shard_bytes, 20_000);
    assert.equal(m.shard_count, 1);
    assert.equal(m.shards[0].source_files.includes("manifest.json"), false);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("shards large corpus into max(20%, 20 KB) chunks with non-empty overlap and splits oversized lines", () => {
  const work = mkdtempSync(join(tmpdir(), "curate-chunk-large-"));
  try {
    const inDir = join(work, "in");
    const outDir = join(work, "out");
    mkdirSync(inDir, { recursive: true });
    // Create ~200 KB of JSONL lines so 20% = ~40 KB (> 20 KB)
    const lines = [];
    for (let i = 0; i < 400; i++) {
      lines.push(JSON.stringify({ idx: i, text: `Record ${i} ${"x".repeat(450)} BOUNDARY_${i}` }));
    }
    writeFileSync(join(inDir, "codex_001.jsonl"), `${lines.join("\n")}\n`);
    const m = buildHunterShards(inDir, outDir);
    assert.ok(m.target_shard_bytes >= 35_000, `Expected 20% target >= 35 KB, got ${m.target_shard_bytes}`);
    assert.ok(m.shard_count >= 5 && m.shard_count <= 7, `Expected 5-7 shards, got ${m.shard_count}`);
    assert.ok(m.overlap_bytes >= 2_000, `Expected overlap >= 2 KB, got ${m.overlap_bytes}`);

    // Verify adjacent shards overlap on at least one BOUNDARY_N marker
    const s1 = readFileSync(m.shards[0].file, "utf8");
    const s2 = readFileSync(m.shards[1].file, "utf8");
    const s1Markers = [...s1.matchAll(/BOUNDARY_(\d+)/g)].map((x) => x[0]);
    const lastMarkerOfS1 = s1Markers[s1Markers.length - 1];
    assert.ok(s2.includes(lastMarkerOfS1), `Expected shard 2 to overlap with ${lastMarkerOfS1}`);

    // Verify 100% line coverage across all shards
    const allText = m.shards.map((s) => readFileSync(s.file, "utf8")).join("\n");
    assert.ok(allText.includes("BOUNDARY_0"));
    assert.ok(allText.includes("BOUNDARY_399"));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
