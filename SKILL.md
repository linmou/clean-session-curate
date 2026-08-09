---
name: clean-session-curate
description: Create a local, anonymized, zipped export of current-project coding-agent sessions while preserving raw sources and choosing an evidence-based UX language.
---

# Session Curate

Create `session-export/` from sessions that can be proven to belong to the current Git repository. Raw source sessions are never changed.

## Discover

1. Resolve this skill directory. Before invoking its Node preparation script, check that Node.js 20+ and npm are available. If either is missing or Node is too old, inspect the OS and available package manager, show the user the exact version-satisfying installation command, and obtain approval before running it. Never install system software, request elevation, or run a system package-manager command without that approval.
2. Run `npm run build` in this skill directory. This checks Git and the platform archive tools (PowerShell `Compress-Archive` on Windows, or `zip` and `unzip` on Unix), automatically installs the locked repository-local Capsule dependency when needed, and runs all tests. Repository-local npm preparation needs no additional approval. If a system tool is missing, inspect the OS and package manager, show the exact installation command, ask once before running it, then rerun `npm run build`. Continue only after the build reports `environment: ready` and all tests pass. Set `TARGET_REPO` from `git rev-parse --show-toplevel`.
3. Determine the active harness and installed version from the current runtime, executable metadata, environment, configuration, or installed package information. Do not infer it from arbitrary home-directory files.
4. Compare the stored format with Capsule `1.0.0` support. A nominally supported harness with a newer incompatible format uses the conversion procedure below.
5. Run `node "<skill>/scripts/find_repo_sessions.mjs"` from `TARGET_REPO`. It recursively discovers compatible Claude Code, Codex, Copilot, and Gemini candidates under the current user's known roots. When OpenCode is installed, it also uses OpenCode's read-only `db path` command and a fixed `SELECT id, directory FROM session` query against its user store (normally `~/.local/share/opencode/opencode.db`). Each proven OpenCode result contains `agent: "opencode"`, the authoritative database `path`, and its `sessionId`. Missing or unreadable OpenCode data does not block native discovery. The command returns `repo`, sorted `sessions`, and aggregate `skipped`.
6. Gemini's Capsule format has `projectHash`, not a recoverable `cwd`; only an exact `sha256(TARGET_REPO)` match is provable. Exclude descendant Gemini launches.
7. Discovery is read-only. State the selected count, nonzero aggregate skipped count, Capsule's `Select all` cleaning, raw-source preservation, and whether conversion copies are needed. Then ask exactly once: `Found N current-project sessions. Create cleaned upload copies?`

## Unsupported Formats

Before approval, inspect the installed harness package/source. Then use official documentation, the official repository, and the release/tag matching the installed version to identify its authoritative session root, boundary, source format, and project-location mapping. Never infer ownership from conversation text, tool data, or arbitrary nested `cwd` fields. Exclude any candidate whose target ownership is not provable.

For discovered OpenCode records, treat the database path and `sessionId` as one logical source. After approval, run `opencode export <sessionId>` into the isolated temporary directory; never copy, edit, or package the database, WAL, or shared-memory files. Validate and convert that exported JSON through the same unsupported-format rules below.

After approval only, create one isolated temporary directory and record only files created there. Convert copies, never sources. Prefer the matching native Capsule format for a newer known harness; otherwise use the closest public event model, defaulting to Claude JSONL. Preserve event order, roles, timestamps, tool calls/results, text, and authoritative project location when representable; omit unmappable metadata. Use anonymous sequential IDs and a lowercase ASCII source-harness slug (`[a-z0-9-]`, reserved native names gain `-external`). Validate each conversion as accepted Capsule JSON/JSONL, export it with `Select all`, then delete only the authorized temporary files. Rehash raw sources before and after conversion; cleanup failure means the export is not ready.

## Export

1. Require `TARGET_REPO/session-export/` to be absent or empty. Process selected sources in sorted harness/path order with Capsule `1.0.0` by running `npm exec --prefix "<skill-dir>" -- capsule export "<source>"` from `TARGET_REPO`, choosing `Select all` in its anonymization menu.
2. Name outputs `<source-harness>_001.jsonl` or `.json`, with anonymous sequential numbering. Converted sessions retain their source-harness name, not the internal target format.
3. Run `node "<skill-dir>/scripts/scrub_export_paths.mjs" --root "$TARGET_REPO" --export-dir "$TARGET_REPO/session-export"`. It parses JSON and JSONL, replaces repository paths in decoded string values and object keys (including alternate separators), validates all staged results, and writes nothing if any export is malformed or retains a path variant.
4. Determine the UX language from the cleaned selected sessions, not from filenames, account settings, or repository metadata. Use the dominant natural language as a BCP-47 tag; use `und` when no language is clearly dominant. Capsule `1.0.0` has no UI-locale control, so record the tag for the upload/viewer in the manifest rather than claiming Capsule was localized.
5. Revalidate exports and raw hashes. Write `manifest.json` only after success:

```json
{"format_version":2,"session_count":0,"agents":{"claude":0,"codex":0,"copilot":0,"gemini":0},"ux_language":"und","cleaning":"capsule-select-all","capsule_version":"1.0.0"}
```

Replace counts and `ux_language` only. Add sanitized dynamic source-harness counters only for converted sessions; `session_count` equals every counter's sum. Never include paths, IDs, users, repository details, conversion paths, target formats, or URLs.
6. Run `node "<skill-dir>/scripts/package_export.mjs" --root "$TARGET_REPO" --export-dir "$TARGET_REPO/session-export" --output "$TARGET_REPO/session-export.zip"`. On Windows it uses PowerShell `Compress-Archive` and .NET ZIP validation; on Unix it uses `zip` and `unzip`. The archive sits next to, not inside, `session-export/`, and contains exactly contiguous numbered JSON/JSONL exports plus `manifest.json`. Never include raw sessions, conversion files, or the zip itself. Report readiness only after this command succeeds.
