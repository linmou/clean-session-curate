// Tests scripts/find_repo_sessions.mjs for strict native-format selection and raw-source preservation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, relative, resolve } from "node:path";
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
  const workspace = realpathSync.native(mkdtempSync(join(tmpdir(), "session-curate-discovery-")));
  const targetPath = join(workspace, "target");
  const nestedPath = join(targetPath, "packages", "api");
  const outsidePath = join(workspace, "outside");
  const aliasPath = join(workspace, "target-alias");
  const escapePath = join(targetPath, "escape");
  const home = join(workspace, "home");
  mkdirSync(nestedPath, { recursive: true });
  mkdirSync(outsidePath);
  symlinkSync(targetPath, aliasPath, process.platform === "win32" ? "junction" : "dir");
  symlinkSync(outsidePath, escapePath, process.platform === "win32" ? "junction" : "dir");
  const target = realpathSync.native(targetPath);
  const nested = realpathSync.native(nestedPath);
  const alias = resolve(aliasPath);
  const escape = resolve(escapePath);
  return { workspace, target, nested, outside: realpathSync.native(outsidePath), alias, escape, home };
}

function run(home, target, environment = {}, cwd = target) {
  const result = runRaw(home, target, environment, cwd);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function runRaw(home, target, environment = {}, cwd = target) {
  return spawnSync(process.execPath, [script, "--target", target, "--home", home], {
    cwd,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, ...environment },
  });
}

function unavailableOpenCodeBin(workspace) {
  const bin = join(workspace, "empty-bin");
  mkdirSync(bin, { recursive: true });
  return bin;
}

function fakeGitCmdOnly(workspace) {
  const bin = join(workspace, "git-cmd-only-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "git.cmd"), `@rem Return the fixture repository root if a broad shell fallback invokes this shim.
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
else if (process.env.OPENCODE_TEST_ROW_COUNT) {
  const rowCount = Number(process.env.OPENCODE_TEST_ROW_COUNT);
  const rowPadding = "x".repeat(Number(process.env.OPENCODE_TEST_ROW_PADDING ?? 0));
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    id: "ses_" + String(rowCount - index).padStart(5, "0"),
    directory: process.env.OPENCODE_TEST_REPO,
    ...(rowPadding ? { padding: rowPadding } : {}),
  }));
  process.stdout.write(JSON.stringify(rows));
}
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

function addFakeGit(bin) {
  const unixCommand = join(bin, "git");
  writeFileSync(unixCommand, `#!/bin/sh
# Record obsolete Git discovery while returning the unrelated caller root.
printf '%s\\n' "$*" >> "$GIT_TEST_LOG"
printf '%s\\n' "$GIT_TEST_ROOT"
`);
  chmodSync(unixCommand, 0o755);
  writeFileSync(join(bin, "git.cmd"), `@rem Record obsolete Git discovery while returning the unrelated caller root.
@echo %*>>"%GIT_TEST_LOG%"
@echo %GIT_TEST_ROOT%
`);
}

// Tests scripts/find_repo_sessions.mjs for explicit non-Git target ownership, deterministic output, and read-only sources.
test("discovers exact and descendant sessions for an explicit non-Git target from an unrelated directory", () => {
  const { workspace, target, nested, outside, alias, escape, home } = fixture();
  const unrelatedPath = join(workspace, "caller");
  const sibling = join(workspace, "target-sibling");
  mkdirSync(unrelatedPath);
  const unrelated = realpathSync.native(unrelatedPath);
  const aliasGeminiHash = createHash("sha256").update(alias).digest("hex");
  const canonicalGeminiHash = createHash("sha256").update(target).digest("hex");
  const descendantGeminiHash = createHash("sha256").update(nested).digest("hex");
  const claude = writeSession(home, ".claude/projects/deep/session.jsonl", `${JSON.stringify({ sessionId: "fixture-claude", type: "user", cwd: target, message: "hi" })}\n`);
  const claudeDescendant = writeSession(home, ".claude/projects/deep/descendant.jsonl", `${JSON.stringify({ sessionId: "fixture-claude-descendant", type: "user", cwd: nested })}\n`);
  const claudeAlias = writeSession(home, ".claude/projects/deep/alias.jsonl", `${JSON.stringify({ sessionId: "fixture-claude-alias", type: "user", cwd: alias })}\n`);
  const claudeMissing = writeSession(home, ".claude/projects/deep/missing.jsonl", `${JSON.stringify({ sessionId: "fixture-claude-missing", type: "user", cwd: join(alias, "missing") })}\n`);
  const claudeMissingCanonical = writeSession(home, ".claude/projects/deep/missing-canonical.jsonl", `${JSON.stringify({ sessionId: "fixture-claude-missing-canonical", type: "user", cwd: join(target, "missing-canonical") })}\n`);
  const claudeEscape = writeSession(home, ".claude/projects/deep/escape.jsonl", `${JSON.stringify({ sessionId: "fixture-claude-escape", type: "user", cwd: escape })}\n`);
  const claudeSibling = writeSession(home, ".claude/projects/sibling.jsonl", `${JSON.stringify({ sessionId: "fixture-sibling", type: "user", cwd: sibling })}\n`);
  const claudeOutside = writeSession(home, ".claude/projects/outside.jsonl", `${JSON.stringify({ sessionId: "fixture-claude-outside", type: "user", cwd: outside })}\n`);
  const codex = writeSession(home, ".codex/sessions/2026/08/rollout.jsonl", `${JSON.stringify({ type: "session_meta", payload: { originator: "codex_cli", cwd: nested } })}\n`);
  const codexAlias = writeSession(home, ".codex/sessions/alias.jsonl", `${JSON.stringify({ type: "session_meta", payload: { originator: "codex_cli", cwd: alias } })}\n`);
  const codexSibling = writeSession(home, ".codex/sessions/sibling.jsonl", `${JSON.stringify({ type: "session_meta", payload: { originator: "codex_cli", cwd: sibling } })}\n`);
  const codexOutside = writeSession(home, ".codex/sessions/outside.jsonl", `${JSON.stringify({ type: "session_meta", payload: { originator: "codex_cli", cwd: outside } })}\n`);
  const copilotExact = writeSession(home, ".copilot/session-state/exact/events.jsonl", `${JSON.stringify({ type: "session.start", data: { context: { cwd: target } } })}\n`);
  const copilot = writeSession(home, ".copilot/session-state/nested/events.jsonl", `${JSON.stringify({ type: "session.start", data: { context: { cwd: nested } } })}\n`);
  const copilotEscape = writeSession(home, ".copilot/session-state/escape/events.jsonl", `${JSON.stringify({ type: "session.start", data: { context: { cwd: escape } } })}\n`);
  const copilotSibling = writeSession(home, ".copilot/session-state/sibling/events.jsonl", `${JSON.stringify({ type: "session.start", data: { context: { cwd: sibling } } })}\n`);
  const geminiAlias = writeSession(home, ".gemini/tmp/alias/session.json", JSON.stringify({ messages: [], projectHash: aliasGeminiHash }));
  const geminiCanonical = writeSession(home, ".gemini/tmp/canonical/session.json", JSON.stringify({ messages: [], projectHash: canonicalGeminiHash }));
  const descendantGemini = writeSession(home, ".gemini/tmp/descendant.json", JSON.stringify({ messages: [], projectHash: descendantGeminiHash }));
  const nestedCwd = writeSession(home, ".codex/sessions/bad-nested.jsonl", `${JSON.stringify({ type: "session_meta", payload: { originator: "codex_cli" }, other: { cwd: target } })}\n`);
  const wrongSignature = writeSession(home, ".claude/projects/nope.jsonl", `${JSON.stringify({ type: "user", cwd: target, message: "not a session record" })}\n`);
  const wrongProject = writeSession(home, ".copilot/session-state/wrong/events.jsonl", `${JSON.stringify({ type: "session.start", data: { context: { cwd: outside } } })}\n`);
  const malformed = writeSession(home, ".gemini/tmp/broken.json", "{");
  const delayed = writeSession(home, ".codex/sessions/delayed.jsonl", `${" ".repeat(70_000)}${JSON.stringify({ type: "session_meta", payload: { originator: "codex_cli", cwd: target } })}\n`);
  const ignoredExtension = writeSession(home, ".codex/sessions/ignored.txt", `${JSON.stringify({ type: "session_meta", payload: { originator: "codex_cli", cwd: target } })}\n`);
  const database = writeSession(workspace, "opencode.db", "immutable fixture database");
  const log = writeSession(workspace, "opencode-invocations.jsonl", "");
  const gitLog = writeSession(workspace, "git-invocations.txt", "");
  const bin = fakeOpenCode(workspace);
  addFakeGit(bin);
  const rows = [
    { id: "ses_z", directory: nested },
    { id: "ses_alias", directory: alias },
    { id: "ses_missing", directory: join(alias, "missing-row") },
    { id: "ses_missing_canonical", directory: join(target, "missing-row-canonical") },
    { id: "ses_escape", directory: escape },
    { id: "ses_sibling", directory: sibling },
    { id: "ses_outside", directory: outside },
    { id: "ses_a", directory: target },
  ];
  const sources = [claude, claudeDescendant, claudeAlias, claudeMissing, claudeMissingCanonical, claudeEscape, claudeSibling, claudeOutside, codex, codexAlias, codexSibling, codexOutside, copilotExact, copilot, copilotEscape, copilotSibling, geminiAlias, geminiCanonical, descendantGemini, nestedCwd, wrongSignature, wrongProject, malformed, delayed, ignoredExtension, database];
  const before = new Map(sources.map((path) => [path, hash(path)]));
  const environment = {
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    OPENCODE_TEST_DB: database,
    OPENCODE_TEST_LOG: log,
    OPENCODE_TEST_ROWS: JSON.stringify(rows),
    GIT_TEST_LOG: gitLog,
    GIT_TEST_ROOT: unrelated,
  };

  const output = run(home, alias, environment, unrelated);
  assert.deepEqual(jsonLines(log), [
    ["db", "path"],
    ["db", "SELECT id, directory FROM session", "--format", "json"],
  ]);
  for (const [path, sourceHash] of before) assert.equal(hash(path), sourceHash, path);

  writeFileSync(log, "");
  const relativeOutput = run(home, relative(unrelated, alias), environment, unrelated);
  assert.deepEqual(jsonLines(log), [
    ["db", "path"],
    ["db", "SELECT id, directory FROM session", "--format", "json"],
  ]);
  for (const [path, sourceHash] of before) assert.equal(hash(path), sourceHash, path);
  assert.deepEqual(relativeOutput, output);
  assert.equal(readFileSync(gitLog, "utf8"), "", "discovery must not invoke Git when --target is supplied");

  assert.deepEqual(Object.keys(output).sort(), ["sessions", "skipped", "target"]);
  assert.equal(output.target, alias);
  assert.equal("repo" in output, false);
  assert.deepEqual(output.sessions, [
    { agent: "claude", path: claudeAlias },
    { agent: "claude", path: claudeDescendant },
    { agent: "claude", path: claudeMissingCanonical },
    { agent: "claude", path: claudeMissing },
    { agent: "claude", path: claude },
    { agent: "codex", path: codex },
    { agent: "codex", path: codexAlias },
    { agent: "codex", path: delayed },
    { agent: "copilot", path: copilotExact },
    { agent: "copilot", path: copilot },
    { agent: "gemini", path: geminiAlias },
    { agent: "gemini", path: geminiCanonical },
    { agent: "opencode", path: database, sessionId: "ses_a" },
    { agent: "opencode", path: database, sessionId: "ses_alias" },
    { agent: "opencode", path: database, sessionId: "ses_missing" },
    { agent: "opencode", path: database, sessionId: "ses_missing_canonical" },
    { agent: "opencode", path: database, sessionId: "ses_z" },
  ]);
  assert.equal(output.skipped, 15);
});

// Tests scripts/find_repo_sessions.mjs for required, existing-directory target validation before discovery.
test("rejects missing, nonexistent, and regular-file targets with clear errors", () => {
  const workspace = mkdtempSync(join(tmpdir(), "session-curate-target-errors-"));
  const home = join(workspace, "home");
  const nonexistent = join(workspace, "missing");
  const regularFile = writeSession(workspace, "target.txt", "not a directory");
  const dangling = join(workspace, "dangling");
  const symlinkFile = join(workspace, "file-link");
  symlinkSync(join(workspace, "missing-target"), dangling, process.platform === "win32" ? "junction" : "dir");
  symlinkSync(regularFile, symlinkFile, process.platform === "win32" ? "file" : undefined);

  const missing = spawnSync(process.execPath, [script, "--home", home], { cwd: workspace, encoding: "utf8" });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--target/i);

  const absent = runRaw(home, nonexistent, {}, workspace);
  assert.notEqual(absent.status, 0);
  assert.match(absent.stderr, /target.*does not exist/i);
  assert.match(absent.stderr, new RegExp(nonexistent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const file = runRaw(home, regularFile, {}, workspace);
  assert.notEqual(file.status, 0);
  assert.match(file.stderr, /target.*not a directory/i);
  assert.match(file.stderr, new RegExp(regularFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const danglingResult = runRaw(home, dangling, {}, workspace);
  assert.notEqual(danglingResult.status, 0);
  assert.match(danglingResult.stderr, /target.*does not exist/i);

  const symlinkFileResult = runRaw(home, symlinkFile, {}, workspace);
  assert.notEqual(symlinkFileResult.status, 0);
  assert.match(symlinkFileResult.stderr, /target.*not a directory/i);
});

test("discovers target-folder OpenCode sessions through its read-only database CLI", () => {
  const { workspace, target, nested, home } = fixture();
  const native = writeSession(home, ".codex/sessions/native.jsonl", `${JSON.stringify({ type: "session_meta", payload: { originator: "codex_cli", cwd: target } })}\n`);
  const database = writeSession(workspace, "opencode.db", "immutable fixture database");
  const log = writeSession(workspace, "opencode-invocations.jsonl", "");
  const bin = fakeOpenCode(workspace);
  const before = hash(database);
  const rows = [
    { id: "ses_z", directory: nested },
    { id: "ses_outside", directory: join(workspace, "outside") },
    { id: "ses_a", directory: target },
  ];

  const output = run(home, target, {
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
  const malformedRow = run(home, target, {
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    OPENCODE_TEST_DB: database,
    OPENCODE_TEST_LOG: log,
    OPENCODE_TEST_ROWS: JSON.stringify([{ id: "", directory: target }]),
  });
  assert.deepEqual(malformedRow.sessions, [{ agent: "codex", path: native }]);
  assert.equal(malformedRow.skipped, 1);
  assert.deepEqual(jsonLines(log), [
    ["db", "path"],
    ["db", "SELECT id, directory FROM session", "--format", "json"],
  ]);
  assert.equal(hash(database), before);
});

// Tests large OpenCode query handling in tests/find_repo_sessions.test.mjs without passing giant data through the environment.
test("discovers all target-folder OpenCode sessions when the query exceeds 1 MiB", () => {
  const { workspace, target, home } = fixture();
  const database = writeSession(workspace, "opencode.db", "immutable fixture database");
  const log = writeSession(workspace, "opencode-invocations.jsonl", "");
  const bin = fakeOpenCode(workspace);
  const rowCount = 25_000;
  const before = hash(database);

  const output = run(home, target, {
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    OPENCODE_TEST_DB: database,
    OPENCODE_TEST_LOG: log,
    OPENCODE_TEST_REPO: target,
    OPENCODE_TEST_ROW_COUNT: String(rowCount),
  });

  assert.equal(output.sessions.length, rowCount);
  for (let index = 0; index < rowCount; index += 1) {
    assert.deepEqual(output.sessions[index], {
      agent: "opencode",
      path: database,
      sessionId: `ses_${String(index + 1).padStart(5, "0")}`,
    });
  }
  assert.equal(output.skipped, 0);
  assert.deepEqual(jsonLines(log), [
    ["db", "path"],
    ["db", "SELECT id, directory FROM session", "--format", "json"],
  ]);
  assert.equal(hash(database), before);
});

// Tests oversized-query diagnostics and native-session isolation in tests/find_repo_sessions.test.mjs.
test("diagnoses an OpenCode query beyond the explicit buffer ceiling without failing discovery", () => {
  const { workspace, target, home } = fixture();
  const native = writeSession(home, ".codex/sessions/native.jsonl", `${JSON.stringify({ type: "session_meta", payload: { originator: "codex_cli", cwd: target } })}\n`);
  const database = writeSession(workspace, "opencode.db", "immutable fixture database");
  const log = writeSession(workspace, "opencode-invocations.jsonl", "");
  const bin = fakeOpenCode(workspace);
  const before = hash(database);

  const result = runRaw(home, target, {
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    OPENCODE_TEST_DB: database,
    OPENCODE_TEST_LOG: log,
    OPENCODE_TEST_REPO: target,
    OPENCODE_TEST_ROW_COUNT: "500000",
    OPENCODE_TEST_ROW_PADDING: "64",
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.sessions, [{ agent: "codex", path: native }]);
  assert.equal(output.skipped, 0);
  assert.match(result.stderr, /OpenCode.*ENOBUFS|ENOBUFS.*OpenCode/i);
  assert.equal(hash(database), before);
});

test("keeps native discovery available when OpenCode database access fails", () => {
  const { workspace, target, home } = fixture();
  const native = writeSession(home, ".codex/sessions/native.jsonl", `${JSON.stringify({ type: "session_meta", payload: { originator: "codex_cli", cwd: target } })}\n`);
  const log = writeSession(workspace, "opencode-invocations.jsonl", "");
  const missingOpenCodeBin = unavailableOpenCodeBin(workspace);

  const missingOpenCode = run(home, target, {
    PATH: missingOpenCodeBin,
    OPENCODE_TEST_REPO: target,
  });
  assert.deepEqual(missingOpenCode.sessions, [{ agent: "codex", path: native }]);
  assert.deepEqual(jsonLines(log), []);

  const bin = fakeOpenCode(workspace);
  const malformedQuery = run(home, target, {
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
  const failedQuery = run(home, target, {
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
