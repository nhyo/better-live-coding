# Better Live Coding

[English](README.md) · **简体中文**

Better Live Coding 把任何项目变成 **可确定复现、可反复彩排的 VS Code 现场编码演示**。
你在一个 JSON 文件中描述章节（Chapter）和*语义步骤*（Step）；演示时每按一次 **Enter**，扩展就在真实的编辑器里
输入下一个步骤——保留语法高亮、诊断、IntelliSense 和参数提示——可以跨任意多个文件，并按照真实开发者的顺序编写。
Checkpoint 让你随时跳过、重来和恢复。

扩展本身与技术栈无关：任何框架或文件结构都不会写死在扩展中。

## 功能

- **语义步骤**：一次 Enter = 一个有意义的开发单元（一组状态、一个 UI 区块、一个函数、一个 endpoint），即使跨多个文件。
  状态栏显示 `Stage 2 · Step 3/6`。
- **十种操作**：`insertBefore`、`insertAfter`、`replace`、`delete`、`createFile`、`deleteFile`、`moveCursor`、
  `selectRange`、`openFile`，以及受限的 `replaceFile`（仅用于显式声明的瞬时变更）。
- **严格锚点**：文本、正则或行列。锚点不存在或不唯一时立即停止当前步骤并给出可操作的错误，绝不猜测位置。
- **确定性 Human Mode**：逐字符速度变化、标点/换行/空行/代码块结束停顿、思考停顿和文件切换停顿；同一配置每次彩排节奏完全一致。
- **快速档与慢速档**：状态、类型、HTML、CSS 为 12–25 ms/字符；import、函数、endpoint 为 35–60 ms/字符；可自动判断，也可按步骤或操作指定。
- **VS Code 原生效果**：输入 `request.` 后显示 IntelliSense、输入 `handleUpload(` 后显示参数提示、替换前先显示选区、自动滚动、光标定位；提示框在继续输入前自动收起。
- **非线性顺序**：先写按钮再写处理函数，切到后端再回到前端。
- **Checkpoint**：初始状态加每个步骤一个 checkpoint，崩溃或重载后可识别；Skip、Restart、Restore 只写入声明过的文件。
- **配置验证**：Schema 规则、ID 唯一、路径安全、锚点存在且唯一、所有步骤完整试运行，并与预期最终目录比对。
- **候选差异生成**：比较两个目录，生成带锚点的候选操作*草稿*，由你自行组织为语义步骤。
- **隐私优先**：不联网、无遥测，从不读取 `.env*`、凭据或未声明文件。

## 安装

从 [最新 Release](https://github.com/nhyo/better-live-coding/releases/latest) 下载 `better-live-coding-1.0.0.vsix`，然后：

```bash
code --install-extension better-live-coding-1.0.0.vsix
```

或在“扩展 → … → 从 VSIX 安装…”中选择文件。需要 VS Code 1.90 或更新版本。

## 3 分钟快速开始

1. 在 VS Code 中打开项目文件夹。
2. 运行 **Better Live Coding: Initialize Presentation**。它会创建 `.better-live-coding/`，包含可直接运行的示例配置、
   JSON Schema 和说明文件；已有文件永远不会被覆盖。
3. 编辑 `.better-live-coding/presentation.json`：设置 `workspace.workingDirectory`，把示例章节替换为你自己的步骤
   （Schema 提供自动补全和字段说明）。
4. 把文件恢复到起始状态，运行 **Better Live Coding: Generate Checkpoints**（或用 `workspace.initialDirectory` 指向一份干净副本）。
5. 运行 **Better Live Coding: Validate Presentation**，直到 0 个错误。
6. 运行 **Better Live Coding: Start Presentation Mode**，点击编辑器，按 **Enter**。

想直接体验：把 [`examples/basic-typescript`](examples/basic-typescript) 作为文件夹打开并运行 *Start Presentation Mode*，
扩展会提示从 `initial/` 创建 `practice/` 工作副本。

## 配置格式

```jsonc
{
  "$schema": "./presentation.schema.json",
  "version": 1,
  "title": "My Live Coding Demo",
  "workspace": {
    "workingDirectory": "practice",   // 现场输入发生的目录（相对工作区）
    "initialDirectory": "starter",    // 可选：干净的起始状态
    "finalDirectory": "solution",     // 可选：预期最终状态（用于验证）
    "newFileEol": "lf"                // createFile 新建文件的行尾
  },
  "humanMode": { "enabled": true, "seed": "my-presentation" },
  "chapters": [
    {
      "id": "upload",
      "title": "Upload a file",
      "steps": [
        {
          "id": "upload-function",
          "title": "Implement upload function",
          "objective": "Upload a selected file and display the returned URL",
          "operations": [
            {
              "type": "insertBefore",
              "file": "src/app.ts",
              "anchor": { "text": "// upload" },
              "pace": "slow",
              "text": ["async function upload(file: File) {", "  // …", "}", ""]
            }
          ]
        }
      ]
    }
  ]
}
```

所有 `file` 都相对于 `workspace.workingDirectory`；绝对路径、`..` 以及敏感路径（`.env*`、密钥、`node_modules`、`.git` 等）会被拒绝。
完整参考见 [docs/configuration.md](docs/configuration.md)。

### 操作字段

| 字段 | 含义 |
| --- | --- |
| `type` | 十种操作类型之一 |
| `file` | 目标文件（相对路径） |
| `anchor` | `{ "text" }`、`{ "regex", "flags" }`、`{ "line", "column" }`、`{ "line", "column", "endLine", "endColumn" }`，或限定在某一 `line` 内的 `text`/`regex` |
| `text` | 字符串，或按 `\n` 连接的行数组（输入时使用文档自身的行尾） |
| `expectBefore` / `expectAfter` | 编辑前/后必须存在的文本 |
| `pace` | `fast`、`slow` 或 `auto`（默认） |
| `thinking` | 定位后显示为 `Thinking · …` |
| `effects` | `auto`、`suggestAfter`、`parameterHintsAfter` |
| `scroll` | `center`、`centerIfOutside`（默认）、`top`、`minimal`、`none` |
| `cursor` | `moveCursor` 的 `start`/`end` |
| `transient` | `replaceFile` 必须为 `true` |

## JSON Schema

扩展自带 `schemas/presentation.schema.json`，并自动关联到所有 `.better-live-coding/presentation.json`（自动补全、字段说明、
枚举建议、类型与路径格式检查、缺少字段提示）。*Initialize Presentation* 还会把它复制到配置旁边，方便其他编辑器使用。

## 语义步骤

一个步骤应当是**观众能说出名字的单元**：“定义选择状态”“创建 Upload 按钮”“实现 POST endpoint”。把组成这个单元的操作
（即使跨文件）放进同一个步骤。**不要**为了增加 Enter 次数，把函数头和函数体、按钮的标签和文本、endpoint 的校验和返回值拆开。
同一步骤的所有操作是一个 checkpoint 事务：任何一个无法执行，整个步骤停止，绝不猜测。

## Human Mode

Human Mode 默认开启，且完全确定（基于 seed、步骤、操作和字符的哈希，不使用 `Math.random`）。它加入标点、换行、空行、
代码块结束停顿，文件切换后的停顿，以及定位后的*思考*停顿（状态栏：`Thinking · Implement upload function`）。替换前先选中旧文本，
插入前先放置光标，步骤结束后光标停在所输入代码末尾。不会故意制造拼写错误。用 `betterLiveCoding.humanMode: false` 或
`"humanMode": { "enabled": false }` 关闭后，按 `betterLiveCoding.fixedTypingDelayMs` 固定速度输入。

### 快速档与慢速档

| 档位 | 默认值 | 用途 |
| --- | --- | --- |
| 快速 | `betterLiveCoding.fastTypingDelayMinMs` 12 – `fastTypingDelayMaxMs` 25 ms/字符 | 状态、类型、HTML、CSS、简单 UI、普通对象 |
| 慢速 | `betterLiveCoding.slowTypingDelayMinMs` 35 – `slowTypingDelayMaxMs` 60 ms/字符 | import、完整函数、GET/POST/DELETE endpoint、核心逻辑 |

`"pace": "auto"`（默认）时，import、函数定义和 endpoint 定义使用慢速，其余使用快速；可在步骤或操作上设置 `pace` 覆盖。

## VS Code 原生提示

输入时，扩展会在 `identifier.` 之后调用 `editor.action.triggerSuggest`，在 `identifier(` 之后调用
`editor.action.triggerParameterHints`；可用 `effects.suggestAfter`（如 `"request."`、`"Resp"`）和
`effects.parameterHintsAfter` 增加触发点。候选只*显示*，最终代码从不依赖语言服务给出的候选；提示框会在继续输入前、步骤完成前自动收起。
用 `betterLiveCoding.editorEffects: false` 或 `"effects": { "auto": false }` 关闭。

## 命令与快捷键

| 命令 | 默认快捷键 |
| --- | --- |
| Better Live Coding: Initialize Presentation | |
| Better Live Coding: Start Presentation Mode | |
| Better Live Coding: Run Next Step | `Enter`（演示模式且编辑器获得焦点） |
| Better Live Coding: Pause or Resume | `Ctrl+Alt+P` / `Cmd+Alt+P` |
| Better Live Coding: Skip Current Animation | `Ctrl+Alt+S` / `Cmd+Alt+S` |
| Better Live Coding: Restart Current Step | `Ctrl+Alt+R` / `Cmd+Alt+R` |
| Better Live Coding: Restart from Initial Checkpoint | |
| Better Live Coding: Restore Checkpoint | |
| Better Live Coding: Validate Presentation | |
| Better Live Coding: Preview Steps | |
| Better Live Coding: Generate Checkpoints | |
| Better Live Coding: Generate Candidate Operations from Two Directories | |
| Better Live Coding: Exit Presentation Mode | `Ctrl+Alt+Q` / `Cmd+Alt+Q` |

**Enter** 只在演示模式开启*且*文本编辑器获得焦点时生效；在集成终端、补全框、重命名框和查找框中不会触发。步骤执行期间的 Enter
会被吞掉并忽略。*Exit Presentation Mode* 后 Enter 恢复正常。点击状态栏项也可以运行下一步。

## Checkpoint 与恢复

- **Checkpoint 0** 是初始状态（来自 `workspace.initialDirectory` 或 `.better-live-coding/checkpoints/initial.json`）；
  checkpoint *N* 是第 *N* 步完成后的状态。
- `checkpoints/manifest.json` 保存每个 checkpoint 的 SHA-256 哈希（已规范化行尾）。
- 启动时会把当前文件与所有 checkpoint 比对。步骤执行中崩溃或 *Reload Window* 后，没有 checkpoint 能匹配，扩展会建议恢复最后保存的
  checkpoint，并列出将被改写的全部文件。
- 每个步骤开始前都会比对预期起点；检测到意外修改时会提示，由你决定是否恢复。
- **Skip** 写入正在运行步骤的完整终点 checkpoint；**Restart Current Step** 回滚到步骤起点并重新执行；**Restore Checkpoint** /
  **Restart from Initial Checkpoint** 会先显示将被修改的文件。
- 只会写入声明过的文件（操作目标和 `workspace.files`）。`.env*`、凭据、依赖目录和任何未声明文件都不会被读取或修改。
- 保存使用 *Save without Formatting*，format-on-save、去除行尾空格、末尾换行等保存参与者都不会改写 checkpoint。支持 LF 与 CRLF；
  位置始终使用行列，从不使用原始 offset。

## 预览面板

**Preview Steps** 在独立的活动栏容器中打开只读的 *Better Live Coding* 视图（不会遮挡编辑器），显示标题、当前章节和步骤、教学目标、
涉及文件、操作数量、Pace、下一步、当前 checkpoint、大纲和快捷键。

## 候选操作

**Generate Candidate Operations from Two Directories** 比较起点和终点目录，生成 `.better-live-coding/candidates.json`：新增/删除文件，
以及带锚点的插入/替换/删除操作，按启发式类别（状态/标记/样式、函数、import、endpoint、删除）和文件分组。结果明确是**草稿**：
不会把每一行差异变成一个步骤，也不会决定教学顺序；请自行合并为语义步骤并安排顺序。

## 示例

| 示例 | 展示内容 |
| --- | --- |
| [`examples/basic-typescript`](examples/basic-typescript) | 变量、函数、多文件、新建与删除文件、最后补错误处理、CRLF 文件、Human Mode、checkpoint 恢复 |

## 常见问题

**按 Enter 插入了换行而不是执行步骤。** 演示模式未开启、编辑器没有焦点，或打开了补全/重命名/查找框。点击编辑器或状态栏项。

**提示“Anchor is not unique”。** 扩展锚点文本、添加 `"line"`，或使用正则。引擎拒绝猜测。

**提示“The presentation files do not match any checkpoint”。** 有人修改了声明文件，或步骤被中断。接受建议的恢复（对话框会列出所有将被改写的文件），或使用 *Restore Checkpoint*。

**能否保持节奏但整体更快？** 调低 `betterLiveCoding.*` 延迟即可，节奏依旧确定。

**支持任何语言吗？** 支持。扩展只编辑文本，语言功能来自你安装的其他扩展。

## 开发与测试

```bash
npm ci
npm run compile
npm test                      # 单元测试（node:test）
npm run validate:schema       # Ajv 编译 Schema 并校验示例
npm run validate:examples     # 对每个示例执行完整的 Validate Presentation
npm run replay -- examples/basic-typescript --scenario   # 无界面完整回放（含 Human Mode 计时）
npm run test:integration      # 真实 VS Code 扩展宿主集成测试
npm run scan                  # 敏感信息与本地路径扫描
npm run package               # 打包 VSIX
```

测试覆盖：配置解析、JSON Schema、无效 JSON、缺少字段、重复 ID、路径逃逸、锚点不存在/不唯一、所有操作类型、多操作事务、
非线性文件顺序、状态机、重复 Enter、Pause/Resume、Skip、Restart、checkpoint 恢复、意外修改检测、LF/CRLF、不格式化保存、
自身编辑事件抑制、确定性 Human Mode、快慢档及自动分类、最终目录验证、未声明文件不被修改、`.env.local` 隔离。
集成测试在开启激进保存参与者的真实 VS Code 中端到端运行两个示例。CI 在 Windows 和 Linux 上运行全部检查。

## 架构

```
src/
├── config/        配置模型 + 无依赖校验器（与 JSON Schema 一致）
├── engine/        锚点、纯函数操作规划、节奏、状态机、步骤执行器、宿主接口
├── checkpoints/   checkpoint 构建/识别/清单、安全文件访问、生成
├── presentation/  会话编排、项目加载与验证、预览模型、候选差异、初始化模板
├── extension/     VS Code 适配层：宿主实现、控制器（命令/UI）、预览 Webview
├── testing/       内存与磁盘编辑器宿主 + 虚拟时钟（测试与无界面回放）
└── utilities/     文本/行尾/位置工具、路径安全
```

引擎不依赖 `vscode`，同一份代码运行在测试、无界面回放和扩展中。详见 [docs/architecture.md](docs/architecture.md)。

## 隐私

Better Live Coding 完全离线工作：无遥测、不发起网络请求、不上传或分享源代码、不执行 shell 命令、从不读取 `.env*` 或凭据、
从不读写演示未声明的文件、不在日志中输出环境变量，并拒绝逃逸工作区的路径。详见 [SECURITY.md](SECURITY.md)。

## 已知限制

- 输入通过 `TextEditor.edit` 完成，因此编辑器的自动闭合括号、自动缩进和片段展开不会生效（结果严格等于配置文本）。
- 代码输入到一半时语言服务诊断可能闪烁，这是真实编辑器行为。
- IntelliSense 内容取决于用户的语言扩展；只显示、不依赖。
- 一个演示只能编辑其所在工作区文件夹内的文件，不支持跨多个根文件夹的演示。
- 不支持二进制文件作为演示文件。
- `Ctrl+Alt+P/S/R/Q` 可能与其他扩展冲突，可在“键盘快捷方式”中重新绑定。

## 许可证

[MIT](LICENSE)
