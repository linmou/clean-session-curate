#!/usr/bin/env node
// Select Capsule-compatible current-repository sessions without modifying source files.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const SESSION_ROOTS = [
  ["claude", ".claude/projects"],
  ["codex", ".codex/sessions"],
  ["copilot", ".copilot/session-state"],
  ["gemini", ".gemini/tmp"],
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

function execGit(args, options) {
  try {
    return execFileSync("git", args, options);
  } catch (error) {
    if (process.platform !== "win32" || error?.code !== "ENOENT") throw error;
    return execCommand("git", args, options);
  }
}

function gitRoot() {
  try {
    return execGit(["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new Error("Current directory is not inside a Git repository.");
  }
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

function isInsideRepository(candidate, repo) {
  if (typeof candidate !== "string") return false;
  const relation = relative(repo, resolve(candidate));
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
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

function geminiMatches(path, repo) {
  const root = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(root?.messages) && root.projectHash === createHash("sha256").update(repo).digest("hex");
}

function selectCandidate(agent, path, repo) {
  if (agent === "gemini") return geminiMatches(path, repo);
  const records = jsonLines(path);
  const cwd = agent === "claude" ? claudeCwd(records) : agent === "codex" ? codexCwd(records) : copilotCwd(records);
  return isInsideRepository(cwd, repo);
}

function openCodeSessions(repo) {
  try {
    const options = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
    const queryOptions = { ...options, maxBuffer: 64 * 1024 * 1024 };
    const path = execCommand("opencode", ["db", "path"], options).trim();
    const rows = JSON.parse(execCommand("opencode", ["db", "SELECT id, directory FROM session", "--format", "json"], queryOptions));
    if (!path || !Array.isArray(rows)) return { sessions: [], skipped: 0 };
    const sessions = [];
    let skipped = 0;
    for (const row of rows) {
      if (typeof row?.id === "string" && row.id && isInsideRepository(row.directory, repo)) {
        sessions.push({ agent: "opencode", path, sessionId: row.id });
      } else {
        skipped += 1;
      }
    }
    return { sessions, skipped };
  } catch (error) {
    if (error?.code === "ENOBUFS") process.stderr.write("OpenCode session query exceeded the 64 MiB maxBuffer (ENOBUFS); skipping OpenCode sessions.\n");
    return { sessions: [], skipped: 0 };
  }
}

function main() {
  const repo = resolve(gitRoot());
  const home = resolve(optionValue("--home") ?? homedir());
  let skipped = 0;
  const sessions = [];
  for (const [agent, root] of SESSION_ROOTS) {
    for (const path of sessionFiles(join(home, root))) {
      try {
        if (selectCandidate(agent, path, repo)) sessions.push({ agent, path });
        else skipped += 1;
      } catch {
        skipped += 1;
      }
    }
  }
  const openCode = openCodeSessions(repo);
  sessions.push(...openCode.sessions);
  skipped += openCode.skipped;
  sessions.sort((left, right) => left.agent.localeCompare(right.agent) || left.path.localeCompare(right.path) || (left.sessionId ?? "").localeCompare(right.sessionId ?? ""));
  process.stdout.write(`${JSON.stringify({ repo, sessions, skipped })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
