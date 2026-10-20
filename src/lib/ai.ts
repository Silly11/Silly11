import { z } from "zod";
import { db } from "./db";
import {
  completeAiTurn,
  getState,
  releaseAiTurn,
  reserveAiTurn,
  sendHumanMessage,
} from "./domain";
import { HttpError } from "./http";
import type { User } from "./types";

export function aiEnabled() {
  return !!(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);
}

export async function sendChat(user: User, payload: unknown) {
  const { content } = z
    .object({ content: z.string().trim().min(1).max(4000) })
    .parse(payload);
  const state = getState(user);
  if (state.chat.status !== "ai") {
    sendHumanMessage(user, content);
    return;
  }
  if (!aiEnabled())
    throw new HttpError(
      503,
      "Trò chuyện AI chưa được cấu hình. Bạn vẫn có thể viết tâm tư trong thiên hà của mình.",
    );
  const { reservationId } = reserveAiTurn(user.id);
  try {
    const history = db()
      .prepare(
        "SELECT kind,content FROM messages WHERE userId=? AND kind IN ('user','ai') ORDER BY createdAt DESC,rowid DESC LIMIT 10",
      )
      .all(user.id)
      .reverse();
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL,
        store: false,
        max_output_tokens: 700,
        instructions:
          "Bạn là AI đồng hành của COSMIC ECHO. Trả lời bằng tiếng Việt, ấm áp, ngắn gọn và không phán xét. Nói rõ mình là AI khi được hỏi; không giả danh con người, bác sĩ hoặc chuyên gia. Lắng nghe, không chẩn đoán hay kê đơn. Không khẳng định đã liên hệ đội hỗ trợ hoặc hứa có người phản hồi ngay. Nếu người dùng có nguy cơ tự hại hoặc nguy hiểm tức thời, khuyến khích liên hệ ngay người tin cậy ở gần và dịch vụ khẩn cấp tại nơi họ sống; không yêu cầu họ chờ hàng đợi Premium. Không khuyến khích phụ thuộc hay độc quyền quan hệ. Không tiết lộ hay yêu cầu bí mật đăng nhập.",
        input: [
          ...history.map((row) => ({
            role: row.kind === "ai" ? "assistant" : "user",
            content: String(row.content),
          })),
          { role: "user", content },
        ],
      }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok)
      throw new HttpError(
        502,
        "AI tạm thời chưa phản hồi được. Lượt này không bị trừ.",
      );
    const result = await response.json();
    const answer = (result.output || [])
      .filter((item: { type: string }) => item.type === "message")
      .flatMap(
        (item: { content: { type: string; text?: string }[] }) =>
          item.content || [],
      )
      .filter((item: { type: string }) => item.type === "output_text")
      .map((item: { text: string }) => item.text)
      .join("\n")
      .trim();
    if (!answer)
      throw new HttpError(502, "AI chưa trả lời được. Lượt này không bị trừ.");
    completeAiTurn(user.id, reservationId, content, answer);
  } catch (error) {
    releaseAiTurn(user.id, reservationId);
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, "Kết nối AI bị gián đoạn. Lượt này không bị trừ.");
  }
}
