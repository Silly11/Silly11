import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";
import {
  authDb,
  currentUser,
  digest,
  newUser,
  secret,
  setSession,
} from "./auth";
import { appUrl, HttpError } from "./http";

type Provider = "google" | "facebook" | "apple";
const supported: Provider[] = ["google", "facebook", "apple"];
export function oauthProviders(): string[] {
  return supported.filter(
    (p) =>
      !!(
        process.env[`${p.toUpperCase()}_CLIENT_ID`] &&
        process.env[`${p.toUpperCase()}_CLIENT_SECRET`] &&
        process.env.APP_URL &&
        (p !== "apple" || process.env.APP_URL.startsWith("https://"))
      ),
  );
}
function providerConfig(name: string) {
  if (!oauthProviders().includes(name))
    throw new HttpError(
      503,
      "Nhà phát hành chưa cấu hình phương thức đăng nhập này.",
    );
  const provider = name as Provider;
  const prefix = provider.toUpperCase();
  const urls = {
    google: {
      authorize: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
    },
    facebook: {
      authorize: "https://www.facebook.com/v22.0/dialog/oauth",
      token: "https://graph.facebook.com/v22.0/oauth/access_token",
    },
    apple: {
      authorize: "https://appleid.apple.com/auth/authorize",
      token: "https://appleid.apple.com/auth/token",
    },
  }[provider];
  return {
    provider,
    clientId: process.env[`${prefix}_CLIENT_ID`]!,
    clientSecret: process.env[`${prefix}_CLIENT_SECRET`]!,
    ...urls,
  };
}
function redirectUri(provider: string, request: NextRequest) {
  return new URL(`/api/oauth/${provider}/callback`, appUrl(request)).toString();
}

export function beginOAuth(provider: string, request: NextRequest) {
  const config = providerConfig(provider);
  const state = secret(),
    nonce = secret(),
    verifier = secret();
  const user = currentUser(request);
  authDb()
    .prepare("DELETE FROM oauth_states WHERE expiresAt<?")
    .run(Date.now());
  authDb()
    .prepare("INSERT INTO oauth_states VALUES(?,?,?,?,?,?)")
    .run(
      digest(state),
      nonce,
      user?.id || null,
      verifier,
      provider,
      Date.now() + 600000,
    );
  const url = new URL(config.authorize);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(provider, request));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (provider !== "facebook") {
    url.searchParams.set(
      "scope",
      provider === "apple" ? "name email" : "openid email profile",
    );
    url.searchParams.set("nonce", nonce);
    if (provider === "google") {
      url.searchParams.set(
        "code_challenge",
        Buffer.from(digest(verifier), "hex").toString("base64url"),
      );
      url.searchParams.set("code_challenge_method", "S256");
    } else url.searchParams.set("response_mode", "form_post");
  } else url.searchParams.set("scope", "email,public_profile");
  const response = NextResponse.redirect(url);
  response.cookies.set("cosmic_oauth", state, {
    httpOnly: true,
    secure: provider === "apple" || process.env.NODE_ENV === "production",
    sameSite: provider === "apple" ? "none" : "lax",
    path: "/api/oauth",
    maxAge: 600,
  });
  return response;
}

export async function finishOAuth(
  provider: string,
  request: NextRequest,
  input: URLSearchParams,
) {
  const config = providerConfig(provider);
  const state = input.get("state") || "";
  if (!state || state !== request.cookies.get("cosmic_oauth")?.value)
    throw new HttpError(400, "Phiên đăng nhập đã hết hạn. Hãy bắt đầu lại.");
  const saved = authDb()
    .prepare(
      "DELETE FROM oauth_states WHERE stateHash=? AND provider=? AND expiresAt>? RETURNING *",
    )
    .get(digest(state), provider, Date.now());
  if (!saved || !input.get("code") || input.has("error"))
    throw new HttpError(400, "Đăng nhập đã hủy hoặc hết hạn.");
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code: input.get("code")!,
    redirect_uri: redirectUri(provider, request),
    grant_type: "authorization_code",
  });
  if (provider === "google")
    params.set("code_verifier", String(saved.verifier));
  const tokenResponse = await fetch(config.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(15000),
  });
  if (!tokenResponse.ok)
    throw new HttpError(502, "Không thể xác nhận tài khoản liên kết.");
  const token = await tokenResponse.json();
  let providerId: string,
    email: string | undefined,
    name = "Một vì sao",
    verified = false;
  if (provider === "facebook") {
    const infoResponse = await fetch(
      "https://graph.facebook.com/v22.0/me?fields=id,name,email",
      {
        headers: { Authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!infoResponse.ok)
      throw new HttpError(502, "Không thể đọc hồ sơ đăng nhập.");
    const info = await infoResponse.json();
    if (typeof info.id !== "string")
      throw new HttpError(400, "Hồ sơ không hợp lệ.");
    providerId = info.id;
    email = info.email;
    name = info.name || name;
  } else {
    const google = provider === "google";
    const jwks = createRemoteJWKSet(
      new URL(
        google
          ? "https://www.googleapis.com/oauth2/v3/certs"
          : "https://appleid.apple.com/auth/keys",
      ),
    );
    const { payload } = await jwtVerify(token.id_token, jwks, {
      issuer: google
        ? ["https://accounts.google.com", "accounts.google.com"]
        : "https://appleid.apple.com",
      audience: config.clientId,
      algorithms: ["RS256"],
    });
    if (payload.nonce !== saved.nonce || !payload.sub)
      throw new HttpError(400, "Chứng thực đăng nhập không hợp lệ.");
    providerId = payload.sub;
    email = typeof payload.email === "string" ? payload.email : undefined;
    verified =
      payload.email_verified === true || payload.email_verified === "true";
    if (typeof payload.name === "string") name = payload.name;
    if (provider === "apple" && input.get("user")) {
      try {
        const info = JSON.parse(input.get("user")!);
        name =
          [info.name?.firstName, info.name?.lastName]
            .filter(Boolean)
            .join(" ") || name;
      } catch {
        /* Optional Apple first-login display name. */
      }
    }
  }
  const sql = authDb();
  const existing = sql
    .prepare(
      "SELECT userId FROM oauth_accounts WHERE provider=? AND providerId=?",
    )
    .get(provider, providerId);
  let userId: string;
  if (saved.userId) {
    userId = String(saved.userId);
    if (!sql.prepare("SELECT id FROM users WHERE id=?").get(userId))
      throw new HttpError(401, "Tài khoản không còn tồn tại.");
    if (existing && existing.userId !== userId)
      throw new HttpError(409, "Tài khoản liên kết này đang được sử dụng.");
    const link = sql
      .prepare(
        "SELECT providerId FROM oauth_accounts WHERE userId=? AND provider=?",
      )
      .get(userId, provider);
    if (link && link.providerId !== providerId)
      throw new HttpError(
        409,
        "Bạn đã liên kết một tài khoản khác của dịch vụ này.",
      );
  } else if (existing) userId = String(existing.userId);
  else {
    if (
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254
    )
      throw new HttpError(
        400,
        "Dịch vụ chưa cung cấp email. Hãy đăng ký bằng email rồi liên kết trong Cài đặt.",
      );
    email = email.trim().toLowerCase();
    if (sql.prepare("SELECT id FROM users WHERE email=?").get(email))
      throw new HttpError(
        409,
        "Email đã có tài khoản. Hãy đăng nhập bằng phương thức cũ rồi liên kết trong Cài đặt.",
      );
    userId = newUser(String(name).slice(0, 60), email, null, verified);
  }
  sql
    .prepare(
      "INSERT OR IGNORE INTO oauth_accounts(provider,providerId,userId) VALUES(?,?,?)",
    )
    .run(provider, providerId, userId);
  // Provider access/refresh tokens are intentionally not stored: only the login identity is needed.
  const response = NextResponse.redirect(
    new URL("/?linked=1", appUrl(request)),
    303,
  );
  response.cookies.set("cosmic_oauth", "", { path: "/api/oauth", maxAge: 0 });
  setSession(response, userId);
  return response;
}
