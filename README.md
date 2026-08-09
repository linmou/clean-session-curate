<!-- Intent: Explain installation, operation, privacy boundaries, and verification in English and Chinese. Updated: 2026-08-09. Implementation commit: 95819a3. -->

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

Give only the GitHub URL to Codex, Claude Code, or OpenCode and ask it to install the skill. The agent clones it as `clean-session-curate` in the documented user-level skill directory and runs `npm run build`. That one command checks the environment, automatically installs the pinned repository-local Capsule dependency when needed, and runs every test. No standalone installer or binary is needed.

只需将 GitHub 链接交给 Codex、Claude Code 或 OpenCode，并要求它安装该技能。智能体会将仓库以 `clean-session-curate` 名称克隆到文档规定的用户级技能目录，并运行 `npm run build`。这一个命令会检查环境、在需要时自动安装锁定的仓库本地 Capsule 依赖，并运行全部测试。无需独立安装器或二进制文件。

```text
Install this skill from https://github.com/linmou/clean-session-curate.git in your user-level skills directory, run its build, and report whether it is ready.
```

Common user-level locations are `$CODEX_HOME/skills` (normally `~/.codex/skills`) for Codex, `~/.claude/skills` for Claude Code, and `~/.config/opencode/skills` for OpenCode. The agent should follow its current official documentation when a configured location differs.

常见的用户级目录为：Codex 使用 `$CODEX_HOME/skills`（通常是 `~/.codex/skills`），Claude Code 使用 `~/.claude/skills`，OpenCode 使用 `~/.config/opencode/skills`。如果配置路径不同，智能体应遵循其当前官方文档。

Repository-local npm preparation is automatic. Installing or upgrading Node.js, Git, ZIP tools, Homebrew, or any other system software is different: the agent must show the exact command and obtain your approval before running it.

仓库本地的 npm 准备会自动进行。安装或升级 Node.js、Git、ZIP 工具、Homebrew 或任何其他系统软件则不同：智能体必须先展示准确命令，并在获得你的批准后才能执行。

## Requirements / 环境要求

- Windows 10/11: Git, Node.js 20 or later, and Windows PowerShell with `Compress-Archive`.
- Linux/macOS: Git, Node.js 20 or later, `zip`, and `unzip`.
- All platforms: npm and pinned Capsule `1.0.0`; `npm run build` installs the local dependency automatically when needed.

- Windows 10/11：Git、Node.js 20 或更高版本，以及带有 `Compress-Archive` 的 Windows PowerShell。
- Linux/macOS：Git、Node.js 20 或更高版本、`zip` 和 `unzip`。
- 所有平台：npm 和锁定的 Capsule `1.0.0`；`npm run build` 会在需要时自动安装本地依赖。

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

```shell
npm run build
```

Here, “build” means prepare and verify; it does not create a binary or distributable. The test suite covers environment preparation, native session selection, JSON/JSONL path scrubbing, contiguous anonymous names, archive membership, and archive integrity. GitHub Actions runs this novice workflow from a fresh checkout on `ubuntu-latest`, `windows-latest`, and `macos-latest`. Final archive creation uses the same tested command on every platform:

这里的“构建”表示准备并验证；它不会创建二进制文件或分发包。测试套件覆盖环境准备、原生会话选择、JSON/JSONL 路径清理、匿名连续命名、归档成员和归档完整性。GitHub Actions 会在 `ubuntu-latest`、`windows-latest` 和 `macos-latest` 的全新检出中运行这一新手工作流。所有平台都使用同一个已测试命令创建最终归档：

```text
node "<skill-dir>/scripts/package_export.mjs" --root "<repo>" --export-dir "<repo>/session-export" --output "<repo>/session-export.zip"
```

The command uses PowerShell on Windows and `zip`/`unzip` on Unix, validates exact members and integrity, and removes a partial archive if native creation or validation fails.

该命令在 Windows 上使用 PowerShell，在 Unix 上使用 `zip`/`unzip`；它会验证精确成员和完整性，并在原生创建或验证失败时删除本次生成的不完整归档。
