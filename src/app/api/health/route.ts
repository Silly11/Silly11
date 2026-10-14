import { db } from "@/lib/db";
import { json } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    db().prepare("SELECT 1").get();
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 503);
  }
}
