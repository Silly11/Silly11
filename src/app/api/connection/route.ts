import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { getConnectionDetail } from "@/lib/domain";
import { failure, json } from "@/lib/http";
export const runtime = "nodejs";
export function GET(request: NextRequest) {
  try {
    return json(
      getConnectionDetail(
        requireUser(request),
        request.nextUrl.searchParams.get("id") || "",
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
