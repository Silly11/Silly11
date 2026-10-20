import { HttpError } from "./http";

export function emailEnabled() {
  return !!(
    process.env.RESEND_API_KEY &&
    process.env.EMAIL_FROM &&
    process.env.APP_URL
  );
}

export async function sendVerification(email: string, token: string) {
  if (!emailEnabled())
    throw new HttpError(
      503,
      "Gửi email chưa được cấu hình. Bạn vẫn có thể nhận thông báo trong website.",
    );
  const url = new URL("/api/auth/verify", process.env.APP_URL);
  url.searchParams.set("token", token);
  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [email],
      subject: "Xác nhận email · COSMIC ECHO",
      text: `Xác nhận email để nhận thông báo từ COSMIC ECHO:\n${url}\n\nLiên kết có hiệu lực trong 30 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.`,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!result.ok)
    throw new HttpError(502, "Chưa gửi được email. Bạn thử lại sau nhé.");
}
