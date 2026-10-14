import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getSupportDetail } from "@/lib/domain";
import { failure, json } from "@/lib/http";
export const runtime = "nodejs";
export function GET(request: NextRequest) {
  try {
    return json(
      getSupportDetail(
        requireUser(request),
        request.nextUrl.searchParams.get("id") || "",
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
