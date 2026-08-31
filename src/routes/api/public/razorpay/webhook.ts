import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

export const Route = createFileRoute("/api/public/razorpay/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["RAZORPAY_WEBHOOK_SECRET"] ?? process.env["RAZORPAY_KEY_SECRET"];
        const signature = request.headers.get("x-razorpay-signature") ?? "";
        const raw = await request.text();

        if (!secret) return new Response("Webhook secret not configured", { status: 500 });

        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expected);
        if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: {
          event?: string;
          payload?: {
            payment?: { entity?: { id?: string; order_id?: string; error_description?: string } };
            payment_link?: { entity?: { reference_id?: string; status?: string } };
          };
        };
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const event = payload.event ?? "unknown";
        const payment = payload.payload?.payment?.entity;
        const link = payload.payload?.payment_link?.entity;

        let orderQuery = null as null | { column: "razorpay_order_id" | "id"; value: string };
        if (payment?.order_id) orderQuery = { column: "razorpay_order_id", value: payment.order_id };
        else if (link?.reference_id) orderQuery = { column: "id", value: link.reference_id };

        if (orderQuery) {
          const { data: order } = await supabaseAdmin
            .from("orders")
            .select("id, session_id")
            .eq(orderQuery.column, orderQuery.value)
            .maybeSingle();

          if (order) {
            const paid = event === "payment.captured" || event === "payment_link.paid";
            await supabaseAdmin
              .from("orders")
              .update({
                status: paid ? "paid" : event === "payment.failed" ? "failed" : "awaiting_payment",
                razorpay_payment_id: payment?.id ?? null,
                failure_reason: event === "payment.failed" ? (payment?.error_description ?? "Payment failed") : null,
              })
              .eq("id", order.id);

            await supabaseAdmin.from("audit_events").insert({
              session_id: order.session_id,
              actor: "razorpay",
              event_type: `webhook.${event}`,
              summary: paid
                ? "Payment settled in Razorpay test mode."
                : `Razorpay reported ${event} for this order.`,
              detail: { event, payment_id: payment?.id ?? null } as never,
            });

            if (paid && order.session_id) {
              await supabaseAdmin
                .from("agent_sessions")
                .update({ status: "settled", outcome: "Payment captured in Razorpay test mode." })
                .eq("id", order.session_id);
            }
          }
        }

        return Response.json({ received: true });
      },
    },
  },
});
