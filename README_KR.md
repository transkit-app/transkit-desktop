# TransKit Desktop

TransKit Desktop은 Windows, macOS, Linux를 지원하는 크로스플랫폼 번역, OCR, 실시간 모니터, TTS 앱입니다.

이 프로젝트는 [Pot Desktop](https://github.com/pot-app/pot-desktop) 포크이며, GPL-3.0-only 라이선스로 배포됩니다.

<div align="center">

<h3><a href='./README.md'>English</a> | <a href='./README_VI.md'>Tiếng Việt</a> | <a href='./README_CN.md'>中文</a> | 한글</h3>

<table>
<tr>
    <td><img src="asset/1.png"></td>
    <td><img src="asset/2.png"></td>
    <td><img src="asset/3.png"></td>
</tr>
</table>

# 목차

</div>

- [사용법](#사용법)
- [TransKit의 신규 기능](#transkit의-신규-기능)
- [설치](#설치)
- [소스에서 빌드](#소스에서-빌드)
- [새 버전 릴리스 (전체 플랫폼)](#새-버전-릴리스-전체-플랫폼)
- [기여하기](#기여하기)
- [라이선스](#라이선스)

<div align="center">

# 사용법

</div>

| 선택 번역                                    | 입력 번역                                   | 외부 연동                                       |
| -------------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| 텍스트를 선택하고 단축키를 누르면 번역합니다 | 입력 번역 창에서 텍스트를 입력해 번역합니다 | 다른 앱과 연동해 더 효율적으로 사용할 수 있습니다 |
| <img src="asset/eg1.gif"/>                 | <img src="asset/eg2.gif"/>                | <img src="asset/eg3.gif"/>                    |

| 클립보드 감시                                    | 스크린샷 OCR                           | 스크린샷 번역                           |
| ------------------------------------------------ | -------------------------------------- | --------------------------------------- |
| 번역 패널 좌상단에서 클립보드 감시를 켜면 자동 번역 | 단축키로 영역을 선택해 OCR 수행        | 단축키로 영역을 선택해 번역 수행        |
| <img src="asset/eg4.gif"/>                     | <img src="asset/eg5.gif"/>           | <img src="asset/eg6.gif"/>            |

## TransKit의 신규 기능

상위 Pot 대비, TransKit은 실시간/AI 워크플로를 크게 확장했습니다.

### Realtime Monitor

구현 위치: [`src/window/Monitor/index.jsx`](./src/window/Monitor/index.jsx) 및 관련 컴포넌트.

- 저지연 음성 인식 + 번역 기반 회의 모니터
- 자막형 Sub Mode
- AI 컨텍스트 생성 및 항목별 AI 제안
- 중요한 문장을 위한 북마크 타임라인
- Markdown 형식 transcript 자동 저장
- 저장된 파일/폴더 빠른 열기

### TTS (무료 + 프리미엄, BYO API)

- 무료 친화: Edge TTS, Google TTS
- 프리미엄: ElevenLabs, OpenAI-compatible TTS
- 셀프호스트: VieNeu 스트리밍 TTS
- 사용자 BYO API Key 설정 지원

## 설치

Release 페이지: <https://github.com/transkit-app/transkit-desktop/releases/latest>

### Windows

1. Releases에서 최신 `.exe` 설치 파일을 다운로드합니다.
2. 아키텍처에 맞는 파일을 선택합니다.
   - x64: `TransKit_{version}_x64-setup.exe`
   - x86: `TransKit_{version}_x86-setup.exe`
   - arm64: `TransKit_{version}_arm64-setup.exe`
3. 설치 파일을 실행합니다.

WebView2가 없는 환경에서는 다음 버전을 사용하세요.

- `TransKit_{version}_{arch}_fix_webview2_runtime-setup.exe`

### macOS

1. Releases에서 최신 `.dmg`를 다운로드합니다.
2. 아키텍처에 맞는 파일을 선택합니다.
   - Apple Silicon: `TransKit_{version}_aarch64.dmg`
   - Intel: `TransKit_{version}_x64.dmg`
3. 열어서 설치합니다.

### Linux

1. 아키텍처에 맞는 패키지를 Releases에서 다운로드합니다.
2. CI 산출물 포맷:
   - `.deb`
   - `.rpm`
   - `.AppImage` (x86_64)

## 소스에서 빌드

### 요구사항

- Node.js 20+
- pnpm 9+
- Rust stable

### 명령어

```bash
pnpm install
pnpm tauri dev
pnpm tauri build
```

## 새 버전 릴리스 (전체 플랫폼)

CI 워크플로: [`.github/workflows/package.yml`](./.github/workflows/package.yml)

1. [`CHANGELOG`](./CHANGELOG)를 업데이트합니다.
2. 태그를 생성/푸시합니다.

```bash
git tag v3.1.0
git push origin v3.1.0
```

3. GitHub Actions가 다음 타깃을 빌드/배포합니다.
   - macOS: `aarch64`, `x86_64`
   - Windows: `x64`, `x86`, `arm64` (+ fix-runtime)
   - Linux: `x86_64`, `i686`, `aarch64`, `armv7`

최소 필요한 release secrets: `TAURI_PRIVATE_KEY`, `TAURI_KEY_PASSWORD`.

Updater 문서: [`updater/README.md`](./updater/README.md)

## 기여하기

1. 저장소를 Fork하고 기능 브랜치를 생성합니다.
2. 변경 범위를 명확히 유지하고, 필요한 경우 테스트를 추가합니다.
3. PR 전에 로컬에서 다음을 실행하세요.

```bash
pnpm install
pnpm tauri dev
pnpm tauri build
```

4. PR에는 다음을 포함하세요.
   - 변경 요약
   - UI 변경 시 스크린샷/GIF
   - 설정 키 변경 시 마이그레이션 안내

## 라이선스

GPL-3.0-only. [`LICENSE`](./LICENSE) 참고.
