// Tests scripts/anonymize_session.mjs for URL preservation, array-path masking, strict URI/email ordering, and Stage-2 redaction.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("../scripts/anonymize_session.mjs", import.meta.url));

test("anonymizes array-nested paths, secrets, git-SSH, UNC, and preserves public URLs and env-var names", () => {
  const work = mkdtempSync(join(tmpdir(), "session-curate-anon-"));
  try {
    const input = join(work, "in.jsonl");
    const output = join(work, "out.jsonl");
    const profile = join(work, "profile.json");
    writeFileSync(profile, JSON.stringify({
      user: "alice",
      home: "/home/alice",
      targetRoot: "/home/alice/repos/acme",
      gitUserName: "Alice Lin",
      gitUserEmail: "alice@acmecorp.io",
      gitRemoteOrg: "acmecorp",
    }));
    const lines = [
      {
        type: "user",
        sessionId: "s1",
        cwd: "/home/alice/repos/acme",
        message: {
          role: "user",
          content: 'Check https://github.com/endorhq/capsule and @endorhq/capsule; export ACME_TOKEN="secret_token_12345678" and ssh ops@10.20.30.40',
        },
      },
      {
        type: "assistant",
        sessionId: "s1",
        cwd: "/home/alice/repos/acme",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "secret thought" },
            {
              type: "tool_use",
              id: "t1",
              name: "bash",
              input: {
                paths: ["/home/alice/repos/acme/ROADMAP.md", "\\\\fileserver\\share\\alice\\budget.xlsx"],
                cmd: "git clone git@github.com:acmecorp/private-repo.git && git show a1b2c3d4 --stat 2>/dev/null",
              },
            },
          ],
        },
      },
    ];
    writeFileSync(input, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    execFileSync(process.execPath, [script, "--input", input, "--output", output, "--profile", profile]);
    const out = readFileSync(output, "utf8");
    const parsed = out.trim().split("\n").map((l) => JSON.parse(l));
    assert.match(parsed[0].message.content, /https:\/\/github\.com\/endorhq\/capsule/);
    assert.match(parsed[0].message.content, /@endorhq\/capsule/);
    assert.match(parsed[0].message.content, /export ACME_TOKEN="\[REDACTED\]"/);
    assert.match(parsed[0].message.content, /ssh user@10\.0\.0\.1/);
    assert.match(parsed[1].message.content[0].input.cmd, /ssh:\/\/git\.example\/user\/repo-1\.git/);
    assert.match(parsed[1].message.content[0].input.cmd, /2>\/dev\/null/);
    assert.equal(out.includes("secret_token_12345678"), false);
    assert.equal(out.includes("acmecorp"), false);
    assert.equal(out.includes("budget.xlsx"), false);
    assert.equal(out.includes("a1b2c3d4"), false);
    assert.equal(out.includes("secret thought"), false);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("redacts P1-2 blind-attacker classes: ICP, WeChat AppID, OAuth device-code/flow_id, cloud IDs, 40-char SHA, and CJK paths", () => {
  const work = mkdtempSync(join(tmpdir(), "session-curate-p1-3-"));
  try {
    const input = join(work, "in.jsonl");
    const output = join(work, "out.jsonl");
    const lines = [
      {
        type: "assistant",
        sessionId: "s2",
        cwd: "/home/dev/proj",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "bash",
              input: {
                cmd: 'aliyun --Description "闽ICP备19017454号-1" --ResourceGroupId rg-acfmzbpnzu54csi --RecordId 909285748641421312 && gh run view 41387939479 -R myorg/myrepo && lark-cli auth login --device-code "Ozw1nEAFlX8C3-hUTPLyIWjeqJObSaplGRO" && open "https://example.org/auth?flow_id=ONmNO_fXwriK0Vp&user_code=MF93-NV4H" && cat /home/dev/下载/private.wxa9665459b2a35cbb.key && echo fad664a0b63fc9630a18566acfac518769ab2811',
              },
            },
          ],
        },
      },
    ];
    writeFileSync(input, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    execFileSync(process.execPath, [script, "--input", input, "--output", output]);
    const out = readFileSync(output, "utf8");
    for (const secret of [
      "19017454",
      "rg-acfmzbpnzu54csi",
      "909285748641421312",
      "41387939479",
      "myorg/myrepo",
      "Ozw1nEAFlX8C3",
      "ONmNO_fXwriK0Vp",
      "MF93-NV4H",
      "wxa9665459b2a35cbb",
      "下载",
      "fad664a0b63fc9630a18566acfac518769ab2811",
    ]) {
      assert.equal(out.includes(secret), false, `Expected ${secret} to be redacted`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("anonymizes Codex JSONL (session_meta, response_item, JSON arguments) and strips Claude progress/toolUseResult", () => {
  const work = mkdtempSync(join(tmpdir(), "session-curate-codex-"));
  try {
    const input = join(work, "codex.jsonl");
    const output = join(work, "codex_out.jsonl");
    const lines = [
      { type: "session_meta", payload: { id: "c1", originator: "codex_cli", cwd: "/Users/admin/Documents/proj", git: { branch: "feat/secret", repository_url: "https://github.com/org/private.git" } } },
      { type: "response_item", payload: { type: "reasoning", text: "hidden thought" } },
      { type: "response_item", payload: { type: "function_call", name: "shell", arguments: JSON.stringify({ cmd: "cat /Users/admin/.env && echo sk-proj-codex1234567890abcdef" }) } },
      { type: "response_item", payload: { type: "function_call_output", output: "raw secret output" } },
      { type: "progress", data: { path: "/Users/admin/Documents/proj/leak.txt" } },
      { type: "event_msg", payload: { type: "token_count", total: 999 } },
    ];
    writeFileSync(input, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    execFileSync(process.execPath, [script, "--input", input, "--output", output]);
    const out = readFileSync(output, "utf8");
    assert.equal(out.includes("/Users/admin"), false);
    assert.equal(out.includes("codex1234567890abcdef"), false);
    assert.equal(out.includes("raw secret output"), false);
    assert.equal(out.includes("hidden thought"), false);
    assert.equal(out.includes("feat/secret"), false);
    assert.equal(out.includes("leak.txt"), false);
    assert.match(out, /\[removed\]/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("preserves hyphenated English words (task-notification, risk-assessment) and #!/usr/bin/env while redacting Supabase, public IPs, DDNS, and repo basename", () => {
  const work = mkdtempSync(join(tmpdir(), "session-curate-p2-2-"));
  try {
    const input = join(work, "in.jsonl");
    const output = join(work, "out.jsonl");
    const profile = join(work, "profile.json");
    writeFileSync(profile, JSON.stringify({ targetRoot: "/Users/admin/Documents/PhishingTrainingProgram" }));
    const lines = [
      {
        type: "user",
        sessionId: "p2",
        cwd: "/Users/admin/Documents/PhishingTrainingProgram",
        message: {
          role: "user",
          content: "Check </task-notification> and risk-assessment in PhishingTrainingProgram; #!/usr/bin/env node; https://zgbufaxooqxeabewktzd.supabase.co; ssh -o BatchMode=yes admin@47.88.13.118; qnfemkob.ipyingshe.net; cf-ray: a55fe6f35e23dfc2-IAD; keep 127.0.0.1",
        },
      },
    ];
    writeFileSync(input, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    execFileSync(process.execPath, [script, "--input", input, "--output", output, "--profile", profile]);
    const parsed = JSON.parse(readFileSync(output, "utf8").trim());
    const text = parsed.message.content;
    assert.match(text, /<\/task-notification>/);
    assert.match(text, /risk-assessment/);
    assert.match(text, /#!\/usr\/bin\/env node/);
    assert.match(text, /127\.0\.0\.1/);
    assert.equal(text.includes("PhishingTrainingProgram"), false);
    assert.equal(text.includes("zgbufaxooqxeabewktzd"), false);
    assert.equal(text.includes("47.88.13.118"), false);
    assert.equal(text.includes("qnfemkob.ipyingshe.net"), false);
    assert.equal(text.includes("a55fe6f35e23dfc2-IAD"), false);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
