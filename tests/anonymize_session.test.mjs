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
    assert.match(out, /https:\/\/github\.com\/endorhq\/capsule/);
    assert.match(out, /@endorhq\/capsule/);
    assert.match(out, /export ACME_TOKEN="\[REDACTED\]"/);
    assert.match(out, /ssh user@10\.0\.0\.1/);
    assert.match(out, /ssh:\/\/git\.example\/user\/repo-1\.git/);
    assert.match(out, /2>\/dev\/null/);
    assert.equal(out.includes("secret_token_12345678"), false);
    assert.equal(out.includes("acmecorp"), false);
    assert.equal(out.includes("budget.xlsx"), false);
    assert.equal(out.includes("a1b2c3d4"), false);
    assert.equal(out.includes("secret thought"), false);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
