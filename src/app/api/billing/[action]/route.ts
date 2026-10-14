import { NextRequest } from "next/server";
import { requireUser, throttle } from "@/lib/auth";
import {
  createCheckout,
  createPortal,
  processStripeEvent,
} from "@/lib/billing";
import { assertOrigin, failure, HttpError, json, readText } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const { action } = await params;
    if (action === "webhook") {
      const body = await readText(request, 1000000);
      await processStripeEvent(
        body,
        request.headers.get("stripe-signature") || "",
      );
      return json({ received: true });
    }
    assertOrigin(request);
    const user = requireUser(request);
    throttle(`billing:${user.id}`, 10, 60000);
    if (action === "checkout") return json(await createCheckout(user));
    if (action === "portal") return json(await createPortal(user.id));
    throw new HttpError(404, "Không tìm thấy chức năng.");
  } catch (error) {
    return failure(error);
  }
}
