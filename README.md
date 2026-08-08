<!-- Intent: Explain installation, operation, privacy boundaries, and verification in English and Chinese. Updated: 2026-08-08. Commit: recorded in Git history. -->

# Clean Session Curate / 会话清理与打包

Create a local, anonymized, upload-ready archive of coding-agent sessions that can be proven to belong to the current Git repository.

创建本地匿名、可上传的编程智能体会话归档；只导出能够证明属于当前 Git 仓库的会话。

## What It Does / 功能

- Discovers Capsule `1.0.0` compatible Claude Code, Codex, Copilot, and Gemini sessions.
- Validates each harness's structural project-ownership field before selection.
- Requires one explicit approval before creating exports.
- Uses Capsule's built-in `Select all` anonymization choice.
- Structurally removes repository-path variants from JSON and JSONL exports.
- Writes anonymous sequential filenames, a minimal manifest, and a final ZIP archive.
- Derives an evidence-based BCP-47 `ux_language` tag from cleaned session content.

- 发现与 Capsule `1.0.0` 兼容的 Claude Code、Codex、Copilot 和 Gemini 会话。
- 在选择前验证各智能体格式中权威的项目归属字段。
- 仅在获得一次明确批准后创建导出文件。
- 使用 Capsule 内置的 `Select all` 匿名化选项。
- 以结构化方式清除 JSON 和 JSONL 导出中的仓库路径变体。
- 创建匿名连续文件名、最小化清单和最终 ZIP 归档。
- 根据清理后的会话内容确定 BCP-47 `ux_language` 标签。

## Use / 使用

Run the skill from the target Git repository. It performs read-only discovery first and asks exactly once before it creates `session-export/`.

在目标 Git 仓库中使用该技能。它首先只读发现会话，并且只在创建 `session-export/` 前询问一次。

```text
Use $clean-session-curate to prepare this repository's agent sessions for upload.
```

## Install With an AI Agent / 使用 AI 智能体安装

Give the repository URL to Codex, Claude Code, or OpenCode and ask it to clone the repository as `clean-session-curate` in its documented user-level skill directory, run `npm ci` in that directory, and verify `SKILL.md`. No installer script is needed.

将仓库链接交给 Codex、Claude Code 或 OpenCode，并要求它把仓库以 `clean-session-curate` 名称克隆到该智能体文档规定的用户级技能目录，在该目录运行 `npm ci`，然后验证 `SKILL.md`。无需安装器脚本。

```text
Install this skill from https://github.com/linmou/clean-session-curate.git in your user-level skills directory, install its pinned npm dependency, validate it, and report the installed path.
```

Common user-level locations are `$CODEX_HOME/skills` (normally `~/.codex/skills`) for Codex, `~/.claude/skills` for Claude Code, and `~/.config/opencode/skills` for OpenCode. The agent should follow its current official documentation when a configured location differs.

常见的用户级目录为：Codex 使用 `$CODEX_HOME/skills`（通常是 `~/.codex/skills`），Claude Code 使用 `~/.claude/skills`，OpenCode 使用 `~/.config/opencode/skills`。如果配置路径不同，智能体应遵循其当前官方文档。

## Requirements / 环境要求

- Windows 10/11: Git, Node.js 20 or later, and Windows PowerShell with `Compress-Archive`.
- Linux/macOS: Git, Node.js 20 or later, `zip`, and `unzip`.
- All platforms: run `npm ci` once in the skill directory to install pinned Capsule `1.0.0`.

- Windows 10/11：Git、Node.js 20 或更高版本，以及带有 `Compress-Archive` 的 Windows PowerShell。
- Linux/macOS：Git、Node.js 20 或更高版本、`zip` 和 `unzip`。
- 所有平台：在技能目录中运行一次 `npm ci`，安装锁定的 Capsule `1.0.0`。

## Output / 输出

After validation, the target repository contains:

验证完成后，目标仓库包含：

```text
session-export/
  <harness>_001.jsonl
  ...
  manifest.json
session-export.zip
```

`manifest.json` records only format version, session counts, sanitized harness counts, `ux_language`, the cleaning method, and Capsule version. The ZIP contains exactly the numbered exports and the manifest.

`manifest.json` 仅记录格式版本、会话数量、已清理的智能体计数、`ux_language`、清理方法和 Capsule 版本。ZIP 仅包含连续编号的导出文件和清单。

## Privacy Boundary / 隐私边界

Raw session sources are never changed, placed in the export directory, or added to the ZIP. Candidates whose ownership cannot be proven are excluded. The workflow checks that raw hashes are unchanged and that repository-path forms do not remain in the final exports or archive.

原始会话文件绝不会被修改、放入导出目录或加入 ZIP。无法证明项目归属的候选会话会被排除。流程会检查原始文件哈希未变化，并确保最终导出和归档中不再包含仓库路径变体。

## UX Language / 界面语言

Capsule `1.0.0` has no supported interface-locale option. The skill therefore writes the dominant cleaned-session language as `ux_language` for the upload consumer or viewer; it does not claim to localize Capsule itself. Use `und` when the dominant language cannot be established.

Capsule `1.0.0` 没有受支持的界面语言设置。因此，该技能将清理后会话中占主导地位的语言写为 `ux_language`，供上传端或查看器使用；它不会声称已本地化 Capsule 本身。无法确定主导语言时使用 `und`。

## Verify / 验证

```text
npm test
```

The test suite covers native session selection, JSON/JSONL path scrubbing, contiguous anonymous names, archive membership, and archive integrity. GitHub Actions runs it on `ubuntu-latest` and `windows-latest`. Final archive creation uses the same tested command on every platform:

测试套件覆盖原生会话选择、JSON/JSONL 路径清理、匿名连续命名、归档成员和归档完整性。GitHub Actions 会在 `ubuntu-latest` 与 `windows-latest` 上运行测试。所有平台都使用同一个已测试命令创建最终归档：

```text
node "<skill-dir>/scripts/package_export.mjs" --root "<repo>" --export-dir "<repo>/session-export" --output "<repo>/session-export.zip"
```

The command uses PowerShell on Windows and `zip`/`unzip` on Unix, validates exact members and integrity, and removes a partial archive if native creation or validation fails.

该命令在 Windows 上使用 PowerShell，在 Unix 上使用 `zip`/`unzip`；它会验证精确成员和完整性，并在原生创建或验证失败时删除本次生成的不完整归档。
