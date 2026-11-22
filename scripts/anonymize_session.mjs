#!/usr/bin/env node
// Non-interactive, URL-guarded, array-safe session anonymizer + AST-level Stage-2 scrubber
// with Dynamic Local Profile and strict rule ordering (structured URIs before generic emails).

import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";

const GENERIC_DENYLIST = new Set([
  "admin", "root", "user", "dev", "ubuntu", "ec2-user",
  "main", "test", "app", "src", "docs",
]);
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "outlook.com", "hotmail.com", "yahoo.com",
  "qq.com", "163.com", "icloud.com", "users.noreply.github.com",
  "example.com", "example.org",
]);

function optionValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildStage2Rules(profile) {
  const rules = [
    // 1. Structured URIs & git-SSH FIRST (before generic email regex to prevent partial-leak collisions!)
    [/(https?:\/\/)[^\/\s:@]+:[^\/\s@]+@[^\s"'<>)\]]+/gi, "$1[REDACTED]@example.com/repo.git"],
    [/git@[A-Za-z0-9.-]+:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?/g, "ssh://git.example/user/repo-1.git"],
    [/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9\-]+/g, "[REDACTED_WEBHOOK]"],
    // 2. Secrets, tokens, JWTs, PEM keys, env assignments
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_KEY]"],
    [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]"],
    [/sk-(?:proj-|live-|pi-)?[A-Za-z0-9_\-]{8,}/g, "[REDACTED]"],
    [/ghp_[A-Za-z0-9]{16,}/g, "[REDACTED]"],
    [/github_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED]"],
    [/AKIA[0-9A-Z]{12,}/g, "[REDACTED]"],
    [/LTAI[A-Za-z0-9]{12,}/g, "[REDACTED]"],
    [/AKID[A-Za-z0-9]{12,}/g, "[REDACTED]"],
    [/xox[baprs]-[A-Za-z0-9\-]{10,}/g, "[REDACTED]"],
    [/Bearer\s+[A-Za-z0-9._\-]{12,}/g, "Bearer [REDACTED]"],
    [/\b([A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PASSWD)\s*=\s*["']?)([^"'\s]{8,})(["']?)/g, "$1[REDACTED]$3"],
    // 2b. CLI OAuth device-code / flow_id / user_code / message-ids & Chinese ICP / WeChat AppID
    [/(--device-code\s+["']?)[A-Za-z0-9._\-]{16,}(["']?)/g, "$1[REDACTED_CODE]$2"],
    [/([?&](?:flow_id|user_code)=)[^&\s"'<>)\]]+/gi, "$1[REDACTED]"],
    [/(--message-ids\s+["']?)[A-Za-z0-9+/=,_ -]{20,}(["']?)/g, "$1[REDACTED_IDS]$2"],
    [/[\u4e00-\u9fa5]ICP备\d{6,10}号(?:-\d+)?/g, "[REDACTED_ICP]"],
    [/\bwx[0-9a-f]{16}\b/g, "[REDACTED_WX_APPID]"],
    // 2c. Cloud infra IDs (Aliyun ResourceGroupId / RecordId / ConfigId / CertId) & GitHub Actions run IDs
    [/\brg-[a-z0-9]{10,}\b/g, "[REDACTED_RG_ID]"],
    [/(--(?:RecordId|ConfigId|CertId)\s+)\d{6,}/g, "$1000000"],
    [/\b(gh\s+run\s+(?:view|watch|rerun|cancel)\s+)\d{6,}/g, "$1000000"],
    [/(\s-R\s+)(?:\[REDACTED_ORG_IDENT\]|[A-Za-z0-9_.-]+)\/[A-Za-z0-9_.-]+/g, "$1user/repo-1"],
    // 2d. Standalone 40-char full Git commit SHAs (hex with both letters and digits)
    [/\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{40}\b/g, "0000000000000000000000000000000000000000"],
    // 3. URL-encoded emails & home paths
    [/[A-Za-z0-9._%+-]+%40[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi, "[REDACTED_EMAIL]"],
    [/%2F(?:home|Users)%2F[A-Za-z0-9._-]+(?:%2F[^\s"'&<>)]*)?/gi, "%2Fhome%2Fuser"],
    // 4. Generic emails
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]"],
    // 5. Cloud buckets & provider hosts
    [/(?:[A-Za-z0-9\-]+\.)*oss-cn-[a-z0-9\-]+\.aliyuncs\.com/g, "oss.example.com"],
    [/(?:[A-Za-z0-9\-]+\.)*[a-z0-9\-]+\.amazonaws\.com/g, "cloud.example.com"],
    [/oss:\/\/(?!bucket\b)[a-z0-9][a-z0-9.\-]*/gi, "oss://bucket"],
    [/s3:\/\/(?!bucket\b)[a-z0-9][a-z0-9.\-]*/gi, "s3://bucket"],
    // 6. GitHub CLI org/repo args, SSH login usernames & git commit SHAs
    [/\b(gh\s+repo\s+(?:view|create|clone|delete|edit)\s+)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/g, "$1user/repo-1"],
    [/\b(gh\s+repo\s+list\s+)[A-Za-z0-9_.-]+/g, "$1user"],
    [/\b(ssh\s+(?:-[A-Za-z0-9]+\s+)*)[A-Za-z0-9._-]+@([A-Za-z0-9._-]+)/g, "$1user@$2"],
    [/\b(git\s+(?:show|checkout|cherry-pick|revert|reset\s+--hard)\s+)[0-9a-f]{7,40}\b/gi, "$10000000"],
    // 7. Private RFC-1918 IPv4 addresses (preserving 127.0.0.1)
    [/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g, "10.0.0.1"],
    // 8. Generic OS home / WSL / UNC paths (case-insensitive for Windows)
    [/\/mnt\/[a-z]\/Users\/[A-Za-z0-9._-]+/gi, "/mnt/c/Users/user"],
    [/\/(?:home|Users)\/[A-Za-z0-9._-]+/g, "/home/user"],
    [/[A-Za-z]:\\Users\\[A-Za-z0-9._-]+(?:\\[^\s"'<>)\]]*)?/gi, "/home/user/file"],
    [/\\\\[A-Za-z0-9._-]+\\[A-Za-z0-9._$-]+(?:\\[^\s"'<>)\]]*)?/g, "/network/share/file"],
  ];

  // Dynamic Local Profile (workspace + OS metadata, guarded against generic words)
  if (profile) {
    if (profile.targetRoot) {
      const variants = [...new Set([profile.targetRoot, profile.targetRoot.replaceAll("/", "\\"), profile.targetRoot.replaceAll("\\", "/")])].sort((a, b) => b.length - a.length);
      for (const v of variants) rules.push([new RegExp(escapeRe(v), "gi"), "/project"]);
    }
    if (profile.home) {
      const variants = [...new Set([profile.home, profile.home.replaceAll("/", "\\"), profile.home.replaceAll("\\", "/")])].sort((a, b) => b.length - a.length);
      for (const v of variants) rules.push([new RegExp(escapeRe(v), "gi"), "/home/user"]);
    }
    if (profile.gitUserName && profile.gitUserName.length >= 3) {
      rules.push([new RegExp(escapeRe(profile.gitUserName), "gi"), "[REDACTED_NAME]"]);
      if (profile.gitUserName.includes(" ")) {
        rules.push([new RegExp(profile.gitUserName.trim().split(/\s+/).map(escapeRe).join("[._\\s-]"), "gi"), "[REDACTED_NAME]"]);
      }
    }
    if (profile.gitUserEmail && profile.gitUserEmail.includes("@")) {
      const [localPart, domain] = profile.gitUserEmail.split("@");
      if (localPart && localPart.length >= 4 && !GENERIC_DENYLIST.has(localPart.toLowerCase())) {
        rules.push([new RegExp(escapeRe(localPart), "gi"), "[REDACTED_USER]"]);
      }
      if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain.toLowerCase())) {
        const rootLabel = domain.split(".")[0];
        rules.push([new RegExp(`(?:[A-Za-z0-9\\-]+\\.)*${escapeRe(rootLabel)}\\.[a-z]{2,10}`, "gi"), "example.com"]);
        if (rootLabel.length >= 5 && !GENERIC_DENYLIST.has(rootLabel.toLowerCase())) {
          // Only preserve ALL_CAPS_ENV_VAR= names; still redact lowercase org identifiers
          rules.push([new RegExp(`(?<!export\\s+)[A-Za-z0-9_-]*${escapeRe(rootLabel)}[A-Za-z0-9_-]*(?!\\s*=)`, "gi"), "[REDACTED_ORG_IDENT]"]);
        }
      }
    }
    if (profile.gitRemoteOrg && profile.gitRemoteOrg.length >= 4 && !GENERIC_DENYLIST.has(profile.gitRemoteOrg.toLowerCase())) {
      rules.push([new RegExp(`${escapeRe(profile.gitRemoteOrg)}/[A-Za-z0-9_.-]+`, "gi"), "user/repo-1"]);
      rules.push([new RegExp(`[a-z0-9_-]*${escapeRe(profile.gitRemoteOrg.toLowerCase())}[a-z0-9_-]*`, "g"), "[REDACTED_ORG_IDENT]"]);
    }
    if (profile.user && profile.user.length >= 4 && !GENERIC_DENYLIST.has(profile.user.toLowerCase())) {
      rules.push([new RegExp(`(?<=\\/|\\\\|@)${escapeRe(profile.user)}(?=\\/|\\\\|\\b)`, "gi"), "user"]);
    }
  }
  return rules;
}

// Base64 secret decoder (consumes trailing '=' padding cleanly without \b bug!)
function redactBase64Secrets(text) {
  return text.replace(/(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{16,}={0,2}(?![A-Za-z0-9+/=])/g, (tok) => {
    try {
      const dec = Buffer.from(tok, "base64").toString("utf8");
      if (/^(?:sk-|ghp_|github_pat_|AKIA|LTAI|xox[baprs]-|-----BEGIN )/.test(dec)) {
        return "[REDACTED_ENCODED]";
      }
    } catch {
      // ignore
    }
    return tok;
  });
}

function anonymizeAndScrub(jsonlContent, profile) {
  const pathMap = new Map();
  let counter = 1;
  const maskPath = (p) => {
    if (pathMap.has(p)) return pathMap.get(p);
    const masked = `/project/src/file${counter++}${extname(p)}`;
    pathMap.set(p, masked);
    return masked;
  };

  // URL-guarded path masking (preserves https?://, ssh://, @scope/pkg, and /dev/null!)
  const maskInString = (text) => {
    if (!text) return text;
    const guards = [];
    let safe = text.replace(/(?:https?|ssh):\/\/[^\s"'<>)\]]+|@[a-z0-9-]+\/[a-z0-9-]+|\/dev\/null\b/gi, (u) => {
      const key = `__GUARD_${guards.length}__`;
      guards.push(u);
      return key;
    });
    // Unicode-aware POSIX path segments (catches CJK dirs like /下载/private.key!)
    const pathRegex = /(?:\/[\p{L}\p{N}._@-]+){2,}|~\/[\p{L}\p{N}._@/-]+|[A-Za-z]:\\[-\p{L}\p{N}_.\\]+|\\\\[\w.-]+\\[\w.$-]+(?:\\[^\s"'<>)\]]*)?/gu;
    for (const m of safe.matchAll(pathRegex)) maskPath(m[0]);
    for (const [orig, masked] of [...pathMap.entries()].sort((a, b) => b[0].length - a[0].length)) {
      safe = safe.replaceAll(orig, masked);
    }
    guards.forEach((u, i) => {
      safe = safe.replace(`__GUARD_${i}__`, u);
    });
    return safe;
  };

  const stage2Rules = buildStage2Rules(profile);
  const scrubStage2 = (str) => {
    let out = str;
    for (const [re, rep] of stage2Rules) {
      re.lastIndex = 0;
      out = out.replace(re, rep);
    }
    return redactBase64Secrets(out);
  };

  // Recursive AST walker (objects + arrays!)
  const deepMaskAndScrub = (val, applyPathMask) => {
    if (typeof val === "string") {
      // Run Stage-2 structured URI/secret rules BEFORE path masking so URLs/secrets are cleanly caught
      let s = scrubStage2(val);
      if (applyPathMask) {
        s = s.startsWith("/") || s.startsWith("~") || /^[A-Za-z]:\\/.test(s) ? maskPath(s) : maskInString(s);
      }
      return scrubStage2(s);
    }
    if (Array.isArray(val)) return val.map((item) => deepMaskAndScrub(item, applyPathMask));
    if (val && typeof val === "object") {
      return Object.fromEntries(
        Object.entries(val).map(([k, v]) => [scrubStage2(k), deepMaskAndScrub(v, applyPathMask)])
      );
    }
    return val;
  };

  const outLines = [];
  for (const line of jsonlContent.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    if (entry.type === "system" || entry.type === "file-history-snapshot") continue;
    if (entry.message?.usage) delete entry.message.usage;
    if (typeof entry.cwd === "string") entry.cwd = maskPath(entry.cwd);
    if (entry.type === "assistant" && Array.isArray(entry.message?.content)) {
      entry.message.content = entry.message.content
        .filter((b) => b.type !== "thinking")
        .map((b) => {
          if (b.type === "tool_use" && b.input) b.input = deepMaskAndScrub(b.input, true);
          if (b.type === "text" && typeof b.text === "string") b.text = deepMaskAndScrub(b.text, true);
          return b;
        });
    }
    if (entry.type === "user" && entry.message) {
      if (typeof entry.message.content === "string") {
        entry.message.content = deepMaskAndScrub(entry.message.content, true);
      } else if (Array.isArray(entry.message.content)) {
        entry.message.content = entry.message.content.map((b) =>
          b.type === "tool_result" ? { ...b, content: "[removed]" } : deepMaskAndScrub(b, true)
        );
      }
    }
    outLines.push(JSON.stringify(entry));
  }
  return `${outLines.join("\n")}\n`;
}

function main() {
  const input = optionValue("--input");
  const output = optionValue("--output");
  const profilePath = optionValue("--profile");
  if (!input || !output) throw new Error("Usage: anonymize_session.mjs --input <in.jsonl> --output <out.jsonl> [--profile <profile.json>]");
  const profile = profilePath ? JSON.parse(readFileSync(profilePath, "utf8")) : null;
  const cleaned = anonymizeAndScrub(readFileSync(input, "utf8"), profile);
  writeFileSync(output, cleaned);
}

main();
