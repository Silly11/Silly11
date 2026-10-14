import { NextRequest } from "next/server";
import { z } from "zod";
import {
  authDb,
  checkPassword,
  clearSession,
  requireRecentLogin,
  requireUser,
  throttle,
} from "@/lib/auth";
import { assertOrigin, failure, HttpError, json, readJson } from "@/lib/http";
import { deleteUserData, performAction } from "@/lib/domain";
import { sendChat } from "@/lib/ai";
import { appState } from "@/lib/state";
import { cancelSubscriptionsForDeletion } from "@/lib/billing";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    assertOrigin(request);
    const user = requireUser(request);
    throttle(`action:${user.id}`, 100, 60000);
    const { action, payload } = z
      .object({ action: z.string().max(60), payload: z.unknown().optional() })
      .parse(await readJson(request));
    if (action === "account.delete") {
      throttle(`delete:${user.id}`, 5, 900000);
      const p = z
        .object({
          password: z.string().max(128).optional(),
          confirmation: z.literal("XOA VINH VIEN"),
        })
        .parse(payload);
      const row = authDb()
        .prepare("SELECT passwordHash FROM users WHERE id=?")
        .get(user.id);
      if (
        row?.passwordHash &&
        !(await checkPassword(p.password || "", String(row.passwordHash)))
      )
        throw new HttpError(401, "Mật khẩu xác nhận chưa đúng.");
      if (!row?.passwordHash) requireRecentLogin(request);
      await cancelSubscriptionsForDeletion(user.id);
      deleteUserData(user.id);
      const response = json(appState(null));
      clearSession(response, request);
      return response;
    }
    if (action === "account.notifications") {
      const { enabled } = z.object({ enabled: z.boolean() }).parse(payload);
      const row = authDb()
        .prepare("SELECT emailVerified FROM users WHERE id=?")
        .get(user.id);
      if (enabled && !row?.emailVerified)
        throw new HttpError(
          400,
          "Hãy xác nhận email trước khi bật thông báo email.",
        );
      authDb()
        .prepare("UPDATE users SET emailNotifications=? WHERE id=?")
        .run(enabled ? 1 : 0, user.id);
    } else if (action === "chat.send") await sendChat(user, payload);
    else performAction(user, action, payload);
    return json(appState(user));
  } catch (error) {
    return failure(error);
  }
}
