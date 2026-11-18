# Agentworld

Bản Next.js của TranVuong HQ: giao diện pixel office, quản lý team và board, terminal thời gian thực, Docker Sandboxes, GitHub và Team MCP dùng cùng logic với source gốc. Next.js và server HQ chạy trong cùng một tiến trình trên `127.0.0.1`; WebSocket `/ws`, hook và MCP vẫn dùng chung cổng.

## Yêu cầu

Node.js 20 trở lên, Git và npm. Để chạy agent hoặc tích hợp GitHub cần các công cụ tương ứng: Docker Sandboxes hoặc Claude Code/Codex chạy local, tmux và GitHub CLI. Màn hình setup sẽ kiểm tra môi trường. Xem [hướng dẫn bắt đầu](docs/getting-started.md) và [cách hoạt động](docs/how-it-works.md).

## Cài đặt và chạy

```bash
cd agentworld
npm install
npm run build
npm start -- --repo /duong-dan/den/git-repo --no-open
```

Bỏ `--no-open` để tự mở trình duyệt. Nếu không truyền `--repo`, ứng dụng quản lý Git repository chứa thư mục hiện tại. Server in URL có token cho tab trình duyệt; giữ token này riêng tư. Cổng mặc định là 7420; đổi bằng `--port 7421` hoặc `HQ_PORT`.

Chạy chế độ phát triển:

```bash
npm run dev -- --repo /duong-dan/den/git-repo
```

Có thể chạy CLI trực tiếp từ bất kỳ thư mục nào sau khi build: `node /duong-dan/den/agentworld/bin/agentworld.mjs --repo /duong-dan/den/git-repo`. Dùng `--help` để xem tùy chọn. Khi mở URL không có token và không có token trong session của trình duyệt, giao diện dùng dữ liệu mô phỏng như bản gốc.

Cấu hình và board lưu trong `.jsmhq/` của repository được quản lý; token và workspace agent lưu trong `~/.jsmhq/`, tương thích với bản gốc. Chỉ chạy một server cho cùng một project tại một thời điểm.

## Đóng gói để cài vào dự án khác

Chạy `npm pack` trong `agentworld` để build và tạo gói `.tgz`. Sau đó cài gói từ đường dẫn cục bộ vào một dự án khác bằng `npm install /duong-dan/den/agentworld-0.7.5.tgz`, rồi chạy `npx --no-install agentworld --repo /duong-dan/den/git-repo`. Gói đã chứa build Next.js và không yêu cầu cài các dependency phát triển để chạy.

## Kiểm tra

```bash
npm run typecheck
npm run test:backend
npm run test:github-sync
npm run test:access
npm run test:sbx-sync
npm run build
npm run test:smoke
npm run test:smoke -- --github
npm run test:smoke -- --sandbox
npm run test:smoke -- --real-codex
npm run test:browser
npm run test:hmr
npm run test:package
```

`test:browser` và `test:hmr` cần Chrome hoặc Chromium; đặt `BROWSER_EXECUTABLE` nếu trình duyệt không nằm ở vị trí thông dụng. Các kiểm thử dùng Git repository và HOME tạm; kiểm tra trang production, xác thực, hook, MCP, WebSocket, lưu board, terminal, vòng đời agent local với CLI giả lập, phân quyền MCP, trạng thái task và Action items. `test:github-sync` kiểm tra các bước review, xung đột, merge, đóng PR, phân trang và giới hạn API qua dữ liệu giả lập (trên Windows chạy qua WSL). Tùy chọn `--github` của smoke test cũng mô phỏng PR được duyệt và merge, không gọi GitHub. `test:access` kiểm tra quyết định truy cập cho nhiều agent và hoàn tác khi một Sandbox thất bại. `test:sbx-sync` kiểm tra các lượt đồng bộ quy tắc Sandbox đồng thời bằng CLI giả lập (trên Windows chạy qua WSL). Tùy chọn `--sandbox` giả lập CLI Docker Sandboxes để kiểm tra vòng đời agent, quy tắc truy cập, khóa giả lập, proxy và đăng ký MCP, bao gồm hoàn tác khi lỗi, mà không tạo máy ảo hoặc thay đổi cấu hình Sandbox thật. Tùy chọn `--real-codex` khởi chạy Codex đã cài trong HOME tạm không đăng nhập, rồi dừng trước khi gửi task. Các luồng agent thực tế cần Docker Sandboxes hoặc CLI, tài khoản và cấu hình tương ứng.
