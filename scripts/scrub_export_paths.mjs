#!/usr/bin/env node
// Structurally remove the target repository path from completed Capsule exports.
import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (index !== -1 && (!value || value.startsWith("--"))) throw new Error(`Missing value for ${name}.`);
  return value;
}

function variants(roots) {
  return [...new Set(roots.flatMap((root) => [root, root.replaceAll("/", "\\"), root.replaceAll("\\", "/")]))].sort((a, b) => b.length - a.length);
}

function replaceString(value, paths) {
  for (const path of paths) {
    if (process.platform === "win32") {
      const expression = new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      value = value.replace(expression, "/project");
    } else {
      value = value.split(path).join("/project");
    }
  }
  return value;
}

function replace(value, paths) {
  if (typeof value === "string") return replaceString(value, paths);
  if (Array.isArray(value)) return value.map((item) => replace(item, paths));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [replaceString(key, paths), replace(item, paths)]));
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

function parse(path, content) {
  if (path.toLowerCase().endsWith(".json")) return { jsonl: false, value: JSON.parse(content) };
  const lines = content.split(/\r?\n/);
  const values = lines.filter((line) => line.trim()).map((line) => JSON.parse(line));
  return { jsonl: true, value: values };
}

function serialize(parsed, paths) {
  const value = replace(parsed.value, paths);
  const output = parsed.jsonl ? `${value.map((entry) => JSON.stringify(entry)).join("\n")}\n` : JSON.stringify(value);
  const decoded = parse(parsed.jsonl ? "output.jsonl" : "output.json", output);
  if (containsPath(decoded.value, paths)) throw new Error("Repository path remains after scrubbing.");
  return output;
}

function main() {
  const rootValue = optionValue("--root");
  const exportValue = optionValue("--export-dir");
  if (!rootValue || !exportValue) throw new Error("Usage: scrub_export_paths.mjs --root <repo> --export-dir <export>");
  if (!isAbsolute(rootValue) || !isAbsolute(exportValue)) throw new Error("Repository root and export directory must be absolute paths.");
  const root = resolve(rootValue);
  const exportDir = resolve(exportValue);
  if (!statSync(exportDir).isDirectory()) throw new Error("Export directory must exist.");
  const paths = variants([root, realpathSync.native(root)]);
  const staged = readdirSync(exportDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.jsonl?$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const path = join(exportDir, entry.name);
      const original = readFileSync(path, "utf8");
      return { path, original, output: serialize(parse(path, original), paths) };
    });
  for (const entry of staged) if (entry.output !== entry.original) writeFileSync(entry.path, entry.output);
  process.stdout.write(`${JSON.stringify({ files: staged.length, changed: staged.filter((entry) => entry.output !== entry.original).length, replacement: "/project" })}\n`);
}

try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
