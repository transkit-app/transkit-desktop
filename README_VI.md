# TransKit Desktop

TransKit Desktop là ứng dụng dịch thuật, OCR, realtime monitor và TTS đa nền tảng cho Windows, macOS và Linux.

Dự án là bản fork từ [Pot Desktop](https://github.com/pot-app/pot-desktop), phát hành theo GPL-3.0-only.

<div align="center">

<h3><a href='./README.md'>English</a> | Tiếng Việt | <a href='./README_CN.md'>中文</a> | <a href='./README_KR.md'>한글</a></h3>

<table>
<tr>
    <td><img src="asset/1.png"></td>
    <td><img src="asset/2.png"></td>
    <td><img src="asset/3.png"></td>
</tr>
</table>

# Mục lục

</div>

- [Usage](#usage)
- [Điểm Mới Trên TransKit](#điểm-mới-trên-transkit)
- [Cài Đặt](#cài-đặt)
- [Build Từ Source](#build-từ-source)
- [Release Version Mới (All Platforms)](#release-version-mới-all-platforms)
- [Đóng Góp](#đóng-góp)
- [Giấy phép](#giấy-phép)

<div align="center">

# Usage

</div>

| Translation by selection                        | Translate by input                                                    | External calls                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Select text and press the shortcut to translate | Press shortcut to open translation window, translate by hitting Enter | More efficient workflow by integrating with other apps |
| <img src="asset/eg1.gif"/>                    | <img src="asset/eg2.gif"/>                                          | <img src="asset/eg3.gif"/>                                                             |

| Clipboard Listening                                                                                                          | Screenshot OCR                     | Screenshot Translation                   |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------- |
| Click the top left icon on any translation panel to start clipboard listening. Copied text will be translated automatically. | Press shortcut, select area to OCR | Press shortcut, select area to translate |
| <img src="asset/eg4.gif"/>                                                                                                 | <img src="asset/eg5.gif"/>       | <img src="asset/eg6.gif"/>             |

## Điểm Mới Trên TransKit

So với Pot gốc, TransKit mở rộng mạnh workflow realtime và AI.

### Realtime Monitor

Triển khai tại [`src/window/Monitor/index.jsx`](./src/window/Monitor/index.jsx) và các thành phần liên quan.

- Monitor realtime cho họp trực tuyến với độ trễ thấp (speech-to-text + dịch)
- Sub Mode dạng phụ đề nổi
- AI generate context và AI suggestion theo từng đoạn transcript
- Bookmark timeline cho các đoạn quan trọng
- Tự động lưu transcript dạng Markdown
- Mở nhanh file/thư mục transcript đã lưu

### TTS (Free + Premium, BYO API)

- Free-friendly: Edge TTS, Google TTS
- Premium: ElevenLabs, OpenAI-compatible TTS
- Self-host: VieNeu streaming TTS
- BYO API key theo từng người dùng trong settings

## Cài Đặt

Trang release: <https://github.com/transkit-app/transkit-desktop/releases/latest>

### Windows

1. Tải file cài đặt `.exe` mới nhất từ Releases.
2. Chọn đúng kiến trúc:
   - x64: `TransKit_{version}_x64-setup.exe`
   - x86: `TransKit_{version}_x86-setup.exe`
   - arm64: `TransKit_{version}_arm64-setup.exe`
3. Chạy installer.

Nếu máy chưa có WebView2, dùng bản:

- `TransKit_{version}_{arch}_fix_webview2_runtime-setup.exe`

### macOS

1. Tải file `.dmg` mới nhất từ Releases.
2. Chọn đúng kiến trúc:
   - Apple Silicon: `TransKit_{version}_aarch64.dmg`
   - Intel: `TransKit_{version}_x64.dmg`
3. Mở file và cài đặt.

### Linux

1. Tải gói theo đúng kiến trúc từ Releases.
2. Các định dạng có trong CI artifacts:
   - `.deb`
   - `.rpm`
   - `.AppImage` (x86_64)

## Build Từ Source

### Yêu cầu

- Node.js 20+
- pnpm 9+
- Rust stable

### Lệnh

```bash
pnpm install
pnpm tauri dev
pnpm tauri build
```

## Release Version Mới (All Platforms)

TransKit dùng workflow CI: [`.github/workflows/package.yml`](./.github/workflows/package.yml)

1. Cập nhật [`CHANGELOG`](./CHANGELOG).
2. Tạo tag:

```bash
git tag v3.1.0
git push origin v3.1.0
```

3. GitHub Actions sẽ build và publish:
   - macOS: `aarch64`, `x86_64`
   - Windows: `x64`, `x86`, `arm64` (+ fix-runtime)
   - Linux: `x86_64`, `i686`, `aarch64`, `armv7`

Secrets tối thiểu cho release gồm `TAURI_PRIVATE_KEY`, `TAURI_KEY_PASSWORD`, và nhóm Apple signing/notarization cho macOS.

Tài liệu updater: [`updater/README.md`](./updater/README.md)

## Đóng Góp

1. Fork repo và tạo branch tính năng.
2. Giữ phạm vi thay đổi gọn, có test/check phù hợp.
3. Chạy build/check local trước khi mở PR:

```bash
pnpm install
pnpm tauri dev
pnpm tauri build
```

4. Mở Pull Request với:
   - mô tả thay đổi rõ ràng
   - ảnh/GIF nếu có thay đổi UI
   - ghi chú migration nếu đổi key config

## Giấy phép

GPL-3.0-only. Xem [`LICENSE`](./LICENSE).
