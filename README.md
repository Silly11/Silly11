# COSMIC ECHO · Tiếng Vọng Thiên Hà

> Gửi nỗi lòng vào thiên hà, nhận lại sự bình yên.
>
> “sẽ có một ai đó xuất hiện và bên bạn, bạn không một mình đâu”

Ứng dụng web tiếng Việt dùng **Next.js 16, React 19, TypeScript và SQLite (Node.js 24)**. Giao diện responsive phong cách vũ trụ, dữ liệu lưu thật trên máy chủ. Không có tài khoản mẫu, nâng cấp giả, câu trả lời AI giả hay giả lập người hỗ trợ.

## Chạy trên máy phát triển

```bash
npm ci
cp .env.example .env.local
npm run dev
# Terminal thứ hai, cùng DATA_DIR:
npm run worker
```

Mở `http://localhost:3000`. Đăng ký tài khoản bằng email và mật khẩu ít nhất 10 ký tự. Không cần cấu hình dịch vụ ngoài để viết tâm tư, chia sẻ công khai, tạo nhóm hoặc thư tương lai.

Cấp quyền nhà phát hành cho **tài khoản đã đăng ký** từ máy chủ:

```bash
npm run admin -- grant admin@example.com admin
npm run admin -- grant expert@example.com expert
npm run admin -- revoke expert@example.com
```

Không có mật khẩu quản trị mặc định. Quản trị viên có thể cấp/thu hồi quyền chuyên gia trong giao diện; tài khoản thường không được tự cấp quyền hoặc tự bật Premium. Tích xanh xác nhận quyền do nhà phát hành cấp, không tự chứng nhận bằng cấp hành nghề.

## Tính năng hiện có

- **Khách:** viết tâm tư riêng trong bộ nhớ của trang, mất khi tải lại/đóng trang; giao diện báo rõ. Đăng ký để lưu lâu dài, công khai, tham gia nhóm, gửi thư hoặc trò chuyện. Tâm tư khách không tự chuyển vào tài khoản.
- **Thiên hà riêng và chung:** niềm vui, nỗi buồn, lời chưa nói; tìm kiếm/lọc; danh tính công khai ẩn danh, biệt danh hoặc tên tài khoản do người viết chọn. Không trả email/ID tài khoản thật của tác giả ẩn danh qua API.
- **Nhóm:** tạo nhóm có/không có mật khẩu, kiểm tra thành viên ở máy chủ khi đọc/đăng bài. Nhóm không mật khẩu cho phép người có tài khoản tham gia.
- **Kết nối:** lời mời trong Tin nhắn chờ/Thông báo, chấp nhận/từ chối; trò chuyện riêng sau khi hai bên đồng ý. Chỉ hai người tham gia được đọc/gửi.
- **Thư tương lai:** chỉ tài khoản đăng ký, ngày nhận trong tương lai; ngày/nội dung không sửa được; xóa hủy lịch nhận. Ngày nhập theo múi giờ thiết bị, lưu UTC; hiển thị lại theo múi giờ thiết bị. Thông báo trong web đến hạn; email tùy chọn, đã xác minh và chủ động bật.
- **AI:** 5 tin nhắn người dùng được xử lý thành công mỗi lượt; trả lời AI không tính vào 5. Sau tin thứ 5 chờ 2 tiếng tính từ lúc hoàn tất. Lỗi nhà cung cấp không trừ lượt; chống gửi đồng thời bằng reservation có thời hạn. Máy chủ giữ quota, tải lại trang không đặt lại.
- **Premium:** 10 USD/tháng. Sau 5 lượt AI, chuyển hàng đợi người hỗ trợ; có thể gửi tin trong khi chờ. Nâng cấp trong thời gian cooldown cũng mở hàng đợi. Chỉ webhook thanh toán đã xác minh mới cấp quyền trả phí. Gửi tâm sự 24/7, hỗ trợ quản trị viên nằm trong giá gói.
- **Hỗ trợ:** chuyên gia được xác minh/quản trị viên nhận yêu cầu Premium, đọc hội thoại và những bài riêng tư người dùng chọn chia sẻ với đội hỗ trợ. Máy chủ kiểm tra Premium còn hạn và quyền hiện tại cho mỗi thao tác. Chuyên gia không được đọc nội dung riêng tư người dùng thường. Tên cá nhân người hỗ trợ được ẩn, nhãn AI/người hỗ trợ vẫn rõ ràng. Các bài Premium được che bằng nút con mắt trước khi mở.
- **Vận hành:** hàng đợi đánh dấu yêu cầu chờ quá 1 tiếng; đây là mục tiêu cần người trực, phần mềm không tạo ra cam kết nhân sự. Không cung cấp dịch vụ cấp cứu hoặc tư vấn y khoa tự động.

## Dữ liệu, sao lưu và xóa

Dữ liệu được lưu ngay sau thao tác thành công. Giao diện cập nhật định kỳ; worker tạo bản sao lưu **mỗi giờ**. Dùng bản sao lưu để phục hồi sự cố, không dùng làm kho nội dung bí mật.

- Mặc định kỹ thuật ban đầu: **30 ngày** (`BACKUP_RETENTION_DAYS`), cần nhà phát hành chốt và công bố trước khi ra mắt.
- Bản sao lưu theo từng tài khoản, mã hóa AES-256-GCM; khóa riêng lưu ngoài thư mục snapshot. Không sao lưu mật khẩu, session, token OAuth hoặc nội dung người khác.
- Xóa bài/thư sẽ xóa dữ liệu hoạt động và hủy toàn bộ snapshot cũ của chủ tài khoản cùng khóa liên quan trong cùng khóa ghi SQLite. Sao lưu giờ tiếp theo chỉ chứa dữ liệu còn lại.
- Xóa tài khoản cần mật khẩu (hoặc phiên OAuth được đăng nhập lại trong 15 phút) và nhập `XOA VINH VIEN`. Hủy gia hạn thanh toán trước khi xóa; lỗi thanh toán khiến thao tác dừng và báo rõ. Dữ liệu liên quan, session, lời mời, hội thoại, thư và bản sao lưu của tài khoản bị xóa. Nếu người xóa sở hữu nhóm, bài của thành viên khác được giữ riêng tư cho chính tác giả.
- SQLite bật secure-delete, checkpoint WAL sau khi xóa. Không có tính năng khôi phục nội dung đã xóa hoàn toàn. Chỉ báo thành công sau khi thao tác xóa hoàn tất.
- Email đang đợi bị hủy khi thư bị xóa. Email đã được nhà cung cấp nhận gửi không thể thu hồi; email thông báo không chứa nội dung thư.
- Chính sách trên áp dụng cho dữ liệu và snapshot do ứng dụng quản lý. Khi vận hành không được tạo bản sao ổ đĩa/khóa không có cơ chế hết hạn và áp dụng yêu cầu xóa. Thời gian lưu chứng từ của nhà cung cấp thanh toán và chính sách lưu dữ liệu của nhà cung cấp AI/email cần được công bố riêng.

Worker không phải dịch vụ lịch của Slack. Chạy đúng **một worker** cho mỗi `DATA_DIR`. Nó kiểm tra thư đến hạn mỗi phút; thông báo trong web cũng được cập nhật khi người dùng mở trang. Worker có retry email, khóa chống trùng và không ghi nội dung tâm tư vào log. Có thể chạy một lượt:

```bash
npm run worker -- --once
```

Bản sao lưu mã hóa hiện cần quy trình phục hồi có giám sát bởi người vận hành; không có nút tự khôi phục tài khoản hoặc công cụ phục hồi tự động trong bản đầu.

## Tích hợp dịch vụ

Các tính năng chưa cấu hình hiển thị trạng thái chưa sẵn sàng. Không cần gửi khóa bí mật trong chat; cấu hình chúng tại môi trường triển khai.

### AI

Đặt `OPENAI_API_KEY` và `OPENAI_MODEL` cho một model hỗ trợ Responses API. Mỗi yêu cầu gửi tối đa 10 tin gần nhất của chính người dùng và tin hiện tại, `store: false`, không gửi nhật ký/thư riêng. Giới hạn 5 lượt được tính tại ứng dụng, độc lập với giới hạn API.

Tài liệu đối chiếu: [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create). Chưa kiểm thử bằng khóa AI thật trong môi trường phát triển này.

### Đăng nhập/liên kết Google, Facebook, Apple

Đặt `APP_URL` đúng domain và cặp `*_CLIENT_ID`/`*_CLIENT_SECRET`. Đăng ký callback chính xác:

```text
https://your-domain.example/api/oauth/google/callback
https://your-domain.example/api/oauth/facebook/callback
https://your-domain.example/api/oauth/apple/callback
```

- Google: OAuth/OIDC, scope `openid email profile`, PKCE, kiểm tra issuer/audience/nonce/chữ ký.
- Facebook: Facebook Login, email/public_profile; phiên bản Graph v22.0. Nếu không có email, đăng ký trước rồi liên kết trong Cài đặt.
- Apple: Sign in with Apple (không phải truy cập iCloud), bắt buộc HTTPS, `form_post`; client secret là JWT đã ký có hạn dùng do nhà phát hành cấu hình và luân chuyển.
- Cùng email **không tự gộp tài khoản**: đăng nhập phương thức hiện có rồi liên kết. Chỉ lưu định danh provider, không lưu access/refresh token.
- Liên kết phục vụ đăng nhập; không có thông báo Facebook Messenger/iCloud tự động. Kênh ngoài web hiện được triển khai là email đã xác minh, có thể là Gmail/iCloud Mail hoặc địa chỉ relay Apple.

### Email

Đặt `RESEND_API_KEY`, `EMAIL_FROM` từ domain đã xác minh và `APP_URL`. Trong Cài đặt, yêu cầu xác minh email rồi bật thông báo. Mỗi thư đến hạn chỉ gửi thông báo chung dẫn về web, không kèm nội dung riêng tư.

### Thanh toán

Đặt `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_URL`. Checkout định giá tại máy chủ **1.000 cent USD/tháng**. Không lấy giá, quyền Premium hay ngày hết hạn từ trình duyệt. Đăng ký Stripe webhook `/api/billing/webhook` cho:

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
```

Chữ ký có kiểm tra thời gian, xử lý idempotent, đối chiếu trạng thái hiện tại từ Stripe. Bật Stripe Customer Portal để người dùng quản lý/hủy gia hạn. Không cấp Premium chỉ vì quay lại trang thành công. Trước ra mắt cần kiểm tra sandbox thanh toán thực tế, chính sách thuế/hoàn tiền và hủy gia hạn.

## Kiểm tra

```bash
npm run format:check
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Unit/integration tests dùng dữ liệu tạm: quyền truy cập, ẩn danh, quota/cooldown, nhóm, thư bất biến, hàng đợi hỗ trợ, thu hồi quyền, kết nối, sao lưu/xóa, xác minh webhook và thanh toán giả lập. Browser/HTTP tests kiểm tra luồng người dùng thực tế. Dịch vụ bên ngoài được mock trong test; không coi đó là xác minh live.

## Triển khai

Ứng dụng cần **Node.js 24**, ổ đĩa bền vững, một web instance và một worker trên cùng máy/volume SQLite. Không chạy SQLite trên filesystem tạm của serverless, nhiều replica hoặc network filesystem.

```bash
npm ci
npm run build
npm start
npm run worker
# Hoặc Docker, sau khi cấu hình .env.local:
docker compose up --build -d
```

Đặt reverse proxy HTTPS phía trước `127.0.0.1:3000`. `APP_URL` phải trùng origin của website; chỉ bật `TRUST_PROXY=true` nếu proxy ghi đè header địa chỉ khách. Cookie production yêu cầu HTTPS. Giới hạn request/bảo vệ CSRF có tại ứng dụng; proxy nên giới hạn body và lưu lượng. Các khóa, DB, thư sao lưu và file `.env.local` không được commit.

Chưa triển khai lên domain công khai. Chưa có app mobile, push notification, cuộc gọi thoại/video, dashboard thống kê hoặc phần mềm quản lý ca trực. Bộ lưu trữ SQLite hiện phù hợp bản đầu một máy; cần chuyển sang cơ sở dữ liệu dùng chung trước khi mở rộng nhiều máy.
