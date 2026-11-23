# `clean-session-curate` v0.2.0 — Zero-Leak 4-Pass Sharded Multi-Agent Pipeline

## Highlights
- **Zero-Leak 4-Pass Hybrid Export Pipeline (`SKILL.md`):**
  - **Pass 1 (Deterministic AST Scrub):** Non-interactive `scripts/anonymize_session.mjs` strips `thinking`, `system`, `progress`, `session-owner`, `tool_result`, `toolUseResult`, and provider/account UUIDs, and scrubs array-nested paths, CJK paths, secrets, OAuth/ICP/WeChat/cloud IDs, `@handles`, `Git user:`, and commit SHAs while preserving public OSS URLs and POSIX binaries.
  - **Pass 2 (Sharded Multi-Agent Privacy Hunter + Merger):** `scripts/chunk_for_hunter.mjs` partitions Pass-1 exports into overlapping `max(20%, 20 KB)` shards (`10%` overlap, splitting oversized JSONL lines) for parallel read-only Hunter agents + 1 Merger agent.
  - **Pass 3 (Deterministic AST `--terms`):** Longest-first literal redaction across the parsed JSONL AST with ASCII alphanumeric boundary guards (preventing substring corruption like `PSU` → `capsule`).
  - **Pass 4 (Fresh Blind Privacy Verifier Gate):** Blocks ZIP packaging until a fresh blind verifier reports `0` Critical and `0` High leaks.
- **OpenCode v2 & `pi` Support (`scripts/find_repo_sessions.mjs`):**
  - Read-only SQLite fallback (`file:...?mode=ro&immutable=1` + `python3` fallback) so `opencode.db` / `-wal` / `-shm` are never mutated.
  - Native `pi` session discovery.
- **Licensing:** Added `Apache-2.0` `LICENSE`.
- **Technical Report:** Published under `docs/` (ready for GitHub Pages at `/docs`).

## Verified Results (`26/26` Unit Tests Passing)
- **Phase 1 (Track B0 + 20 public traces):** `51/55` → `0/63` fragment leaks, `0/3` → `3/3` OpenCode v2 discovered (`db/wal/shm` unchanged), `40%` → `0%` benign FPR.
- **Holdout A1 (12 local Claude/Codex traces):** `Critical` → `PASS` (`reid_risk: Low`, `0` Critical/High/Medium, `12/12` raw SHA-256 unchanged).
- **Holdout A2 (9 `quanttide-agent-lab` OpenCode/`pi` traces):** `Critical` → `PASS` (`reid_risk: None`, `0` findings across all severities).
- **Strictly Uncontaminated Holdout #3 (10 brand-new local Claude/Codex traces, 5.76 MB, 6 disjoint projects, frozen skill):** **First-Shot `PASS`** (`0` Critical / `0` High / `0` Medium, `utility_intact: true`, `10/10` raw SHA-256 unchanged, `0` invalid JSON lines).
