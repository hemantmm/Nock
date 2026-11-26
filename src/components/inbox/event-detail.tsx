"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Minus, X } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client/api";
import { toCurl } from "@/lib/curl";
import { formatBytes, formatAbsolute, formatRelative } from "@/lib/format";
import { formatHeaderLines, parseHeaderLines } from "@/lib/headers";
import { highlightJson, prettyBody } from "@/lib/json-view";
import { redactHeaders } from "@/lib/redact";
import type { EventDetail, HeaderPair, ReplayView, VerificationCheck } from "@/lib/types";

export function EventDetail({
  endpointId,
  token,
  event,
  reveal,
  now,
  onReplayed,
}: {
  endpointId: string;
  token: string | null;
  event: EventDetail;
  reveal: boolean;
  now: number;
  onReplayed: (event: EventDetail) => void;
}) {
  const shownHeaders = redactHeaders(event.headers, reveal);
  const requestUrl = useMemo(() => buildUrl(event), [event]);
  const curl = toCurl({
    method: event.method,
    url: requestUrl,
    headers: event.headers,
    body: event.bodyText,
    bodyBase64: event.bodyBase64,
    binary: event.bodyText === null,
    redact: !reveal,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-sm">
              <span className={methodClass(event.method)}>{event.method}</span>{" "}
              <span className="break-all">{event.path}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground" title={formatAbsolute(event.createdAt)}>
              {formatRelative(event.createdAt, now)} · responded {event.responseStatus} · {formatBytes(event.bodySize)}
              {event.bodyTruncated ? " · truncated at the size limit" : ""} · {event.sourceIp || "source IP not disclosed"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={curl} label="Copy cURL" />
            <Button type="button" variant="outline" size="sm" onClick={() => void downloadBody(endpointId, token, event.id)}>
              Download body
            </Button>
          </div>
        </div>
        <SignatureCard verification={event.verification} />
        <ForwardNote event={event} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6">
        <Tabs defaultValue="pretty">
          <TabsList>
            <TabsTrigger value="pretty">Pretty</TabsTrigger>
            <TabsTrigger value="raw">Raw</TabsTrigger>
            <TabsTrigger value="headers">Headers</TabsTrigger>
            <TabsTrigger value="query">Query</TabsTrigger>
          </TabsList>
          <TabsContent value="pretty" className="mt-3">
            <PrettyBody text={event.bodyText} binary={event.bodyText === null} base64={event.bodyBase64} />
          </TabsContent>
          <TabsContent value="raw" className="mt-3">
            {event.bodyText === null ? (
              <pre className="overflow-auto rounded-lg bg-background p-3 font-mono text-xs leading-relaxed">{hexDump(event.bodyBase64)}</pre>
            ) : (
              <pre className="overflow-auto rounded-lg bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
                {event.bodyText || "Empty body"}
              </pre>
            )}
          </TabsContent>
          <TabsContent value="headers" className="mt-3">
            <PairTable rows={shownHeaders} empty="No headers." />
          </TabsContent>
          <TabsContent value="query" className="mt-3">
            <PairTable rows={event.query} empty="No query parameters." />
          </TabsContent>
        </Tabs>

        <section className="mt-6 rounded-xl border">
          <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
            <h3 className="text-sm font-medium">cURL</h3>
            <p className="text-xs text-muted-foreground">{reveal ? "Secrets included" : "Sensitive headers masked"}</p>
          </div>
          <pre className="overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">{curl}</pre>
        </section>

        <ReplayPanel endpointId={endpointId} token={token} event={event} reveal={reveal} onReplayed={onReplayed} />
      </div>
    </div>
  );
}

function ForwardNote({ event }: { event: EventDetail }) {
  const latest = event.replays.find((replay) => replay.source === "forward");
  if (!latest) return null;
  return (
    <p className="mt-3 rounded-lg border border-good/40 bg-good/10 px-3 py-2 font-mono text-xs text-good">
      {forwardLine(latest)}
    </p>
  );
}

function forwardLine(replay: ReplayView): string {
  let where = replay.targetUrl;
  try {
    const url = new URL(replay.targetUrl);
    where = `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    // Keep the raw target when it is not a URL.
  }
  if (replay.error) return `Forwarded to ${where}: ${replay.error}`;
  return `Forwarded to ${where}: ${replay.responseStatus} in ${replay.latencyMs ?? "?"}ms`;
}

function SignatureCard({ verification }: { verification: EventDetail["verification"] }) {
  if (!verification) {
    return (
      <div className="mt-4 rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground">
        No signing secret is saved for this endpoint. Add one in settings to check the selected provider&apos;s signature.
      </div>
    );
  }
  const valid = verification.status === "valid";
  return (
    <div className={`mt-4 rounded-xl border px-3 py-3 ${valid ? "border-good/40 bg-good/5" : "border-destructive/40 bg-destructive/5"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${valid ? "bg-good/15 text-good" : "bg-destructive/15 text-destructive"}`}>
          {valid ? "Valid" : "Invalid"}
        </span>
        <span className="font-mono text-xs text-muted-foreground">{providerLabel(verification.provider)}</span>
        <span className="text-sm">{verification.summary}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{verification.detail}</p>
      <ul className="mt-3 space-y-2">
        {verification.checks.map((check) => (
          <li key={check.id} className="flex gap-2 text-sm">
            <CheckIcon state={check.state} />
            <span>
              <span className="font-medium">{check.label}.</span>{" "}
              <span className="text-muted-foreground">{check.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CheckIcon({ state }: { state: VerificationCheck["state"] }) {
  if (state === "pass") return <Check className="mt-0.5 size-4 shrink-0 text-good" />;
  if (state === "fail") return <X className="mt-0.5 size-4 shrink-0 text-destructive" />;
  return <Minus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}

function PrettyBody({ text, binary, base64 }: { text: string | null; binary: boolean; base64: string }) {
  if (binary || text === null) {
    return (
      <div>
        <p className="mb-2 text-sm text-muted-foreground">This body is not valid UTF-8, so it is not JSON.</p>
        <pre className="overflow-auto rounded-lg bg-background p-3 font-mono text-xs">{hexDump(base64)}</pre>
      </div>
    );
  }
  if (!text) return <p className="text-sm text-muted-foreground">Empty body.</p>;
  const pretty = prettyBody(text);
  if (!pretty.json) {
    return <pre className="overflow-auto rounded-lg bg-background p-3 font-mono text-xs whitespace-pre-wrap break-all">{pretty.text}</pre>;
  }
  return (
    <pre
      className="overflow-auto rounded-lg bg-background p-3 font-mono text-xs leading-relaxed"
      dangerouslySetInnerHTML={{ __html: highlightJson(pretty.text) }}
    />
  );
}

function PairTable({ rows, empty }: { rows: HeaderPair[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-left text-sm">
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.name}-${index}`} className="border-t first:border-t-0">
              <th className="w-1/3 px-3 py-2 align-top font-mono text-xs font-medium text-muted-foreground">{row.name}</th>
              <td className="px-3 py-2 font-mono text-xs break-all">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReplayPanel({
  endpointId,
  token,
  event,
  reveal,
  onReplayed,
}: {
  endpointId: string;
  token: string | null;
  event: EventDetail;
  reveal: boolean;
  onReplayed: (event: EventDetail) => void;
}) {
  const [targetUrl, setTargetUrl] = useState("https://example.com/webhooks");
  const [replayMethod, setReplayMethod] = useState(event.method);
  const [editing, setEditing] = useState(false);
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const [headersText, setHeadersText] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const latest = event.replays[0];

  useEffect(() => setReplayMethod(event.method), [event.id, event.method]);

  function startEditing(on: boolean) {
    setEditing(on);
    if (on) {
      setHeadersText(formatHeaderLines(redactHeaders(event.headers, reveal)));
      setBody(event.bodyText ?? "");
    }
  }

  async function send() {
    setPending(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        targetUrl,
        method: replayMethod,
        includeSensitive,
      };
      if (editing) {
        payload.headers = parseHeaderLines(headersText);
        payload.body = body;
      }
      await api(`/api/endpoints/${endpointId}/events/${event.id}/replay`, token, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const fresh = await api<EventDetail>(`/api/endpoints/${endpointId}/events/${event.id}`, token);
      onReplayed(fresh);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Replay failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border">
      <div className="border-b px-3 py-3">
        <h3 className="text-sm font-medium">Replay</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          HookTrace sends this request from the server. Private, loopback, and link-local addresses are blocked.
          Redirects are not followed.
        </p>
      </div>
      <div className="grid gap-3 p-3">
        <Label htmlFor="replay-url">Target URL</Label>
        <Input id="replay-url" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} spellCheck={false} />
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={includeSensitive} onCheckedChange={setIncludeSensitive} />
            Forward sensitive headers
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={editing} onCheckedChange={startEditing} />
            Edit before sending
          </label>
        </div>
        {editing && (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Request method</Label>
              <select
                value={replayMethod}
                onChange={(e) => setReplayMethod(e.target.value)}
                className="h-9 rounded-md border bg-background px-3 text-sm"
              >
                {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((method) => (
                  <option key={method} value={method}>{method}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              {reveal
                ? "The editor has the captured headers."
                : "Headers are shown masked. Turn on Reveal secrets before editing if the target needs the real values."}
            </p>
            <Textarea value={headersText} onChange={(e) => setHeadersText(e.target.value)} className="min-h-28 font-mono text-xs" />
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-28 font-mono text-xs"
              disabled={replayMethod === "GET" || replayMethod === "HEAD"}
              placeholder={event.bodyText === null ? "Binary bodies can be replayed unchanged when edit is off." : ""}
            />
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div>
          <Button type="button" onClick={() => void send()} disabled={pending || !targetUrl.trim()}>
            {pending ? "Sending…" : "Send replay"}
          </Button>
        </div>
        {latest && <ReplayResult replay={latest} />}
        {event.replays.length > 1 && (
          <div className="space-y-2">
            {event.replays.slice(1, 4).map((replay) => (
              <ReplayResult key={replay.id} replay={replay} compact />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ReplayResult({ replay, compact = false }: { replay: ReplayView; compact?: boolean }) {
  return (
    <div className="rounded-lg bg-background p-3">
      <p className="font-mono text-xs">
        {replay.source === "forward" ? forwardLine(replay) : `${replay.method} ${replay.targetUrl}`}
      </p>
      {replay.source !== "forward" && (
        <p className="mt-1 text-xs text-muted-foreground">
          {replay.error
            ? replay.error
            : `${replay.responseStatus} · ${replay.latencyMs ?? "?"} ms${replay.responseTruncated ? " · response truncated" : ""}`}
        </p>
      )}
      {!compact && !replay.error && replay.responseBodyText !== null && (
        <pre className="mt-2 max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap break-all">
          {replay.responseBodyText || "Empty response body"}
        </pre>
      )}
      {!compact && !replay.error && replay.responseHeaders.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Response headers</summary>
          <pre className="mt-2 font-mono text-xs whitespace-pre-wrap break-all">
            {replay.responseHeaders.map((header) => `${header.name}: ${header.value}`).join("\n")}
          </pre>
        </details>
      )}
    </div>
  );
}

function providerLabel(provider: string): string {
  if (provider === "hmac_sha256") return "HMAC-SHA256";
  if (provider === "github") return "GitHub";
  if (provider === "razorpay") return "Razorpay";
  if (provider === "shopify") return "Shopify";
  if (provider === "slack") return "Slack";
  if (provider === "svix") return "Svix / Standard Webhooks";
  return "Stripe";
}

function methodClass(method: string): string {
  if (method === "GET") return "text-sky-300";
  if (method === "POST") return "text-lime";
  if (method === "PUT" || method === "PATCH") return "text-warn";
  if (method === "DELETE") return "text-destructive";
  return "text-muted-foreground";
}

function buildUrl(event: EventDetail): string {
  const url = new URL(event.path, window.location.origin);
  url.search = "";
  for (const pair of event.query) url.searchParams.append(pair.name, pair.value);
  return url.toString();
}

function hexDump(base64: string): string {
  const binary = atob(base64);
  const lines: string[] = [];
  const max = Math.min(binary.length, 256);
  for (let offset = 0; offset < max; offset += 16) {
    const slice = binary.slice(offset, offset + 16);
    const hex = [...slice].map((char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
    const ascii = [...slice]
      .map((char) => {
        const code = char.charCodeAt(0);
        return code >= 32 && code < 127 ? char : ".";
      })
      .join("");
    lines.push(`${offset.toString(16).padStart(4, "0")}  ${hex.padEnd(47, " ")}  ${ascii}`);
  }
  if (binary.length > max) lines.push(`… ${binary.length - max} more bytes`);
  return lines.join("\n");
}

async function downloadBody(endpointId: string, token: string | null, eventId: string) {
  const headers = new Headers();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const csrf = document.cookie.split("; ").find((part) => part.startsWith("hooktrace_csrf="));
  if (csrf) headers.set("x-csrf-token", decodeURIComponent(csrf.slice("hooktrace_csrf=".length)));
  const response = await fetch(`/api/endpoints/${endpointId}/events/${eventId}/body`, { headers });
  if (!response.ok) return;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${eventId}.bin`;
  anchor.click();
  URL.revokeObjectURL(url);
}
