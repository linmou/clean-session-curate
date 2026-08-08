#!/usr/bin/env node
// Tests scripts/package_export.mjs creates an exact, integrity-checked archive through native OS tooling.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/package_export.mjs", import.meta.url));

function archiveMembers(path) {
  if (process.platform !== "win32") {
    const result = spawnSync("unzip", ["-Z1", path], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim().split(/\r?\n/).sort();
  }
  const command = "$archive = [IO.Compression.ZipFile]::OpenRead($env:SESSION_CURATE_TEST_ARCHIVE); try { $archive.Entries.FullName } finally { $archive.Dispose() }";
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    env: { ...process.env, SESSION_CURATE_TEST_ARCHIVE: path },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split(/\r?\n/).sort();
}

test("packages only the validated manifest and numbered exports", () => {
  const workspace = mkdtempSync(join(tmpdir(), "session-curate-package-"));
  const repo = join(workspace, "repo");
  const exportDir = join(repo, "session-export");
  const output = join(repo, "session-export.zip");
  mkdirSync(exportDir, { recursive: true });
  writeFileSync(join(exportDir, "codex_001.jsonl"), `${JSON.stringify({ type: "message", text: "clean" })}\n`);
  writeFileSync(join(exportDir, "manifest.json"), JSON.stringify({
    format_version: 2,
    session_count: 1,
    agents: { claude: 0, codex: 1, copilot: 0, gemini: 0 },
    ux_language: "en",
    cleaning: "capsule-select-all",
    capsule_version: "1.0.0",
  }));

  const result = spawnSync("node", [script, "--root", repo, "--export-dir", exportDir, "--output", output], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(statSync(output).isFile(), true);
  assert.deepEqual(archiveMembers(output), ["codex_001.jsonl", "manifest.json"]);
  assert.deepEqual(JSON.parse(result.stdout), {
    archive: "session-export.zip",
    engine: process.platform === "win32" ? "powershell" : "zip",
    files: 2,
    platform: process.platform,
  });
});

test("allows each harness export sequence to restart at 001", () => {
  const workspace = mkdtempSync(join(tmpdir(), "session-curate-package-harnesses-"));
  const repo = join(workspace, "repo");
  const exportDir = join(repo, "session-export");
  const output = join(repo, "session-export.zip");
  mkdirSync(exportDir, { recursive: true });
  writeFileSync(join(exportDir, "claude_001.jsonl"), `${JSON.stringify({ type: "message", text: "first" })}\n`);
  writeFileSync(join(exportDir, "codex_001.jsonl"), `${JSON.stringify({ type: "message", text: "second" })}\n`);
  writeFileSync(join(exportDir, "manifest.json"), JSON.stringify({
    format_version: 2,
    session_count: 2,
    agents: { claude: 1, codex: 1, copilot: 0, gemini: 0 },
    ux_language: "en",
    cleaning: "capsule-select-all",
    capsule_version: "1.0.0",
  }));

  const result = spawnSync("node", [script, "--root", repo, "--export-dir", exportDir, "--output", output], { encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(archiveMembers(output), ["claude_001.jsonl", "codex_001.jsonl", "manifest.json"]);
});

test("refuses an alternate-separator repository path without leaving an archive", () => {
  const workspace = mkdtempSync(join(tmpdir(), "session-curate-package-private-"));
  const repo = join(workspace, "repo");
  const exportDir = join(repo, "session-export");
  const output = join(repo, "session-export.zip");
  const alternateRepo = repo.includes("\\") ? repo.replaceAll("\\", "/") : repo.replaceAll("/", "\\");
  mkdirSync(exportDir, { recursive: true });
  writeFileSync(join(exportDir, "codex_001.jsonl"), `${JSON.stringify({ text: `${alternateRepo}\\private.txt` })}\n`);
  writeFileSync(join(exportDir, "manifest.json"), JSON.stringify({
    format_version: 2,
    session_count: 1,
    agents: { claude: 0, codex: 1, copilot: 0, gemini: 0 },
    ux_language: "en",
    cleaning: "capsule-select-all",
    capsule_version: "1.0.0",
  }));

  const result = spawnSync("node", [script, "--root", repo, "--export-dir", exportDir, "--output", output], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /repository path/i);
  assert.equal(existsSync(output), false);
});

test("refuses a numbered export sequence that does not start at 001", () => {
  const workspace = mkdtempSync(join(tmpdir(), "session-curate-package-sequence-"));
  const repo = join(workspace, "repo");
  const exportDir = join(repo, "session-export");
  const output = join(repo, "session-export.zip");
  mkdirSync(exportDir, { recursive: true });
  writeFileSync(join(exportDir, "codex_002.jsonl"), `${JSON.stringify({ type: "message", text: "clean" })}\n`);
  writeFileSync(join(exportDir, "manifest.json"), JSON.stringify({
    format_version: 2,
    session_count: 1,
    agents: { claude: 0, codex: 1, copilot: 0, gemini: 0 },
    ux_language: "en",
    cleaning: "capsule-select-all",
    capsule_version: "1.0.0",
  }));

  const result = spawnSync("node", [script, "--root", repo, "--export-dir", exportDir, "--output", output], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sequence/i);
  assert.equal(existsSync(output), false);
});

test("refuses a gap in a harness export sequence", () => {
  const workspace = mkdtempSync(join(tmpdir(), "session-curate-package-gap-"));
  const repo = join(workspace, "repo");
  const exportDir = join(repo, "session-export");
  const output = join(repo, "session-export.zip");
  mkdirSync(exportDir, { recursive: true });
  writeFileSync(join(exportDir, "codex_001.jsonl"), `${JSON.stringify({ type: "message", text: "first" })}\n`);
  writeFileSync(join(exportDir, "codex_003.jsonl"), `${JSON.stringify({ type: "message", text: "third" })}\n`);
  writeFileSync(join(exportDir, "manifest.json"), JSON.stringify({
    format_version: 2,
    session_count: 2,
    agents: { claude: 0, codex: 2, copilot: 0, gemini: 0 },
    ux_language: "en",
    cleaning: "capsule-select-all",
    capsule_version: "1.0.0",
  }));

  const result = spawnSync("node", [script, "--root", repo, "--export-dir", exportDir, "--output", output], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sequence/i);
  assert.equal(existsSync(output), false);
});
