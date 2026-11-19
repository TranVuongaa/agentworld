# Agentworld

Agentworld quản lý nhiều dự án GitHub và team agent trên giao diện web pixel office. Chế độ phát triển local chạy trên `127.0.0.1`, dùng PostgreSQL và Docker Sandboxes. Tính năng SaaS nhiều người dùng đang được phát triển; chưa triển khai ứng dụng này lên Internet.

Để bắt đầu: chạy `npm install`, sau đó `npm run local` và mở `http://127.0.0.1:7420`. Xem phần [phát triển local](#phát-triển-ứng-dụng-nhiều-dự-án-trên-máy-local) để biết các yêu cầu và giới hạn.

## Yêu cầu

Node.js 20 trở lên, Git và npm. Để chạy agent hoặc tích hợp GitHub cần các công cụ tương ứng: Docker Sandboxes hoặc Claude Code/Codex chạy local, tmux và GitHub CLI. Màn hình setup sẽ kiểm tra môi trường. Xem [hướng dẫn bắt đầu](docs/getting-started.md) và [cách hoạt động](docs/how-it-works.md).

## Chế độ CLI một dự án cũ

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

## Đóng gói chế độ CLI cũ

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

## Phát triển ứng dụng nhiều dự án trên máy local

Chế độ local mở trang quản lý dự án tại `http://127.0.0.1:7420`. Cần Node.js 20+, Docker Desktop hoặc Docker Engine đang chạy, Git, GitHub CLI đã đăng nhập (`gh auth login`), tmux và Docker Sandboxes (`sbx`).

```bash
npm install
npm run local
```

Lệnh này tạo `.env.local` nếu chưa có (bao gồm khóa mã hóa riêng), khởi động PostgreSQL bằng Docker Compose, áp dụng schema và chạy web ở địa chỉ loopback. Nhấn **Đăng nhập bằng GitHub CLI**, chọn repository, tạo dự án và mở office để cấu hình team. Lần mở đầu tiên clone repository vào `~/.agentworld-saas/projects/<project-id>`; workspace của các agent nằm trong `~/.jsmhq/` với ID riêng cho từng dự án. Dữ liệu PostgreSQL nằm trong Docker volume `agentworld-postgres`; không xóa volume hoặc `.env.local` nếu cần giữ dữ liệu và khóa.

Agent chạy trong Docker Sandboxes theo cấu hình của office. Cấu hình khóa AI và biến môi trường cho từng agent trong mục Settings → Sandbox trước khi chạy agent. Biến thêm trên web được lưu mã hóa; lúc khởi chạy hoặc mở shell, server tạo file tạm chỉ chủ tài khoản hệ điều hành đọc được và xóa khi server dừng bình thường. Các biến trong file cục bộ cũ vẫn được giữ, với biến trên web được ưu tiên khi trùng tên. Khóa theo dự án và theo agent được mã hóa trong PostgreSQL và gắn theo từng sandbox; khóa riêng của agent được ưu tiên. GitHub sync dùng kết nối GitHub của chủ dự án. Chế độ local vẫn có thể dùng khóa toàn cục đã lưu trong sbx khi không có khóa theo dự án. Sau khi dự án được mở lần đầu, bộ điều phối dự án được khởi động lại cùng `npm run local`, giữ nguyên cổng để các agent đang chạy có thể kết nối lại. Đóng tab trình duyệt không dừng agent. Nếu bộ điều phối dự án dừng bất thường, ứng dụng tự thử khởi động lại với khoảng chờ tăng dần. Dừng server bằng Ctrl+C; database Docker vẫn chạy và có thể dừng bằng `docker compose stop`.

**Giới hạn hiện tại:** đây là chế độ phát triển cho một người dùng trên máy cá nhân. Nó dùng tài khoản `gh` và kho secret Docker Sandboxes của máy, đồng thời giữ một số trạng thái dự án trong filesystem. Chưa có cách ly tài nguyên và credentials đủ cho SaaS nhiều người dùng; không đưa chế độ này lên Internet. GitHub App có thể được thử trên local, nhưng bộ chạy agent đa người dùng chưa được cách ly đầy đủ.

Khi khởi động Codex lần đầu, mở terminal của agent để kiểm tra màn hình xác nhận. Nếu Codex yêu cầu xét duyệt hook, hãy xem các hook do Agentworld tạo và chọn tin cậy để agent nhận tin nhắn, cập nhật trạng thái và dùng công cụ của bộ điều phối. Nếu tiếp tục mà không tin cậy hook, các chức năng này có thể không hoạt động.

Để thử đăng nhập bằng GitHub App trên local, tạo và cài GitHub App cho repository cần dùng, đặt callback là `http://127.0.0.1:7420/api/auth/github/callback` và cấp quyền repository cần cho công việc, PR và kiểm tra. Trong `.env.local`, đặt `SAAS_GITHUB_AUTH=app`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_SLUG` và `GITHUB_APP_PRIVATE_KEY_PATH` (đường dẫn tới file PEM của app). Khởi động lại `npm run local`, đăng xuất rồi đăng nhập qua GitHub App. Token cấp cho agent được giới hạn ở repository được chọn. Trong chế độ App, agent cần dùng Sandbox và workspace do ứng dụng quản lý; terminal trên thanh công cụ mở shell của agent đang chạy trong sandbox. Rule mạng cho kết nối tới bộ điều phối được gắn riêng cho từng sandbox. Khi chuyển từ `gh`, phiên cũ chưa xác minh được sẽ không tự kết nối: dừng phiên đó bằng nút “Stop existing session”, chọn Sandbox và xóa đường dẫn folder tùy chỉnh trước khi khởi động lại. Workspace cũ không bị xóa. MCP cũ dùng chung trên máy không hiển thị; thêm lại MCP từ URL cho dự án nếu cần. MCP chạy bằng lệnh trên host chưa được hỗ trợ trong chế độ App. Trước khi chạy agent, cấu hình khóa riêng cho các dịch vụ có khóa toàn cục trong Docker Sandboxes để tránh dùng nhầm khóa của máy. Đặt `SAAS_GITHUB_AUTH=gh` để quay về GitHub CLI; sau khi đổi, đăng xuất và đăng nhập lại. Các dự án cũ sẽ tự gắn với installation mới nếu tài khoản vẫn có quyền và chỉ có một installation phù hợp.

Các lệnh kiểm tra lớp dữ liệu và kết nối: `npm run test:saas`, `npm run test:saas-db`, `npm run test:managed-credentials`, `npm run test:managed-env`, `npm run test:github-app` và `npm run test:project-gateway` và `npm run test:recovery` (một số kiểm thử cần PostgreSQL).
