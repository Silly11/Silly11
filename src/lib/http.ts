import { NextRequest, NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function appUrl(request?: NextRequest): string {
  const url =
    process.env.APP_URL ||
    (process.env.NODE_ENV !== "production" && request?.nextUrl.origin) ||
    "http://localhost:3000";
  return new URL(url).origin;
}

export function assertOrigin(request: NextRequest): void {
  const origin = request.headers.get("origin");
  if (!origin || origin !== appUrl(request))
    throw new HttpError(403, "Yêu cầu không hợp lệ. Hãy tải lại trang.");
}

export async function readJson(
  request: NextRequest,
): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new HttpError(415, "Định dạng yêu cầu không hợp lệ.");
  const text = await readText(request, 20000);
  try {
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== "object")
      throw new Error();
    return value;
  } catch {
    throw new HttpError(400, "Nội dung yêu cầu không hợp lệ.");
  }
}

export async function readText(
  request: NextRequest,
  limit: number,
): Promise<string> {
  if (Number(request.headers.get("content-length")) > limit)
    throw new HttpError(413, "Nội dung quá dài.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Thiếu nội dung.");
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new HttpError(413, "Nội dung quá dài.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function failure(error: unknown): NextResponse {
  if (error instanceof HttpError)
    return json({ error: error.message }, error.status);
  if (error instanceof Error && error.name === "ZodError")
    return json({ error: "Vui lòng kiểm tra lại các thông tin đã nhập." }, 400);
  // Domain errors are deliberately user-facing; unexpected storage/provider errors stay private.
  if (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number"
  )
    return json({ error: error.message }, error.status);
  console.error(
    "Request failed:",
    error instanceof Error ? error.name : "UnknownError",
  );
  return json({ error: "Chưa thể xử lý yêu cầu. Bạn thử lại sau nhé." }, 500);
}
