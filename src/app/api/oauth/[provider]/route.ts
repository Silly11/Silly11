import { NextRequest } from "next/server";
import { beginOAuth } from "@/lib/oauth";
import { failure } from "@/lib/http";
import { requestAddress, throttle } from "@/lib/auth";
export const runtime = "nodejs";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    throttle(`oauth:${requestAddress(request)}`, 30, 900000);
    return beginOAuth((await params).provider, request);
  } catch (error) {
    return failure(error);
  }
}
