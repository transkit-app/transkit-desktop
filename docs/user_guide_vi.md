# Hướng dẫn sử dụng Transkit

Chào mừng bạn đến với **Transkit** - bộ công cụ hỗ trợ dịch thuật và nhận diện văn bản mạnh mẽ trên máy tính. Tài liệu này sẽ giúp bạn hiểu rõ các cấu hình và cách sử dụng từng tính năng của ứng dụng.

---
- [English](./user_guide.md)

## 0. Hướng dẫn cài đặt

### Windows
1. Tải file cài đặt `.exe` mới nhất từ trang [Releases](https://github.com/transkit-app/transkit-desktop/releases/latest).
2. Chạy installer. Nếu Windows Defender hiển thị thông báo "Windows protected your PC", hãy nhấn **"More info"** và chọn **"Run anyway"**.

### macOS
1. Tải file `.dmg` mới nhất từ trang [Releases](https://github.com/transkit-app/transkit-desktop/releases/latest).
2. Mở file `.dmg` và kéo **TransKit** vào thư mục Applications.
3. **Quan trọng** — Ứng dụng hiện chưa được ký (sign) bằng chứng chỉ Apple Developer. macOS sẽ chặn khi mở lần đầu. Hãy chạy lệnh này **một lần duy nhất** trong Terminal để cho phép ứng dụng:
   ```bash
   xattr -cr /Applications/TransKit.app
   ```
   > Bước này sẽ không còn cần thiết sau khi ứng dụng được hoàn tất ký số.
4. Mở **TransKit** từ Applications.

#### Cấp quyền (Sử dụng lần đầu)
Lần đầu mở app, macOS sẽ hỏi quyền **Screen & System Audio Recording**:
- Bấm **Open System Settings** khi được hỏi.
- Tìm **TransKit** trong danh sách.
- Bật công tắc sang **ON**.
- macOS sẽ yêu cầu **Quit & Reopen** — hãy bấm nút đó.
- *Quyền này là bắt buộc để app có thể bắt được âm thanh hệ thống từ Zoom, Meet, Google, Douyin, v.v.*

---

## 1. Cấu hình hệ thống (Settings)

Cấu hình là trung tâm điều khiển mọi hành vi của ứng dụng. Bạn có thể truy cập vào biểu tượng cài đặt để tùy chỉnh các mục sau:

### 1.1. General Settings (Cài đặt chung)
Dùng để tùy chỉnh giao diện và các thiết lập hệ thống cơ bản.
- **Display Language**: Ngôn ngữ hiển thị của giao diện ứng dụng.
- **Theme**: Chế độ hiển thị (Sáng/Tối hoặc theo Hệ thống).
- **Font & Fallback Font**: Tùy chỉnh font chữ hiển thị trong cửa sổ dịch.
- **Font Size**: Kích thước chữ (Mặc định thường là 16px).
- **Developer Mode**: Chế độ dành cho nhà phát triển.
- **Auto Startup**: Tự động khởi động ứng dụng cùng Windows/macOS.
- **Check Update**: Tự động kiểm tra bản cập nhật mới.
- **Listening Port**: Cổng dịch vụ của ứng dụng (Mặc định: 60828).
- **Proxy**: Cấu hình mạng trung gian nếu bạn cần vượt rào cản mạng hoặc tăng tốc độ truy cập các dịch vụ quốc tế.

![General Settings](./images/GeneralSetting.png)

### 1.2. Translate Settings (Cài đặt dịch thuật)
Tùy chỉnh các thông số liên quan đến quá trình dịch văn bản.
- **Language**: Thiết lập ngôn ngữ nguồn (Source), ngôn ngữ đích (Target) và ngôn ngữ đích phụ (Secondary Target).
- **Language Detection Engine**: Công cụ nhận diện ngôn ngữ tự động (ví dụ: Google).
- **Auto Copy**: Tự động sao chép kết quả dịch vào Clipboard.
- **Disable History**: Không lưu lại lịch sử các đoạn đã dịch.
- **Incremental/Dynamic Translation**: Dịch tức thời khi bạn đang nhập liệu.
- **Remember Target Language**: Ghi nhớ ngôn ngữ đích cuối cùng bạn đã sử dụng.
- **Window Position**: Vị trí hiển thị cửa sổ dịch (Theo chuột hoặc vị trí cố định).
- **Window Opacity**: Độ trong suốt của cửa sổ dịch.

![Translation Settings](./images/TranslationSetting.png)

### 1.3. Recognition Settings (Cài đặt nhận diện OCR)
Cấu hình cho tính năng nhận diện chữ từ hình ảnh.
- **Recognition Language**: Ngôn ngữ cần nhận diện (Tự động hoặc chỉ định sẵn).
- **Auto Delete Newline**: Tự động xóa các dấu ngắt dòng khi nhận diện văn bản.
- **Close window when focus lost**: Tự động đóng cửa sổ khi click ra ngoài.

![Recognition Settings](./images/RecognitionSetting.png)

### 1.4. Realtime Translate Settings (Dịch âm thanh thời gian thực)
Dành cho tính năng Monitor, dịch trực tiếp âm thanh từ hệ thống hoặc Microphone.
- **Transcription Provider**: Chọn dịch vụ chuyển âm thanh thành văn bản (ví dụ: Deepgram, Soniox).
- **Transcript Auto-save**: Tự động lưu nhật ký hội thoại vào file Markdown tại thư mục `~/Documents/TransKit/`.
- **AI Suggestion**: Sử dụng AI (như Google Gemini) để đưa ra các gợi ý, tóm tắt hoặc giải thích ngữ cảnh dựa trên đoạn hội thoại.
- **Voice Playback (TTS)**: Cấu hình giọng đọc và tốc độ đọc lại văn bản đã dịch.

![Realtime Translate Settings](./images/RealtimeTranslateSetting.png)

### 1.5. Hotkey (Phím tắt)
Thiết lập các tổ hợp phím để kích hoạt nhanh các tính năng:
- **Selection Translate**: Dịch đoạn văn bản đã bôi đen.
- **Input Translate**: Mở cửa sổ nhập liệu để dịch 2 chiều.
- **OCR Recognize**: Kích hoạt vùng chụp màn hình để nhận diện chữ.
- **OCR Translate**: Kích hoạt chụp màn hình và dịch trực tiếp trên ảnh.
- **Audio Monitor**: Mở/đóng màn hình dịch âm thanh Realtime.

### 1.6. Service (Các dịch vụ cung cấp)
Nơi bạn quản lý API Key và các nhà cung cấp cho từng loại vụ:
- **Translate**: Các dịch vụ dịch (Google, Bing, Deepgram, Gemini, ...).
- **Recognize**: Dịch vụ OCR (Tesseract, System, ...).
- **TTS**: Chuyển văn bản thành giọng nói (Edge TTS, ElevenLabs, ...).
- **AI**: Cung cấp AI cho các gợi ý thông minh.
- **Transcription**: Dịch vụ chuyển Speech-to-text cho tính năng Realtime.
- **Collection**: Quản lý bộ sưu tập từ vựng hoặc lịch sử.

---

## 2. Các màn hình chức năng chính

### 2.1. Màn hình dịch thông minh (Smart Translation)
**Cách sử dụng**: Bôi đen đoạn văn bản bất kỳ > Nhấn Hotkey bôi đen.
- Cửa sổ dịch sẽ hiển thị ngay tại vị trí chuột.
- Hiển thị kết quả từ nhiều nhà cung cấp cùng lúc để bạn so sánh.
- Có các nút chức năng nhanh: Sao chép, Đọc (TTS), Ghim cửa sổ.

![Màn hình dịch thông minh](./images/TranslateSettingService.png)

### 2.2. Màn hình dịch trực tiếp (Direct Translation)
**Cách sử dụng**: Mở bằng Hotkey hoặc từ Menu ứng dụng.
- Cho phép nhập văn bản thủ công ở ô trên và nhận kết quả ở ô dưới.
- Hỗ trợ dịch 2 chiều linh hoạt thông qua phím chuyển đổi ngôn ngữ.

![Màn hình dịch trực tiếp](./images/Translate.png)

### 2.3. Màn hình dịch OCR / Phát hiện văn bản
**Cách sử dụng**: Nhấn Hotkey OCR > Quét vùng màn hình cần lấy chữ.
- Ứng dụng sẽ chụp ảnh vùng đó và xử lý bằng các thuật toán OCR.
- Văn bản sau khi nhận diện có thể được copy hoặc dịch ngay lập tức.

![Màn hình dịch OCR](./images/RecognitionSetting.png)

### 2.4. Màn hình dịch Audio Realtime (Monitor)
Đây là tính năng cao cấp cho phép theo dõi hội thoại (Meeting, Video, ...) trong thời gian thực.
- **Nút Chạy (Start/Stop)**: Bắt đầu hoặc dừng lắng nghe âm thanh.
- **Chế độ Phụ đề (Subtitle Mode)**: Chế độ thu nhỏ, chỉ hiển thị một dòng phụ đề chạy dưới màn hình, rất hữu ích khi xem phim hoặc họp trực tuyến.
- **Ghi nhật ký**: Toàn bộ hội thoại được lưu lại với Speaker ID (nếu dịch vụ hỗ trợ) và bản dịch tương ứng.
- **AI Context**: Panel bên cạnh hiển thị các gợi ý thông minh từ AI dựa trên những gì đang được nói đến.

![Màn hình dịch Audio Realtime](./images/RealtimeMonitorWithAISuggestion.png)

Submode (Subtitle mode): Hiển thị phụ đề chạy dưới màn hình, rất hữu ích khi xem phim hoặc họp trực tuyến.

![Màn hình dịch Audio Realtime](./images/Submode.png)
---
*Lưu ý: Bạn cần cấu hình API Key cho các dịch vụ trả phí trong mục **Service** để đạt được chất lượng dịch và nhận diện tốt nhất.*

> [!TIP]
> **Dành cho lập trình viên build từ source**: Nếu bạn muốn vô hiệu hóa các tính năng Cloud (Đăng nhập, Trial key), hãy copy file `.env.example` thành `.env` và đặt `VITE_DISABLE_CLOUD=true` trước khi build.
