import { NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { appState } from "@/lib/state";
import { failure, json } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) {
  try {
    return json(appState(currentUser(request)));
  } catch (error) {
    return failure(error);
  }
}
