#!/usr/bin/env node
// Tests scripts/prepare_environment.mjs for safe prerequisite checks and local dependency preparation.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/prepare_environment.mjs", import.meta.url));
const skillDir = dirname(dirname(script));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "prepare-environment-"));
  const scriptsDir = join(root, "scripts");
  cpSync(join(skillDir, "package-lock.json"), join(root, "package-lock.json"));
  cpSync(join(skillDir, "package.json"), join(root, "package.json"));
  cpSync(dirname(script), scriptsDir, { recursive: true });
  return { root, script: join(scriptsDir, basename(script)) };
}

function runFixture(args, options = {}) {
  const isolated = fixture();
  const result = spawnSync(process.execPath, [isolated.script, ...args], {
    cwd: tmpdir(),
    encoding: "utf8",
    ...options,
  });
  return { ...isolated, result };
}

function removeFixture(root) {
  rmSync(root, { recursive: true, force: true });
}

function writeCommand(directory, name, body) {
  if (process.platform === "win32") {
    const path = join(directory, `${name}.cmd`);
    writeFileSync(path, `@echo off\r\n${body}\r\n`);
    return path;
  }
  const path = join(directory, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

test("reports a ready environment without depending on the caller's working directory", () => {
  const result = spawnSync("node", [script, "--check-only"], { cwd: "/", encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /node: ok/i);
  assert.match(result.stdout, /git: ok/i);
  assert.match(result.stdout, process.platform === "win32" ? /powershell: ok/i : /zip: ok/i);
  assert.match(result.stdout, /capsule: installed/i);
  assert.match(result.stdout, /environment: ready/i);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(skillDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("rejects unknown preparation options instead of silently changing setup behavior", () => {
  const { root, result } = runFixture(["--not-a-real-option"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown option/i);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.equal(existsSync(join(root, "node_modules")), false);
  removeFixture(root);
});

test("prints help without checking or changing the environment", () => {
  const { root, result } = runFixture(["--help"], { env: { ...process.env, PATH: "" } });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /usage:/i);
  assert.match(result.stdout, /--check-only/);
  assert.equal(result.stderr, "");
  assert.equal(existsSync(join(root, "node_modules")), false);
  removeFixture(root);
});

test("check-only reports a missing dependency without changing the fixture", () => {
  const { root, result } = runFixture(["--check-only"]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /capsule: missing/i);
  assert.match(result.stdout, /environment: action required/i);
  assert.equal(existsSync(join(root, "node_modules")), false);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  removeFixture(root);
});

test("default setup uses npm ci with lifecycle scripts disabled and installs Capsule 1.0.0", { timeout: 120_000 }, () => {
  const isolated = fixture();
  const commandDir = mkdtempSync(join(tmpdir(), "prepare-npm-"));
  const packagePath = join(isolated.root, "package.json");
  const marker = join(isolated.root, "install-script-ran");
  const npmArgs = join(isolated.root, "npm-args");
  const npmExecutable = process.platform === "win32"
    ? spawnSync("where.exe", ["npm.cmd"], { encoding: "utf8" }).stdout.trim().split(/\r?\n/)[0]
    : spawnSync("sh", ["-c", "command -v npm"], { encoding: "utf8" }).stdout.trim();
  assert.notEqual(npmExecutable, "", "the integration test requires the real npm executable");
  const forwardingCommand = process.platform === "win32"
    ? `echo %*>"${npmArgs}"\r\ncall "${npmExecutable}" %*`
    : `printf '%s\\n' "$@" > "${npmArgs}"\nexec "${npmExecutable}" "$@"`;
  writeCommand(commandDir, "npm", forwardingCommand);
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  packageJson.scripts.install = `node -e \"require('node:fs').writeFileSync('install-script-ran','yes')\"`;
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const result = spawnSync(process.execPath, [isolated.script], {
    cwd: tmpdir(),
    encoding: "utf8",
    env: { ...process.env, PATH: `${commandDir}${delimiter}${process.env.PATH}` },
    timeout: 110_000,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(npmArgs, "utf8").trim().split(/\s+/), ["ci", "--ignore-scripts"]);
  assert.equal(JSON.parse(readFileSync(join(isolated.root, "node_modules/@endorhq/capsule/package.json"), "utf8")).version, "1.0.0");
  assert.equal(existsSync(marker), false, "npm lifecycle scripts must remain disabled");
  assert.match(result.stdout, /capsule: installed/i);
  assert.match(result.stdout, /environment: ready/i);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(isolated.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  removeFixture(commandDir);
  removeFixture(isolated.root);
});

test("missing system prerequisites stop before npm installation", () => {
  const isolated = fixture();
  const commandDir = mkdtempSync(join(tmpdir(), "prepare-commands-"));
  const npmMarker = join(isolated.root, "npm-ran");
  const npmMarkerCommand = process.platform === "win32"
    ? `if "%1"=="ci" echo yes>"${npmMarker}"`
    : `[ "$1" = "ci" ] && printf yes > "${npmMarker}"\nexit 0`;
  writeCommand(commandDir, "npm", npmMarkerCommand);
  if (process.platform === "win32") {
    const powershell = spawnSync("where.exe", ["powershell.exe"], { encoding: "utf8" }).stdout.trim().split(/\r?\n/)[0];
    const path = [commandDir, powershell ? dirname(powershell) : ""].filter(Boolean).join(delimiter);
    const result = spawnSync(process.execPath, [isolated.script], { encoding: "utf8", env: { ...process.env, PATH: path } });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /git: missing/i);
    assert.equal(existsSync(npmMarker), false);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(isolated.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  } else {
    writeCommand(commandDir, "zip", "exit 0");
    writeCommand(commandDir, "unzip", "exit 0");
    const result = spawnSync(process.execPath, [isolated.script], { encoding: "utf8", env: { ...process.env, PATH: commandDir } });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /git: missing/i);
    assert.equal(existsSync(npmMarker), false);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(isolated.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  removeFixture(commandDir);
  removeFixture(isolated.root);
});
