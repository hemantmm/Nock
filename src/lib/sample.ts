import { createHmac } from "node:crypto";
import type { Endpoint } from "@prisma/client";
import { captureRequest } from "./capture";
import { signingSecretOf } from "./endpoints";
import type { HeaderPair } from "./types";

const STRIPE_BODY = JSON.stringify({
  id: "evt_hooktrace_sample",
  object: "event",
  type: "payment_intent.succeeded",
  data: {
    object: {
      id: "pi_hooktrace_sample",
      object: "payment_intent",
      amount: 2000,
      currency: "usd",
      status: "succeeded",
    },
  },
});

const GITHUB_BODY = JSON.stringify({
  zen: "Design for failure.",
  hook_id: 1,
  repository: { full_name: "hooktrace/sample" },
});

const RAZORPAY_BODY = JSON.stringify({
  entity: "event",
  event: "payment.captured",
  payload: { payment: { entity: { id: "pay_hooktrace_sample", amount: 50000, currency: "INR" } } },
});

export async function sendSample(endpoint: Endpoint, provider: "plain" | "stripe" | "github" | "razorpay") {
  const secret = signingSecretOf(endpoint).secret;
  const headers: HeaderPair[] = [{ name: "content-type", value: "application/json" }, { name: "user-agent", value: "HookTrace-Sample" }];
  let body = '{"hello":"hooktrace"}';
  let signed = false;

  if (provider === "stripe") {
    body = STRIPE_BODY;
    if (secret) {
      const timestamp = Math.floor(Date.now() / 1000);
      const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
      headers.push({ name: "stripe-signature", value: `t=${timestamp},v1=${digest}` });
      signed = true;
    }
  } else if (provider === "github") {
    body = GITHUB_BODY;
    headers.push({ name: "x-github-event", value: "ping" });
    headers.push({ name: "x-github-delivery", value: "hooktrace-sample" });
    if (secret) {
      const digest = createHmac("sha256", secret).update(body).digest("hex");
      headers.push({ name: "x-hub-signature-256", value: `sha256=${digest}` });
      signed = true;
    }
  } else if (provider === "razorpay") {
    body = RAZORPAY_BODY;
    if (secret) {
      const digest = createHmac("sha256", secret).update(body).digest("hex");
      headers.push({ name: "x-razorpay-signature", value: digest });
      signed = true;
    }
  }

  const bytes = Buffer.from(body, "utf8");
  const event = await captureRequest({
    endpoint,
    method: "POST",
    path: `/h/${endpoint.id}/sample/${provider}`,
    query: [],
    headers,
    body: bytes,
    truncated: false,
    contentType: "application/json",
    sourceIp: "sample",
  });
  return { eventId: event.id, signed };
}
