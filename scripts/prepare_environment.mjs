#!/usr/bin/env node
// Prepares this skill's pinned local dependency after verifying required system tools.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CAPSULE_VERSION = "1.0.0";
const skillDir = dirname(dirname(fileURLToPath(import.meta.url)));
const usage = "Usage: node scripts/prepare_environment.mjs [--check-only|--help]";

function commandWorks(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "ignore" });
  return result.status === 0;
}

function report(name, ready) {
  console.log(`${name}: ${ready ? "ok" : "missing"}`);
  return ready;
}

function capsuleVersion() {
  try {
    const packageJson = readFileSync(join(skillDir, "node_modules", "@endorhq", "capsule", "package.json"), "utf8");
    return JSON.parse(packageJson).version;
  } catch {
    return null;
  }
}

function checkSystem() {
  const checks = [];
  checks.push(report("node", Number(process.versions.node.split(".")[0]) >= 20));
  checks.push(report("npm", commandWorks("npm", ["--version"])));
  checks.push(report("git", commandWorks("git", ["--version"])));

  if (process.platform === "win32") {
    checks.push(report("powershell", commandWorks("powershell.exe", [
      "-NoProfile",
      "-Command",
      "if (Get-Command Compress-Archive -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }",
    ])));
  } else {
    checks.push(report("zip", commandWorks("zip", ["--version"])));
    checks.push(report("unzip", commandWorks("unzip", ["-v"])));
  }

  return checks.every(Boolean);
}

function parseArguments(args) {
  if (args.length === 0) return { checkOnly: false };
  if (args.length === 1 && args[0] === "--check-only") return { checkOnly: true };
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const unknown = args.find((arg) => !["--check-only", "--help"].includes(arg));
  console.error(unknown ? `Unknown option: ${unknown}` : "Options cannot be combined.");
  console.error(usage);
  return null;
}

function finish(ready) {
  console.log(`environment: ${ready ? "ready" : "action required"}`);
  return ready ? 0 : 1;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) return 2;
  if (options.help) {
    console.log(usage);
    console.log("  --check-only  Check without installing local dependencies.");
    console.log("  --help        Show this help.");
    return 0;
  }

  const systemReady = checkSystem();
  const installedVersion = capsuleVersion();
  console.log(`capsule: ${installedVersion === CAPSULE_VERSION ? "installed" : installedVersion ? "wrong version" : "missing"}`);

  if (!systemReady || options.checkOnly) {
    return finish(systemReady && installedVersion === CAPSULE_VERSION);
  }
  if (installedVersion === CAPSULE_VERSION) return finish(true);

  const install = spawnSync("npm", ["ci", "--ignore-scripts"], {
    cwd: skillDir,
    encoding: "utf8",
    stdio: "ignore",
  });
  if (install.status !== 0 || capsuleVersion() !== CAPSULE_VERSION) {
    console.log("capsule: installation failed");
    return finish(false);
  }

  console.log("capsule: installed");
  return finish(true);
}

process.exitCode = main();
