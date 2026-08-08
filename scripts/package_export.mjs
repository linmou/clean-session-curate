#!/usr/bin/env node
// Package validated cleaned-session exports with the operating system's native ZIP tooling.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (index !== -1 && (!value || value.startsWith("--"))) throw new Error(`Missing value for ${name}.`);
  return value;
}

function parseExport(name, content) {
  if (!content.trim()) throw new Error("An export is empty.");
  if (name.toLowerCase().endsWith(".json")) {
    return JSON.parse(content);
  }
  return content.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

function pathVariants(root) {
  return [...new Set([root, root.replaceAll("/", "\\"), root.replaceAll("\\", "/")])];
}

function containsPath(value, paths) {
  if (typeof value === "string") {
    const candidate = process.platform === "win32" ? value.toLowerCase() : value;
    return paths.some((path) => candidate.includes(process.platform === "win32" ? path.toLowerCase() : path));
  }
  if (Array.isArray(value)) return value.some((item) => containsPath(item, paths));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => containsPath(key, paths) || containsPath(item, paths));
}

function validateSequences(exports) {
  const expected = new Map();
  for (const name of exports) {
    const [, harness, number] = name.match(/^([a-z0-9-]+)_(\d{3})\.jsonl?$/i);
    const key = harness.toLowerCase();
    const next = expected.get(key) ?? 1;
    if (Number(number) !== next) throw new Error("An export sequence is not contiguous.");
    expected.set(key, next + 1);
  }
}

function validatedMembers(exportDir, root) {
  const entries = readdirSync(exportDir, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) throw new Error("The export directory contains an unexpected entry.");
  const names = entries.map((entry) => entry.name).sort();
  const exports = names.filter((name) => /^[a-z0-9-]+_\d{3}\.jsonl?$/i.test(name));
  if (!names.includes("manifest.json") || names.length !== exports.length + 1) throw new Error("The export directory contains an unexpected file.");
  validateSequences(exports);
  const paths = pathVariants(root);
  for (const name of exports) {
    const content = readFileSync(join(exportDir, name), "utf8");
    if (containsPath(parseExport(name, content), paths)) throw new Error("Repository path remains in an export.");
  }
  const manifest = JSON.parse(readFileSync(join(exportDir, "manifest.json"), "utf8"));
  const count = Object.values(manifest.agents ?? {}).reduce((sum, value) => sum + value, 0);
  if (manifest.format_version !== 2 || manifest.session_count !== exports.length || count !== manifest.session_count || typeof manifest.ux_language !== "string") {
    throw new Error("The export manifest is inconsistent.");
  }
  return [...exports, "manifest.json"];
}

function powershell(command, environment, cwd) {
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function createArchive(members, output, exportDir) {
  if (process.platform === "win32") {
    const command = "$files = @(ConvertFrom-Json $env:SESSION_CURATE_FILES); Compress-Archive -LiteralPath $files -DestinationPath $env:SESSION_CURATE_OUTPUT -CompressionLevel Optimal";
    powershell(command, { SESSION_CURATE_FILES: JSON.stringify(members), SESSION_CURATE_OUTPUT: output }, exportDir);
    return "powershell";
  }
  execFileSync("zip", ["-q", output, ...members], { cwd: exportDir, stdio: "ignore" });
  return "zip";
}

function archiveMembers(output) {
  if (process.platform === "win32") {
    const command = "Add-Type -AssemblyName System.IO.Compression.FileSystem; $archive = [IO.Compression.ZipFile]::OpenRead($env:SESSION_CURATE_ARCHIVE); try { foreach ($entry in $archive.Entries) { $stream = $entry.Open(); try { $stream.CopyTo([IO.Stream]::Null) } finally { $stream.Dispose() } }; @($archive.Entries.FullName) | ConvertTo-Json -Compress } finally { $archive.Dispose() }";
    const result = powershell(command, { SESSION_CURATE_ARCHIVE: output }, dirname(output)).trim();
    return result ? [JSON.parse(result)].flat().sort() : [];
  }
  execFileSync("unzip", ["-tqq", output], { stdio: "ignore" });
  return execFileSync("unzip", ["-Z1", output], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\r?\n/).filter(Boolean).sort();
}

function main() {
  const rootValue = optionValue("--root");
  const exportValue = optionValue("--export-dir");
  const outputValue = optionValue("--output");
  if (!rootValue || !exportValue || !outputValue) throw new Error("Usage: package_export.mjs --root <repo> --export-dir <export> --output <zip>");
  if (![rootValue, exportValue, outputValue].every(isAbsolute)) throw new Error("All paths must be absolute.");
  const root = resolve(rootValue);
  const exportDir = resolve(exportValue);
  const output = resolve(outputValue);
  if (!statSync(exportDir).isDirectory() || output !== join(dirname(exportDir), "session-export.zip")) throw new Error("Invalid export or archive location.");
  if (existsSync(output)) throw new Error("The output archive already exists.");
  const members = validatedMembers(exportDir, root);
  try {
    const engine = createArchive(members, output, exportDir);
    if (JSON.stringify(archiveMembers(output)) !== JSON.stringify([...members].sort())) throw new Error("Archive members do not match the export set.");
    process.stdout.write(`${JSON.stringify({ archive: basename(output), engine, files: members.length, platform: process.platform })}\n`);
  } catch {
    if (existsSync(output)) unlinkSync(output);
    throw new Error("Native archive creation or validation failed.");
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
