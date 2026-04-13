# TransKit Desktop

TransKit Desktop 是一款支持 Windows、macOS、Linux 的跨平台翻译、OCR、实时监控与 TTS 应用。

本项目基于 [Pot Desktop](https://github.com/pot-app/pot-desktop) fork，使用 GPL-3.0-only 协议发布。

<div align="center">

<h3><a href='./README.md'>English</a> | <a href='./README_VI.md'>Tiếng Việt</a> | 中文 | <a href='./README_KR.md'>한글</a></h3>

<table>
<tr>
    <td><img src="asset/1.png"></td>
    <td><img src="asset/2.png"></td>
    <td><img src="asset/3.png"></td>
</tr>
</table>

# 目录

</div>

- [使用说明](#使用说明)
- [键盘快捷键](#键盘快捷键)
- [TransKit 新增能力](#transkit-新增能力)
- [安装指南](#安装指南)
- [从源码构建](#从源码构建)
- [发布新版本（全平台）](#发布新版本全平台)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

<div align="center">

# 使用说明

</div>

| 划词翻译                                             | 输入翻译                                                       | 外部调用                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------- |
| 选中文本后按下快捷键即可翻译                         | 打开输入翻译窗口后输入文本并回车                               | 可与其他应用集成，提升效率                               |
| <img src="asset/eg1.gif"/>                         | <img src="asset/eg2.gif"/>                                   | <img src="asset/eg3.gif"/>                             |

| 剪贴板监听                                                         | 截图 OCR                                          | 截图翻译                                         |
| ------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------ |
| 在翻译面板左上角开启剪贴板监听后，复制文本即可自动翻译             | 使用快捷键框选区域进行识别                        | 使用快捷键框选区域进行翻译                       |
| <img src="asset/eg4.gif"/>                                       | <img src="asset/eg5.gif"/>                      | <img src="asset/eg6.gif"/>                     |

## 键盘快捷键

所有快捷键均可在 **设置 → 快捷键** 中自由修改。下表为推荐的默认方案——首次安装时不会预先注册任何快捷键，因此不存在意外冲突。

> **跨平台说明：** Windows / Linux 的 `Ctrl+Alt` 与 macOS 的 `Ctrl+Option` 是同一物理按键组合，只需设置一次即可在三个平台上通用。

| 功能 | 推荐快捷键 | 说明 |
|---|---|---|
| **语音输入（Voice Anywhere）** | `Ctrl+Alt+V` | 显示 / 隐藏悬浮麦克风按钮，可在任意应用中语音输入 |
| **实时翻译** | `Ctrl+Alt+M` | 打开 Audio Monitor 进行实时语音翻译 |
| **划词翻译** | `Ctrl+Alt+Q` | 翻译当前选中的文本 |
| **输入翻译** | `Ctrl+Alt+W` | 打开文本输入翻译窗口 |
| **OCR 识别** | `Ctrl+Alt+R` | 框选屏幕区域并提取文字 |
| **OCR 翻译** | `Ctrl+Alt+O` | 框选屏幕区域并翻译其中文字 |

### 为什么选择这套方案？

`Ctrl+Alt+` 前缀在 Windows、macOS、Linux 三端均未被系统占用，且有意规避了以下冲突热键：`Ctrl+Alt+Del`（Windows 任务管理器）、`Ctrl+Alt+T`（Linux 终端）、`Ctrl+Alt+L`（Linux 锁屏），以及浏览器 / IDE 中常用的 `Ctrl+Shift+I`、`Ctrl+Shift+R`、`Ctrl+\`` 等。

## TransKit 新增能力

相比上游 Pot，TransKit 重点增强了实时场景与 AI 工作流。

### Realtime Monitor

实现位置：[`src/window/Monitor/index.jsx`](./src/window/Monitor/index.jsx) 及相关组件。

- 会议场景实时监控（低延迟语音转写 + 翻译）
- Sub Mode 字幕模式
- AI 上下文生成与逐条 AI 建议
- 书签时间线（Bookmark）
- Transcript 自动保存为 Markdown
- 快速打开已保存文件与目录

### TTS（免费 + 高级，BYO API）

- 免费友好：Edge TTS、Google TTS
- 高级服务：ElevenLabs、OpenAI-compatible TTS
- 自托管：VieNeu 流式 TTS
- 支持用户自备 API Key（BYO）

## 安装指南

Release 页面：<https://github.com/transkit-app/transkit-desktop/releases/latest>

### Windows

1. 从 Releases 下载最新 `.exe` 安装包。
2. 按架构选择：
   - x64：`TransKit_{version}_x64-setup.exe`
   - x86：`TransKit_{version}_x86-setup.exe`
   - arm64：`TransKit_{version}_arm64-setup.exe`
3. 运行安装程序。

若系统缺少 WebView2，可使用：

- `TransKit_{version}_{arch}_fix_webview2_runtime-setup.exe`

### macOS

1. 从 Releases 下载最新 `.dmg`。
2. 按架构选择：
   - Apple Silicon：`TransKit_{version}_aarch64.dmg`
   - Intel：`TransKit_{version}_x64.dmg`
3. 打开并安装。

### Linux

1. 从 Releases 下载对应架构安装包。
2. CI 产物包含：
   - `.deb`
   - `.rpm`
   - `.AppImage`（x86_64）

## 从源码构建

### 环境要求

- Node.js 20+
- pnpm 9+
- Rust stable

### 常用命令

```bash
pnpm install
pnpm tauri dev
pnpm tauri build
```

## 发布新版本（全平台）

CI 工作流：[` .github/workflows/package.yml`](./.github/workflows/package.yml)

1. 更新 [`CHANGELOG`](./CHANGELOG)。
2. 创建并推送版本标签：

```bash
git tag v3.1.0
git push origin v3.1.0
```

3. GitHub Actions 将构建并发布：
   - macOS：`aarch64`、`x86_64`
   - Windows：`x64`、`x86`、`arm64`（含 fix-runtime 变体）
   - Linux：`x86_64`、`i686`、`aarch64`、`armv7`

发布所需最少 secrets：`TAURI_PRIVATE_KEY`、`TAURI_KEY_PASSWORD`。

Updater 文档：[`updater/README.md`](./updater/README.md)

## 参与贡献

1. Fork 仓库并创建功能分支。
2. 变更保持聚焦，必要时补充测试/验证。
3. 提交 PR 前建议本地执行：

```bash
pnpm install
pnpm tauri dev
pnpm tauri build
```

4. PR 建议包含：
   - 变更摘要
   - UI 变更截图/GIF
   - 若有配置迁移，补充迁移说明

## 许可证

GPL-3.0-only，详见 [`LICENSE`](./LICENSE)。
