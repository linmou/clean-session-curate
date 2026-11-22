#!/usr/bin/env node
// Select Capsule-compatible target-folder sessions without modifying source files.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const SESSION_ROOTS = [
  ["claude", ".claude/projects"],
  ["codex", ".codex/sessions"],
  ["copilot", ".copilot/session-state"],
  ["gemini", ".gemini/tmp"],
  ["pi", ".pi/agent/sessions"],
];

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
}

function execCommand(command, args, options) {
  if (process.platform !== "win32") return execFileSync(command, args, options);
  return execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command, ...args], options);
}

function targetFolder() {
  const value = optionValue("--target");
  if (value === undefined) throw new Error("Missing required option: --target <folder>.");
  const lexical = resolve(value);
  if (!existsSync(lexical)) throw new Error(`Target does not exist: ${lexical}`);
  if (!statSync(lexical).isDirectory()) throw new Error(`Target is not a directory: ${lexical}`);
  return { lexical, canonical: realpathSync.native(lexical) };
}

function sessionFiles(directory) {
  if (!existsSync(directory)) return [];
  try {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      try {
        if (entry.isDirectory()) return sessionFiles(path);
        return entry.isFile() && /\.jsonl?$/i.test(entry.name) ? [path] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function jsonLines(path) {
  return readFileSync(path, "utf8").split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

function isLexicallyInside(candidate, target) {
  if (typeof candidate !== "string") return false;
  const relation = relative(target, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function isInsideTarget(candidate, targets) {
  if (typeof candidate !== "string") return false;
  const lexicalCandidate = resolve(candidate);
  if (existsSync(lexicalCandidate)) {
    try {
      if (!statSync(lexicalCandidate).isDirectory()) return false;
      return isLexicallyInside(realpathSync.native(lexicalCandidate), targets.canonical);
    } catch {
      return false;
    }
  }
  return isLexicallyInside(lexicalCandidate, targets.lexical) || isLexicallyInside(lexicalCandidate, targets.canonical);
}

function claudeCwd(records) {
  if (!records.slice(0, 10).some((record) => record?.sessionId && ["user", "assistant", "file-history-snapshot"].includes(record.type))) return undefined;
  for (const record of records) {
    if (record?.sessionId && ["user", "assistant", "file-history-snapshot"].includes(record.type) && typeof record.cwd === "string") return record.cwd;
  }
}

function codexCwd(records) {
  if (!records.slice(0, 10).some((record) => record?.type === "session_meta" && typeof record.payload?.originator === "string" && record.payload.originator.toLowerCase().includes("codex"))) return undefined;
  for (const record of records) {
    if (record?.type === "session_meta" && typeof record.payload?.originator === "string" && record.payload.originator.toLowerCase().includes("codex") && typeof record.payload.cwd === "string") return record.payload.cwd;
  }
}

function copilotCwd(records) {
  if (!records.slice(0, 10).some((record) => record?.type === "session.start")) return undefined;
  for (const record of records) {
    if (record?.type === "session.start" && typeof record.data?.context?.cwd === "string") return record.data.context.cwd;
  }
}

function geminiMatches(path, targets) {
  const root = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(root?.messages)) return false;
  const hashes = [targets.lexical, targets.canonical].map((target) => createHash("sha256").update(target).digest("hex"));
  return hashes.includes(root.projectHash);
}

function piCwd(path) {
  const firstLine = readFileSync(path, "utf8").split(/\r?\n/, 1)[0];
  if (!firstLine || !firstLine.trim()) return undefined;
  const header = JSON.parse(firstLine);
  return header?.type === "session" && typeof header.cwd === "string" ? header.cwd : undefined;
}

function selectCandidate(agent, path, targets) {
  if (agent === "gemini") return geminiMatches(path, targets);
  if (agent === "pi") return isInsideTarget(piCwd(path), targets);
  const records = jsonLines(path);
  const cwd = agent === "claude" ? claudeCwd(records) : agent === "codex" ? codexCwd(records) : copilotCwd(records);
  return isInsideTarget(cwd, targets);
}

function queryOpenCodeSqliteReadOnly(dbPath) {
  try {
    const raw = execFileSync(
      "sqlite3",
      ["-readonly", "-json", `file:${dbPath}?mode=ro&immutable=1`, "SELECT id, directory FROM session"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }
    );
    return raw.trim() ? JSON.parse(raw) : [];
  } catch {
    const py = "import json,sqlite3,sys; c=sqlite3.connect(f'file:{sys.argv[1]}?mode=ro&immutable=1',uri=True); print(json.dumps([{'id':r[0],'directory':r[1]} for r in c.execute('SELECT id, directory FROM session').fetchall()]))";
    const raw = execFileSync("python3", ["-c", py, dbPath], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return raw.trim() ? JSON.parse(raw) : [];
  }
}

function openCodeSessions(targets, home) {
  let path = "";
  let rows = null;
  try {
    const options = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
    const queryOptions = { ...options, maxBuffer: 64 * 1024 * 1024 };
    path = execCommand("opencode", ["db", "path"], options).trim();
    rows = JSON.parse(execCommand("opencode", ["db", "SELECT id, directory FROM session", "--format", "json"], queryOptions));
  } catch (error) {
    if (error?.code === "ENOBUFS") {
      process.stderr.write("OpenCode session query exceeded the 64 MiB maxBuffer (ENOBUFS); skipping OpenCode sessions.\n");
      return { sessions: [], skipped: 0 };
    }
    const defaultDb = join(home, ".local", "share", "opencode", "opencode.db");
    if (existsSync(defaultDb)) {
      try {
        path = defaultDb;
        rows = queryOpenCodeSqliteReadOnly(defaultDb);
      } catch (sqliteError) {
        process.stderr.write(`OpenCode database found at ${defaultDb} but read-only query failed: ${sqliteError.message}\n`);
        return { sessions: [], skipped: 0 };
      }
    } else {
      return { sessions: [], skipped: 0 };
    }
  }
  if (!path || !Array.isArray(rows)) return { sessions: [], skipped: 0 };
  const sessions = [];
  let skipped = 0;
  for (const row of rows) {
    if (typeof row?.id === "string" && row.id && isInsideTarget(row.directory, targets)) {
      sessions.push({ agent: "opencode", path, sessionId: row.id });
    } else {
      skipped += 1;
    }
  }
  return { sessions, skipped };
}

function main() {
  const targets = targetFolder();
  const home = resolve(optionValue("--home") ?? homedir());
  let skipped = 0;
  const sessions = [];
  for (const [agent, root] of SESSION_ROOTS) {
    for (const path of sessionFiles(join(home, root))) {
      try {
        if (selectCandidate(agent, path, targets)) sessions.push({ agent, path });
        else skipped += 1;
      } catch {
        skipped += 1;
      }
    }
  }
  const openCode = openCodeSessions(targets, home);
  sessions.push(...openCode.sessions);
  skipped += openCode.skipped;
  sessions.sort((left, right) => left.agent.localeCompare(right.agent) || left.path.localeCompare(right.path) || (left.sessionId ?? "").localeCompare(right.sessionId ?? ""));
  process.stdout.write(`${JSON.stringify({ target: targets.lexical, sessions, skipped })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
