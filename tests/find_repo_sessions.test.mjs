// Tests scripts/find_repo_sessions.mjs for strict native-format selection and raw-source preservation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
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

function jsonLines(path) {
  return readFileSync(path, "utf8").split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
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

function run(home, cwd, environment = {}) {
  const result = spawnSync(process.execPath, [script, "--home", home], { cwd, encoding: "utf8", env: { ...process.env, ...environment } });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function fakeGit(workspace) {
  const bin = join(workspace, "git-only-bin");
  mkdirSync(bin, { recursive: true });
  const unixCommand = join(bin, "git");
  writeFileSync(unixCommand, `#!/bin/sh
# Return the fixture repository root while leaving OpenCode unavailable.
printf '%s\\n' "$OPENCODE_TEST_REPO"
`);
  chmodSync(unixCommand, 0o755);
  writeFileSync(join(bin, "git.cmd"), `@rem Return the fixture repository root while leaving OpenCode unavailable.
@echo %OPENCODE_TEST_REPO%
`);
  return bin;
}

function fakeOpenCode(workspace) {
  const bin = join(workspace, "bin");
  const implementation = join(bin, "fake-opencode.mjs");
  mkdirSync(bin, { recursive: true });
  writeFileSync(implementation, `#!/usr/bin/env node
// Emulate OpenCode's read-only database commands for discovery integration tests.
import { appendFileSync } from "node:fs";
appendFileSync(process.env.OPENCODE_TEST_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.argv[3] === "path") process.stdout.write(process.env.OPENCODE_TEST_DB + "\\n");
else if (process.env.OPENCODE_TEST_QUERY_FAILURE === "1") process.exit(1);
else if (process.env.OPENCODE_TEST_BAD_QUERY === "1") process.stdout.write("not-json");
else process.stdout.write(process.env.OPENCODE_TEST_ROWS);
`);
  const unixCommand = join(bin, "opencode");
  writeFileSync(unixCommand, `#!/bin/sh
# Launch the fake OpenCode implementation for discovery integration tests.
exec "${process.execPath}" "${implementation}" "$@"
`);
  chmodSync(unixCommand, 0o755);
  writeFileSync(join(bin, "opencode.cmd"), `@rem Launch the fake OpenCode implementation for discovery integration tests.
@"${process.execPath}" "${implementation}" %*
`);
  return bin;
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

  const output = run(home, nested, { PATH: fakeGit(workspace), OPENCODE_TEST_REPO: repo });

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

test("discovers current-repository OpenCode sessions through its read-only database CLI", () => {
  const { workspace, repo, nested, home } = fixture();
  const native = writeSession(home, ".codex/sessions/native.jsonl", `${JSON.stringify({ type: "session_meta", payload: { originator: "codex_cli", cwd: repo } })}\n`);
  const database = writeSession(workspace, "opencode.db", "immutable fixture database");
  const log = writeSession(workspace, "opencode-invocations.jsonl", "");
  const bin = fakeOpenCode(workspace);
  const before = hash(database);
  const rows = [
    { id: "ses_z", directory: nested },
    { id: "ses_outside", directory: join(workspace, "outside") },
    { id: "ses_a", directory: repo },
  ];

  const output = run(home, nested, {
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    OPENCODE_TEST_DB: database,
    OPENCODE_TEST_LOG: log,
    OPENCODE_TEST_ROWS: JSON.stringify(rows),
  });

  assert.deepEqual(output.sessions, [
    { agent: "codex", path: native },
    { agent: "opencode", path: database, sessionId: "ses_a" },
    { agent: "opencode", path: database, sessionId: "ses_z" },
  ]);
  assert.equal(output.skipped, 1);
  assert.deepEqual(jsonLines(log), [
    ["db", "path"],
    ["db", "SELECT id, directory FROM session", "--format", "json"],
  ]);
  assert.equal(hash(database), before);

  writeFileSync(log, "");
  const malformedRow = run(home, nested, {
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    OPENCODE_TEST_DB: database,
    OPENCODE_TEST_LOG: log,
    OPENCODE_TEST_ROWS: JSON.stringify([{ id: "", directory: repo }]),
  });
  assert.deepEqual(malformedRow.sessions, [{ agent: "codex", path: native }]);
  assert.equal(malformedRow.skipped, 1);
  assert.deepEqual(jsonLines(log), [
    ["db", "path"],
    ["db", "SELECT id, directory FROM session", "--format", "json"],
  ]);
  assert.equal(hash(database), before);
});

test("keeps native discovery available when OpenCode database access fails", () => {
  const { workspace, repo, home } = fixture();
  const native = writeSession(home, ".codex/sessions/native.jsonl", `${JSON.stringify({ type: "session_meta", payload: { originator: "codex_cli", cwd: repo } })}\n`);
  const log = writeSession(workspace, "opencode-invocations.jsonl", "");
  const missingOpenCodeBin = fakeGit(workspace);

  const missingOpenCode = run(home, repo, {
    PATH: missingOpenCodeBin,
    OPENCODE_TEST_REPO: repo,
  });
  assert.deepEqual(missingOpenCode.sessions, [{ agent: "codex", path: native }]);
  assert.deepEqual(jsonLines(log), []);

  const bin = fakeOpenCode(workspace);
  const malformedQuery = run(home, repo, {
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    OPENCODE_TEST_DB: join(workspace, "opencode.db"),
    OPENCODE_TEST_LOG: log,
    OPENCODE_TEST_BAD_QUERY: "1",
  });
  assert.deepEqual(malformedQuery.sessions, [{ agent: "codex", path: native }]);
  assert.deepEqual(jsonLines(log), [
    ["db", "path"],
    ["db", "SELECT id, directory FROM session", "--format", "json"],
  ]);

  writeFileSync(log, "");
  const failedQuery = run(home, repo, {
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    OPENCODE_TEST_DB: join(workspace, "opencode.db"),
    OPENCODE_TEST_LOG: log,
    OPENCODE_TEST_QUERY_FAILURE: "1",
  });
  assert.deepEqual(failedQuery.sessions, [{ agent: "codex", path: native }]);
  assert.deepEqual(jsonLines(log), [
    ["db", "path"],
    ["db", "SELECT id, directory FROM session", "--format", "json"],
  ]);
});
