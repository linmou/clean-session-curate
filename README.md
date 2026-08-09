<!-- Intent: 说明安装、使用、隐私边界和验证方式。中文为默认版本；英文版见 README.en.md。Updated: 2026-08-09. Implementation commit: 95819a3. -->

# Harness 会话脱敏与打包

[English](README.en.md) | 中文

创建本地去隐私、可上传的编程智能体会话归档，以便后续分析；只导出能够明确证明属于当前 Git 仓库的会话。

## 功能

- 自动发现 Agent Harness 系统中的会话。原生支持 Capsule `1.0.0` 的格式包括 Claude Code、Codex、Copilot 和 Gemini。
- 如果已安装 OpenCode，则通过其只读数据库命令自动发现当前仓库的 session；每条结果保留共享数据库路径和独立 `sessionId`，不会直接读取、复制或修改数据库/WAL 文件。
- 使用开源的 [Capsule](https://github.com/endorhq/capsule) `1.0.0` 命令行工具（Apache-2.0 许可证），对每个会话的副本进行匿名化。
- Capsule 的 `Select all` 选项会替换文件路径和 Git 身份等信息。例如，`/Users/alice/project/src/app.ts` 会变成 `/project/src/file1.ts`，私有分支会变成 `branch-1`，仓库 URL 会变成 `https://github.com/user/repo-1.git`。
- 同一选项还会移除工具输出、文件内容、思考块、系统消息和 token 使用量元数据。
- Capsule 不保证识别直接写入普通对话文本的任意密钥或个人信息；因此本流程还会清除仓库路径的不同写法，并在创建 ZIP 前验证清理后的导出内容。
- OpenCode 等非原生格式按照文档中的 `Unsupported Formats` 转换流程处理：获得批准后，先用 `opencode export <sessionId>` 将 JSON 写入隔离临时目录，再转换为可供本技能处理的会话格式；原始数据库不会被改动或打包。
- 最终生成清理后的 ZIP 归档。

## 使用 AI 智能体一句话安装

只需将下面这段话复制给 Codex、Claude Code 或 OpenCode，智能体会自动安装这个 skill。仓库将以 `clean-session-curate` 名称克隆到文档规定的用户级技能目录，并运行 `npm run build`。这一个命令会检查环境、在需要时自动安装锁定的仓库本地 Capsule 依赖，并运行全部测试。无需独立安装器或二进制文件。

```text
从 https://github.com/linmou/clean-session-curate.git 安装这个 skill 到你的用户级 skills 目录，运行构建，并报告它是否已准备就绪。
```

常见的用户级目录为：Codex 使用 `$CODEX_HOME/skills`（通常是 `~/.codex/skills`），Claude Code 使用 `~/.claude/skills`，OpenCode 使用 `~/.config/opencode/skills`。如果配置路径不同，智能体应遵循其当前官方文档。

仓库本地的 npm 准备会自动进行。安装或升级 Node.js、Git、ZIP 工具、Homebrew 或任何其他系统软件则不同：智能体必须先展示准确命令，并在获得你的批准后才能执行。

## 使用

在目标仓库/文件夹中打开编程智能体或 Harness（例如 OpenCode、Codex），然后使用该技能：

```text
使用 $clean-session-curate 准备本仓库的编程智能体会话，以便上传。
```

它首先只读发现会话，并且只在创建脱敏数据前询问一次目标文件夹和 Harness 使用记录是否准确。

## 环境要求

- Windows 10/11：Git、Node.js 20 或更高版本，以及带有 `Compress-Archive` 的 Windows PowerShell。
- Linux/macOS：Git、Node.js 20 或更高版本、`zip` 和 `unzip`。
- 所有平台：npm 和锁定的 Capsule `1.0.0`；`npm run build` 会在需要时自动安装本地依赖。

## 输出

验证完成后，目标仓库包含：

```text
session-export/
  <harness>_001.jsonl
  ...
  manifest.json
session-export.zip
```

`manifest.json` 仅记录格式版本、会话数量、已清理的智能体计数、`ux_language`、清理方法和 Capsule 版本。ZIP 仅包含连续编号的导出文件和清单。

## 隐私边界

原始会话文件绝不会被修改、放入导出目录或加入 ZIP。无法证明项目归属的候选会话会被排除。流程会检查原始文件哈希未变化，并确保最终导出和归档中不再包含仓库路径变体。

## 界面语言

Capsule `1.0.0` 没有受支持的界面语言设置。因此，该技能将清理后会话中占主导地位的语言写为 `ux_language`，供上传端或查看器使用；它不会声称已本地化 Capsule 本身。无法确定主导语言时使用 `und`。

## 验证

```shell
npm run build
```

这里的“构建”表示准备并验证；它不会创建二进制文件或分发包。测试套件覆盖环境准备、原生与 OpenCode 会话选择、OpenCode 数据库失败隔离、JSON/JSONL 路径清理、匿名连续命名、归档成员和归档完整性。GitHub Actions 会在 `ubuntu-latest`、`windows-latest` 和 `macos-latest` 的全新检出中运行这一新手工作流。所有平台都使用同一个已测试命令创建最终归档：

```text
node "<skill-dir>/scripts/package_export.mjs" --root "<repo>" --export-dir "<repo>/session-export" --output "<repo>/session-export.zip"
```

该命令在 Windows 上使用 PowerShell，在 Unix 上使用 `zip`/`unzip`；它会验证精确成员和完整性，并在原生创建或验证失败时删除本次生成的不完整归档。

## 注意事项

每个人对隐私信息的定义和敏感程度都不同，因此本流程和 Capsule 不保证所有隐私信息都能被完全脱敏。如果导出内容较为敏感，或隐私边界要求严格，建议在分享前再让 Agent 独立自查一遍。
