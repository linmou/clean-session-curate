<!-- Intent: Explain installation, operation, privacy boundaries, and verification in English. The Chinese default version is README.md. Updated: 2026-08-09. Implementation commit: 24866af. -->

# Clean Session Curate

[中文](README.md) | English

Create a local, anonymized, upload-ready archive of coding-agent sessions that can be proven to belong to a selected target folder. The folder does not need to be a Git repository.

## What It Does

- Discovers sessions from Agent Harness systems. Native Capsule `1.0.0` formats include Claude Code, Codex, Copilot, and Gemini.
- When OpenCode is installed, discovers target-folder sessions through its read-only database commands. Each result keeps the shared database path plus a distinct `sessionId`; the database and WAL files are not read directly, copied, or changed.
- Uses the open-source [Capsule](https://github.com/endorhq/capsule) `1.0.0` CLI, licensed under Apache-2.0, to anonymize a copy of each session.
- Capsule's `Select all` choice replaces file paths and Git identity. For example, `/Users/alice/project/src/app.ts` becomes `/project/src/file1.ts`, a private branch becomes `branch-1`, and a repository URL becomes `https://github.com/user/repo-1.git`.
- The same choice removes tool outputs, file contents, thinking blocks, system messages, and token-usage metadata.
- Capsule does not claim to detect arbitrary secrets or personal data written into ordinary conversation text. The workflow additionally scrubs both lexical and canonical target-folder path variants from decoded JSON/JSONL values and object keys, including alternate separators and Windows case variants, then validates cleaned exports before creating the ZIP.
- OpenCode and other non-native formats follow the documented `Unsupported Formats` conversion workflow: after approval, `opencode export <sessionId>` writes JSON into the isolated temporary directory, then that copy is converted into a format this skill can process. The raw database is never changed or packaged.
- Produces the cleaned ZIP archive.

## Install With an AI Agent

Give the following request to Codex, Claude Code, or OpenCode. The agent clones this skill as `clean-session-curate` in the documented user-level skill directory and runs `npm run build`. That command checks the environment, automatically installs the pinned repository-local Capsule dependency when needed, and runs every test. No standalone installer or binary is needed.

```text
Install this skill from https://github.com/linmou/clean-session-curate.git in your user-level skills directory, run its build, and report whether it is ready.
```

Common user-level locations are `$CODEX_HOME/skills` (normally `~/.codex/skills`) for Codex, `~/.claude/skills` for Claude Code, and `~/.config/opencode/skills` for OpenCode. The agent should follow its current official documentation when a configured location differs.

Repository-local npm preparation is automatic. Installing or upgrading Node.js, ZIP tools, Homebrew, or any other system software is different: the agent must show the exact command and obtain your approval before running it. Git is optional and is used only to suggest the current repository as a target folder.

## Use

You can specify any existing directory when invoking the skill. When Git is available and the current directory belongs to a repository, the skill asks whether to use that repository as the target folder.

```text
Use $clean-session-curate to prepare coding-agent sessions in <target-folder> for upload.
```

## Requirements

- Windows 10/11: Node.js 20 or later and Windows PowerShell with `Compress-Archive`.
- Linux/macOS: Node.js 20 or later, `zip`, and `unzip`.
- All platforms: npm and pinned Capsule `1.0.0`; `npm run build` installs the local dependency automatically when needed.

## Output

After validation, the target folder contains:

```text
session-export/
  <harness>_001.jsonl
  ...
  manifest.json
session-export.zip
```

`manifest.json` records only format version, session counts, sanitized harness counts, `ux_language`, the cleaning method, and Capsule version. The ZIP contains exactly the numbered exports and the manifest.

## Privacy Boundary

Raw session sources are never changed, placed in the export directory, or added to the ZIP. Candidates whose target-folder ownership cannot be proven are excluded. The workflow checks that raw hashes are unchanged and that target-path forms do not remain in the final exports or archive.

## UX Language

Capsule `1.0.0` has no supported interface-locale option. The skill therefore writes the dominant cleaned-session language as `ux_language` for the upload consumer or viewer; it does not claim to localize Capsule itself. Use `und` when the dominant language cannot be established.

## Verify

```shell
npm run build
```

Here, “build” means prepare and verify; it does not create a binary or distributable. The test suite covers optional-Git environment preparation, explicit non-Git target selection, native and OpenCode target/descendant filtering, exact Gemini hashing, invalid target errors, raw-source preservation, JSON/JSONL path scrubbing, contiguous anonymous names, archive membership, and archive integrity. GitHub Actions runs this novice workflow from a fresh checkout on `ubuntu-latest`, `windows-latest`, and `macos-latest`. Final archive creation uses the same tested command on every platform:

```text
node "<skill-dir>/scripts/package_export.mjs" --root "<target-folder>" --export-dir "<target-folder>/session-export" --output "<target-folder>/session-export.zip"
```

The command uses PowerShell on Windows and `zip`/`unzip` on Unix, validates exact members and integrity, and removes a partial archive if native creation or validation fails.

## Privacy Note

Privacy expectations differ from person to person, so this workflow and Capsule cannot guarantee that every piece of private information is completely anonymized. When the export is sensitive or the privacy boundary is strict, ask an Agent to perform an additional independent privacy review before sharing it.
