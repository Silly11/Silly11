import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  authDb,
  checkPassword,
  clearSession,
  currentUser,
  digest,
  hashPassword,
  newUser,
  requestAddress,
  requireUser,
  secret,
  setSession,
  throttle,
} from "@/lib/auth";
import {
  appUrl,
  assertOrigin,
  failure,
  HttpError,
  json,
  readJson,
} from "@/lib/http";
import { emailEnabled, sendVerification } from "@/lib/email";

export const runtime = "nodejs";
const credentials = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase().trim()),
  password: z.string().min(10).max(128),
});
type Context = { params: Promise<{ action: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    assertOrigin(request);
    const { action } = await context.params;
    throttle(`auth:${requestAddress(request)}`, 30, 15 * 60000);
    if (action === "logout") {
      const response = json({ ok: true });
      clearSession(response, request);
      return response;
    }
    if (action === "verify-request") {
      const user = requireUser(request);
      throttle(`verify:${user.id}`, 3, 3600000);
      if (!emailEnabled())
        throw new HttpError(
          503,
          "Gửi email chưa được cấu hình; thông báo trong website vẫn hoạt động.",
        );
      if ((user as unknown as { emailVerified: boolean }).emailVerified)
        return json({ ok: true });
      const token = secret();
      authDb()
        .prepare("DELETE FROM auth_tokens WHERE userId=? AND purpose='verify'")
        .run(user.id);
      authDb()
        .prepare("INSERT INTO auth_tokens VALUES(?,?,'verify',?)")
        .run(
          digest(token),
          user.id,
          new Date(Date.now() + 1800000).toISOString(),
        );
      await sendVerification(user.email, token);
      return json({ ok: true });
    }
    const body = await readJson(request);
    const { email, password } = credentials.parse(body);
    throttle(`email:${email}`, 10, 15 * 60000);
    let userId: string;
    if (action === "register") {
      const name = z.string().trim().min(1).max(60).parse(body.name);
      if (authDb().prepare("SELECT id FROM users WHERE email=?").get(email))
        throw new HttpError(
          409,
          "Email này đã có tài khoản. Bạn hãy đăng nhập.",
        );
      userId = newUser(name, email, await hashPassword(password));
    } else if (action === "login") {
      const row = authDb()
        .prepare("SELECT id,passwordHash FROM users WHERE email=?")
        .get(email);
      const valid = await checkPassword(
        password,
        row?.passwordHash ? String(row.passwordHash) : null,
      );
      if (!row || !valid)
        throw new HttpError(401, "Email hoặc mật khẩu chưa đúng.");
      userId = String(row.id);
    } else throw new HttpError(404, "Không tìm thấy chức năng.");
    const response = json({ ok: true });
    clearSession(response, request);
    setSession(response, userId);
    return response;
  } catch (error) {
    return failure(error);
  }
}

export async function GET(request: NextRequest, context: Context) {
  try {
    if ((await context.params).action !== "verify")
      throw new HttpError(404, "Không tìm thấy chức năng.");
    const token = request.nextUrl.searchParams.get("token") || "";
    const row = authDb()
      .prepare(
        "DELETE FROM auth_tokens WHERE tokenHash=? AND purpose='verify' AND expiresAt>? RETURNING userId",
      )
      .get(digest(token), new Date().toISOString());
    if (!row)
      throw new HttpError(
        400,
        "Liên kết xác nhận đã hết hạn hoặc không hợp lệ.",
      );
    authDb()
      .prepare("UPDATE users SET emailVerified=1 WHERE id=?")
      .run(String(row.userId));
    return NextResponse.redirect(new URL("/?verified=1", appUrl(request)));
  } catch (error) {
    return failure(error);
  }
}
