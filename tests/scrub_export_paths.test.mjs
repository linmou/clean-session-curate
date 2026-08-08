// Tests scripts/scrub_export_paths.mjs removes repository paths only from exports.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/scrub_export_paths.mjs", import.meta.url));

function stringsAndKeys(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsAndKeys);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, item]) => [key, ...stringsAndKeys(item)]);
}

test("scrubs repository paths from JSON and JSONL exports without touching raw input", () => {
  const workspace = mkdtempSync(join(tmpdir(), "session-scrub-"));
  const repo = join(workspace, "repo");
  const exportDir = join(workspace, "export");
  const raw = join(workspace, "raw-session.jsonl");
  mkdirSync(exportDir, { recursive: true });
  const jsonl = join(exportDir, "codex_001.jsonl");
  const json = join(exportDir, "gemini_001.json");
  const alternateRepo = repo.includes("\\") ? repo.replaceAll("\\", "/") : repo.replaceAll("/", "\\");
  const caseVariant = process.platform === "win32" ? alternateRepo.toUpperCase() : alternateRepo;
  const rawContents = `${JSON.stringify({ cwd: repo })}\n`;
  writeFileSync(raw, rawContents);
  writeFileSync(jsonl, `${JSON.stringify({ cwd: repo, text: `${alternateRepo}\\src\\main.js`, keep: "ordinary text" })}\n`);
  writeFileSync(json, JSON.stringify({ workspace: caseVariant, nested: { [`${alternateRepo}\\private`]: `${alternateRepo}\\src\\main.js` } }));

  execFileSync("node", [script, "--root", repo, "--export-dir", exportDir]);

  const scrubbed = [JSON.parse(readFileSync(jsonl, "utf8").trim()), JSON.parse(readFileSync(json, "utf8"))];
  const values = scrubbed.flatMap(stringsAndKeys);
  assert.equal(values.some((value) => value.toLowerCase().includes(repo.toLowerCase()) || value.toLowerCase().includes(alternateRepo.toLowerCase())), false);
  assert.equal(values.filter((value) => value.includes("/project")).length >= 4, true);
  assert.match(readFileSync(jsonl, "utf8"), /ordinary text/);
  assert.equal(readFileSync(raw, "utf8"), rawContents);
});
