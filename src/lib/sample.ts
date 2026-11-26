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

export async function sendSample(endpoint: Endpoint, provider: "plain" | "stripe" | "github" | "razorpay" | "shopify" | "slack" | "svix") {
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
  } else if (provider === "shopify") {
    body = JSON.stringify({ id: 820982911946154500, email: "hooktrace@example.com", topic: "orders/create" });
    if (secret) {
      headers.push({ name: "x-shopify-hmac-sha256", value: createHmac("sha256", secret).update(body).digest("base64") });
      headers.push({ name: "x-shopify-topic", value: "orders/create" });
      signed = true;
    }
  } else if (provider === "slack") {
    body = JSON.stringify({ type: "event_callback", event: { type: "message", text: "Hello from HookTrace" } });
    if (secret) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const digest = createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");
      headers.push({ name: "x-slack-request-timestamp", value: timestamp });
      headers.push({ name: "x-slack-signature", value: `v0=${digest}` });
      signed = true;
    }
  } else if (provider === "svix") {
    body = JSON.stringify({ type: "webhook.sample", data: { message: "Hello from HookTrace" } });
    const keyText = secret?.startsWith("whsec_") ? secret.slice(6) : "";
    const key = Buffer.from(keyText, "base64");
    if (secret?.startsWith("whsec_") && key.length > 0) {
      const id = "msg_hooktrace_sample";
      const timestamp = String(Math.floor(Date.now() / 1000));
      const digest = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
      headers.push({ name: "svix-id", value: id });
      headers.push({ name: "svix-timestamp", value: timestamp });
      headers.push({ name: "svix-signature", value: `v1,${digest}` });
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
