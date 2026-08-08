// Tests scripts/find_repo_sessions.mjs for strict native-format selection and raw-source preservation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/find_repo_sessions.mjs", import.meta.url));

function writeSession(home, relativePath, contents) {
  const path = join(home, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fixture() {
  const workspace = mkdtempSync(join(tmpdir(), "session-curate-discovery-"));
  const repoPath = join(workspace, "repo");
  const nestedPath = join(repoPath, "packages", "api");
  const home = join(workspace, "home");
  mkdirSync(nestedPath, { recursive: true });
  execFileSync("git", ["init", "--quiet", repoPath]);
  const repo = realpathSync.native(repoPath);
  const nested = realpathSync.native(nestedPath);
  return { workspace, repo, nested, home };
}

function run(home, cwd) {
  const result = spawnSync("node", [script, "--home", home], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("selects recursively stored Capsule-native sessions and reports deterministic skipped candidates", () => {
  const { workspace, repo, nested, home } = fixture();
  const geminiHash = createHash("sha256").update(repo).digest("hex");
  const claude = writeSession(home, ".claude/projects/deep/session.jsonl", `${JSON.stringify({ sessionId: "fixture-claude", type: "user", cwd: repo, message: "hi" })}\n`);
  const codex = writeSession(home, ".codex/sessions/2026/08/rollout.jsonl", `${JSON.stringify({ type: "session_meta", payload: { originator: "codex_cli", cwd: nested } })}\n`);
  const copilot = writeSession(home, ".copilot/session-state/nested/events.jsonl", `${JSON.stringify({ type: "session.start", data: { context: { cwd: nested } } })}\n`);
  const gemini = writeSession(home, ".gemini/tmp/nested/session.json", JSON.stringify({ messages: [], projectHash: geminiHash }));
  const nestedCwd = writeSession(home, ".codex/sessions/bad-nested.jsonl", `${JSON.stringify({ type: "session_meta", payload: { originator: "codex_cli" }, other: { cwd: repo } })}\n`);
  const wrongSignature = writeSession(home, ".claude/projects/nope.jsonl", `${JSON.stringify({ type: "user", cwd: repo, message: "not a session record" })}\n`);
  const wrongProject = writeSession(home, ".copilot/session-state/wrong/events.jsonl", `${JSON.stringify({ type: "session.start", data: { context: { cwd: join(workspace, "outside") } } })}\n`);
  const malformed = writeSession(home, ".gemini/tmp/broken.json", "{");
  const delayed = writeSession(home, ".codex/sessions/delayed.jsonl", `${" ".repeat(70_000)}${JSON.stringify({ type: "session_meta", payload: { originator: "codex_cli", cwd: repo } })}\n`);
  const ignoredExtension = writeSession(home, ".codex/sessions/ignored.txt", `${JSON.stringify({ type: "session_meta", payload: { originator: "codex_cli", cwd: repo } })}\n`);
  const sources = [claude, codex, copilot, gemini, nestedCwd, wrongSignature, wrongProject, malformed, delayed, ignoredExtension];
  const before = new Map(sources.map((path) => [path, hash(path)]));

  const output = run(home, nested);

  assert.equal(output.repo, repo);
  assert.deepEqual(output.sessions, [
    { agent: "claude", path: claude },
    { agent: "codex", path: codex },
    { agent: "codex", path: delayed },
    { agent: "copilot", path: copilot },
    { agent: "gemini", path: gemini },
  ]);
  assert.equal(output.skipped, 4);
  for (const [path, sourceHash] of before) assert.equal(hash(path), sourceHash, path);
});

test("fails outside a Git repository", () => {
  const directory = mkdtempSync(join(tmpdir(), "session-curate-no-repo-"));
  const noGit = spawnSync("node", [script, "--home", directory], { cwd: directory, encoding: "utf8" });
  assert.notEqual(noGit.status, 0);
  assert.match(noGit.stderr, /Git repository/i);
});
