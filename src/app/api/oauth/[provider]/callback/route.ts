import { NextRequest } from "next/server";
import { finishOAuth } from "@/lib/oauth";
import { failure, HttpError, readText } from "@/lib/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ provider: string }> };
export async function GET(request: NextRequest, { params }: Context) {
  try {
    return await finishOAuth(
      (await params).provider,
      request,
      request.nextUrl.searchParams,
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: NextRequest, { params }: Context) {
  try {
    if ((await params).provider !== "apple")
      throw new HttpError(405, "Phương thức không hợp lệ.");
    const body = await readText(request, 16000);
    return await finishOAuth("apple", request, new URLSearchParams(body));
  } catch (error) {
    return failure(error);
  }
}
