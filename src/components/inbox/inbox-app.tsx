"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bell, Radio, Settings } from "lucide-react";
import { Mark } from "@/components/brand";
import { CopyButton } from "@/components/copy-button";
import { EventDetail } from "@/components/inbox/event-detail";
import { AlertsDialog } from "@/components/inbox/alerts-dialog";
import { SettingsDialog } from "@/components/inbox/settings-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api } from "@/lib/client/api";
import { saveEndpoint, tokenFor } from "@/lib/client/storage";
import { toCurl } from "@/lib/curl";
import { parseHeaderLines } from "@/lib/headers";
import { formatAbsolute, formatRelative } from "@/lib/format";
import type { LiveMessage } from "@/lib/live";
import type { EndpointView, EventDetail as EventDetailType, EventSummary } from "@/lib/types";

const METHODS = ["ALL", "POST", "GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
const RANGES = [
  { id: "15m", label: "15m", ms: 15 * 60 * 1000 },
  { id: "1h", label: "1 hour", ms: 60 * 60 * 1000 },
  { id: "24h", label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { id: "7d", label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { id: "all", label: "All retained", ms: null },
] as const;

export function InboxApp({ endpointId }: { endpointId: string }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [session, setSession] = useState(false);
  const [unlock, setUnlock] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [endpoint, setEndpoint] = useState<EndpointView | null>(null);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EventDetailType | null>(null);
  const [detailError, setDetailError] = useState("");
  const [listError, setListError] = useState("");
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [follow, setFollow] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [reveal, setReveal] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [requestMethod, setRequestMethod] = useState("POST");
  const [requestPath, setRequestPath] = useState("");
  const [requestHeaders, setRequestHeaders] = useState("content-type: application/json");
  const [requestBody, setRequestBody] = useState('{\n  "hello": "hooktrace"\n}');
  const [requestError, setRequestError] = useState("");
  const [sendingRequest, setSendingRequest] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [method, setMethod] = useState("ALL");
  const [verification, setVerification] = useState("all");
  const [status, setStatus] = useState("");
  const [range, setRange] = useState("24h");
  const [now, setNow] = useState(() => Date.now());
  const followRef = useRef(true);
  const selectedRef = useRef<string | null>(null);

  useEffect(() => {
    followRef.current = follow;
  }, [follow]);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const fromHash = hash.get("t");
    const stored = fromHash || tokenFor(endpointId);
    if (fromHash) {
      saveEndpoint({
        id: endpointId,
        token: fromHash,
        name: "Endpoint",
        createdAt: new Date().toISOString(),
      });
      window.history.replaceState(null, "", window.location.pathname);
    }
    if (stored) {
      setToken(stored);
      setSession(false);
      setReady(true);
      return;
    }
    let cancelled = false;
    void fetch(`/api/endpoints/${endpointId}`, { cache: "no-store" }).then((response) => {
      if (cancelled) return;
      setSession(response.ok);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [endpointId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loadList = useCallback(
    async (activeToken: string | null, cursor?: string) => {
      try {
      const params = new URLSearchParams();
      if (method !== "ALL") params.set("method", method);
      if (verification !== "all") params.set("verification", verification);
      if (status.trim()) params.set("status", status.trim());
      if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
      const selectedRange = RANGES.find((item) => item.id === range);
      if (selectedRange?.ms) params.set("from", new Date(Date.now() - selectedRange.ms).toISOString());
      if (cursor) params.set("cursor", cursor);
      const page = await api<{ events: EventSummary[]; nextCursor: string | null }>(
        `/api/endpoints/${endpointId}/events?${params.toString()}`,
        activeToken,
      );
      setListError("");
      setNextCursor(page.nextCursor);
      setEvents((current) => (cursor ? [...current, ...page.events] : page.events));
      if (!cursor) {
        setSelectedId((current) => {
          if (followRef.current) return page.events[0]?.id ?? null;
          return current;
        });
      }
      return page;
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Could not load requests.");
      return null;
    }
  },
    [debouncedQuery, endpointId, method, range, status, verification],
  );

  useEffect(() => {
    if (!token && !session) return;
    let cancelled = false;
    setLoading(true);
    setListError("");
    void (async () => {
      try {
        const view = await api<EndpointView>(`/api/endpoints/${endpointId}`, token);
        if (cancelled) return;
        setEndpoint(view);
        if (token) saveEndpoint({ id: view.id, token, name: view.name, createdAt: view.createdAt });
        await loadList(token);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 404) {
          setToken(null);
          setUnlockError("That token does not open this endpoint.");
        } else {
          setListError(error instanceof Error ? error.message : "Could not load this inbox.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpointId, loadList, token, session]);

  useEffect(() => {
    if (!token && !session) return;
    let stopped = false;
    const refresh = async () => {
      try {
        const result = await api<{ unreadCount: number }>(`/api/endpoints/${endpointId}/alerts`, token);
        if (!stopped) setAlertCount(result.unreadCount);
      } catch {
        // Alerts should not interrupt the request inbox if this refresh fails.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [endpointId, token, session]);

  useEffect(() => {
    if ((!token && !session) || !selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailError("");
    void api<EventDetailType>(`/api/endpoints/${endpointId}/events/${selectedId}`, token)
      .then((event) => {
        if (!cancelled) setDetail(event);
      })
      .catch((error: unknown) => {
        if (!cancelled) setDetailError(error instanceof Error ? error.message : "Could not load this request.");
      });
    return () => {
      cancelled = true;
    };
  }, [endpointId, selectedId, token, session]);

  useEffect(() => {
    if (!token && !session) return;
    let stopped = false;
    let retryMs = 1000;
    let controller: AbortController | null = null;

    const connect = async () => {
      while (!stopped) {
        controller = new AbortController();
        try {
          const response = await fetch(`/api/endpoints/${endpointId}/stream`, {
            headers: token ? { authorization: `Bearer ${token}` } : {},
            signal: controller.signal,
          });
          if (!response.ok || !response.body) throw new Error("stream");
          setLive(true);
          retryMs = 1000;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const chunks = buffer.split("\n\n");
            buffer = chunks.pop() ?? "";
            for (const chunk of chunks) handleChunk(chunk);
          }
        } catch {
          if (stopped) break;
          setLive(false);
        }
        if (stopped) break;
        await new Promise((resolve) => window.setTimeout(resolve, retryMs));
        retryMs = Math.min(retryMs * 2, 10_000);
      }
    };

    const handleChunk = (chunk: string) => {
      const data = chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) return;
      let message: LiveMessage;
      try {
        message = JSON.parse(data) as LiveMessage;
      } catch {
        return;
      }
      if (message.type === "refresh") {
        void loadList(token);
        if (selectedRef.current) {
          void api<EventDetailType>(`/api/endpoints/${endpointId}/events/${selectedRef.current}`, token)
            .then(setDetail)
            .catch(() => undefined);
        }
        return;
      }
      if (message.type !== "event") return;
      void loadList(token).then(() => {
        if (followRef.current) setSelectedId(message.event.id);
        else setUnseen((count) => count + 1);
      });
    };

    void connect();
    return () => {
      stopped = true;
      controller?.abort();
      setLive(false);
    };
  }, [endpointId, loadList, token, session]);

  useEffect(() => {
    if (!token && !session) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void loadList(token);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loadList, token, session]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key !== "j" && event.key !== "k") return;
      const index = events.findIndex((item) => item.id === selectedId);
      const next = event.key === "j" ? Math.min(events.length - 1, index + 1) : Math.max(0, index - 1);
      const chosen = events[next];
      if (!chosen) return;
      setFollow(false);
      setSelectedId(chosen.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [events, selectedId]);

  async function sendSample(provider: "plain" | "stripe" | "github" | "razorpay" | "shopify" | "slack" | "svix") {
    if (!token && !session) return;
    setFollow(true);
    const result = await api<{ eventId: string }>(`/api/endpoints/${endpointId}/sample`, token, {
      method: "POST",
      body: JSON.stringify({ provider }),
    });
    setSelectedId(result.eventId);
  }

  async function sendCustomRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!endpoint || (!token && !session)) return;
    setSendingRequest(true);
    setRequestError("");
    try {
      const suffix = requestPath.trim().replace(/^\/+|\/+$/g, "");
      const path = suffix
        ? `/${suffix.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`
        : "";
      const headers = new Headers();
      for (const header of parseHeaderLines(requestHeaders)) headers.append(header.name, header.value);
      const method = requestMethod.toUpperCase();
      const response = await fetch(`${endpoint.hookPath}${path}`, {
        method,
        headers,
        ...(method === "GET" || method === "HEAD" ? {} : { body: requestBody }),
        cache: "no-store",
      });
      const eventId = response.headers.get("x-hooktrace-event");
      if (!eventId) {
        const message = await response.text();
        throw new Error(message || `Request returned HTTP ${response.status} without a captured event.`);
      }
      setComposerOpen(false);
      setFollow(true);
      setSelectedId(eventId);
      void loadList(token);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Could not send the request.");
    } finally {
      setSendingRequest(false);
    }
  }

  if (!ready) return <Shell />;
  if (!token && !session) {
    return (
      <Locked
        endpointId={endpointId}
        value={unlock}
        error={unlockError}
        onChange={setUnlock}
        onSubmit={() => {
          const next = unlock.trim();
          if (next.length < 20) {
            setUnlockError("Paste the owner token for this endpoint.");
            return;
          }
          saveEndpoint({ id: endpointId, token: next, name: "Endpoint", createdAt: new Date().toISOString() });
          setUnlockError("");
          setToken(next);
        }}
      />
    );
  }

  const hookUrl = endpoint ? `${window.location.origin}${endpoint.hookPath}` : "";
  const sampleCurl = hookUrl
    ? toCurl({
        method: "POST",
        url: hookUrl,
        headers: [{ name: "content-type", value: "application/json" }],
        body: '{"hello":"hooktrace"}',
        redact: false,
      })
    : "";

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5 sm:gap-3 sm:px-4">
        <Link href="/" className="flex items-center gap-2">
          <Mark className="size-7" />
          <span className="hidden font-display text-lg sm:inline">HookTrace</span>
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{endpoint?.name || "Inbox"}</p>
          {hookUrl && <p className="truncate font-mono text-[11px] text-muted-foreground">{hookUrl}</p>}
        </div>
        <span className={`hidden items-center gap-1.5 font-mono text-xs sm:flex ${live ? "text-good" : "text-warn"}`}>
          <Radio className="size-3.5" />
          {live ? "Live" : "Reconnecting"}
        </span>
        <label className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
          <Switch checked={reveal} onCheckedChange={setReveal} />
          Reveal secrets
        </label>
        {hookUrl && <CopyButton value={hookUrl} label="Copy URL" />}
        <Button type="button" variant="outline" size="icon" className="relative" onClick={() => setAlertsOpen(true)} aria-label={alertCount ? `Alerts, ${alertCount} unread` : "Alerts"}>
          <Bell />
          {alertCount > 0 && <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 text-destructive-foreground">{alertCount > 99 ? "99+" : alertCount}</span>}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setComposerOpen(true)}>
          Send request
        </Button>
        <Button type="button" variant="outline" size="icon" onClick={() => setSettingsOpen(true)} aria-label="Settings">
          <Settings />
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 md:grid-cols-[340px_minmax(0,1fr)]">
        <aside className={`${selectedId ? "hidden md:flex" : "flex"} min-h-0 min-w-0 flex-col border-r`}>
          <div className="grid min-w-0 gap-2 border-b p-3">
            <Input
              value={query}
              maxLength={200}
              placeholder="Search body and headers"
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="grid min-w-0 grid-cols-2 gap-2">
              <FilterSelect value={method} onChange={setMethod} options={METHODS.map((item) => ({ value: item, label: item === "ALL" ? "Any method" : item }))} />
              <FilterSelect
                value={verification}
                onChange={setVerification}
                options={[
                  { value: "all", label: "Any signature" },
                  { value: "valid", label: "Valid" },
                  { value: "invalid", label: "Invalid" },
                  { value: "none", label: "Not checked" },
                ]}
              />
            </div>
            <div className="grid min-w-0 grid-cols-2 gap-2">
              <Input value={status} placeholder="Status" inputMode="numeric" onChange={(e) => setStatus(e.target.value)} />
              <FilterSelect value={range} onChange={setRange} options={RANGES.map((item) => ({ value: item.id, label: item.label }))} />
            </div>
            <label className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <Switch checked={follow} onCheckedChange={setFollow} />
                Follow live
              </span>
              <span>j / k</span>
            </label>
            {unseen > 0 && !follow && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  setFollow(true);
                  setUnseen(0);
                  const first = events[0];
                  if (first) setSelectedId(first.id);
                }}
              >
                {unseen} new
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {loading && events.length === 0 && <p className="p-4 text-sm text-muted-foreground">Loading captured requests…</p>}
            {listError && <p className="p-4 text-sm text-destructive">{listError}</p>}
            {!loading && events.length === 0 && (
              <div className="space-y-3 p-4 text-sm">
                <p className="font-medium">Waiting for the first request.</p>
                <p className="text-muted-foreground">
                  Send the curl below, or forward new requests to your machine with the CLI. The owner token is in
                  settings.
                </p>
                <pre className="overflow-auto rounded-lg bg-background p-3 font-mono text-[11px] leading-relaxed">{`hooktrace listen ${endpointId} --token <owner-token> --forward http://localhost:3000/webhooks`}</pre>
                <pre className="overflow-auto rounded-lg bg-background p-3 font-mono text-[11px] leading-relaxed">{sampleCurl}</pre>
                {sampleCurl && <CopyButton value={sampleCurl} label="Copy cURL" />}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => void sendSample("stripe")}>
                    Stripe sample
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void sendSample("github")}>
                    GitHub sample
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void sendSample("razorpay")}>
                    Razorpay sample
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void sendSample("shopify")}>
                    Shopify sample
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void sendSample("slack")}>
                    Slack sample
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void sendSample("svix")}>
                    Svix sample
                  </Button>
                </div>
              </div>
            )}
            <ul>
              {events.map((event) => {
                const active = event.id === selectedId;
                return (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setFollow(false);
                        setSelectedId(event.id);
                      }}
                      className={`w-full border-b px-3 py-3 text-left ${active ? "bg-muted" : "hover:bg-muted/60"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`font-mono text-xs ${methodClass(event.method)}`}>{event.method}</span>
                        <span className="text-[11px] text-muted-foreground" title={formatAbsolute(event.createdAt)}>
                          {formatRelative(event.createdAt, now)}
                        </span>
                      </div>
                      <p className="truncate text-sm">{event.path}</p>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">{event.bodyPreview || "Empty body"}</span>
                        <SignatureDot status={event.verification?.status ?? null} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            {nextCursor && (
              <div className="p-3">
                <Button type="button" variant="outline" size="sm" onClick={() => token && void loadList(token, nextCursor)}>
                  Load earlier
                </Button>
              </div>
            )}
          </div>
        </aside>

        <section className={`${selectedId ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-col`}>
          {selectedId && (
            <div className="flex items-center border-b px-2 py-1 md:hidden">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFollow(false);
                  setSelectedId(null);
                }}
              >
                <ArrowLeft />
                Requests
              </Button>
            </div>
          )}
          {!selectedId && (
            <div className="m-auto max-w-md p-8 text-center">
              <p className="font-display text-2xl">Nothing selected</p>
              <p className="mt-2 text-sm text-muted-foreground">New requests show up here while this page is open.</p>
            </div>
          )}
          {detailError && <p className="p-6 text-sm text-destructive">{detailError}</p>}
          {detail && token && (
            <EventDetail
              endpointId={endpointId}
              token={token}
              event={detail}
              reveal={reveal}
              now={now}
              onReplayed={setDetail}
            />
          )}
        </section>
      </div>

      <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground md:hidden">
        <label className="flex items-center gap-2">
          <Switch checked={reveal} onCheckedChange={setReveal} />
          Reveal secrets
        </label>
        <span className={live ? "text-good" : "text-warn"}>{live ? "Live" : "Reconnecting"}</span>
      </div>

      {endpoint && (token || session) && (
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          endpointId={endpointId}
          token={token}
          endpoint={endpoint}
          onSaved={(saved) => {
            setEndpoint(saved);
            if (token) saveEndpoint({ id: saved.id, token, name: saved.name, createdAt: saved.createdAt });
            void loadList(token);
          }}
        />
      )}

      {endpoint && (token || session) && (
        <AlertsDialog
          open={alertsOpen}
          onOpenChange={setAlertsOpen}
          endpointId={endpointId}
          token={token}
          onUnreadCount={setAlertCount}
          onSelectEvent={(eventId) => {
            setFollow(false);
            setSelectedId(eventId);
          }}
        />
      )}

      <Dialog open={composerOpen} onOpenChange={setComposerOpen}>
        <DialogContent className="max-h-[85dvh] overflow-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Send a custom request</DialogTitle>
            <DialogDescription>
              Send a request into this endpoint and capture it in the inbox. POST is selected by default.
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={(event) => void sendCustomRequest(event)}>
            <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
              <Field label="Method">
                <Select value={requestMethod} onValueChange={(value) => setRequestMethod(value ?? "POST")}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["POST", "GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"].map((value) => (
                      <SelectItem key={value} value={value}>{value}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Path suffix (optional)">
                <Input value={requestPath} placeholder="orders/created" onChange={(e) => setRequestPath(e.target.value)} />
              </Field>
            </div>
            <Field label="Headers (one per line)">
              <Textarea value={requestHeaders} onChange={(e) => setRequestHeaders(e.target.value)} className="min-h-20 font-mono text-xs" />
            </Field>
            <Field label="Body">
              <Textarea
                value={requestBody}
                onChange={(e) => setRequestBody(e.target.value)}
                disabled={requestMethod === "GET" || requestMethod === "HEAD"}
                className="min-h-36 font-mono text-xs"
              />
            </Field>
            {requestError && <p className="text-sm text-destructive">{requestError}</p>}
            <div className="flex justify-end">
              <Button type="submit" disabled={sendingRequest}>
                {sendingRequest ? "Sending…" : `Send ${requestMethod}`}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next ?? value)}
      items={Object.fromEntries(options.map((option) => [option.value, option.label]))}
    >
      <SelectTrigger className="w-full max-w-full min-w-0 overflow-hidden">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function SignatureDot({ status }: { status: "valid" | "invalid" | null }) {
  if (status === "valid") return <span className="text-good">Valid</span>;
  if (status === "invalid") return <span className="text-destructive">Invalid</span>;
  return <span>Unchecked</span>;
}

function methodClass(method: string): string {
  if (method === "GET") return "text-sky-300";
  if (method === "POST") return "text-lime";
  if (method === "DELETE") return "text-destructive";
  if (method === "PUT" || method === "PATCH") return "text-warn";
  return "text-muted-foreground";
}

function Shell() {
  return <div className="grid h-dvh place-items-center text-sm text-muted-foreground">Opening inbox…</div>;
}

function Locked({
  endpointId,
  value,
  error,
  onChange,
  onSubmit,
}: {
  endpointId: string;
  value: string;
  error: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="grid min-h-dvh place-items-center px-5">
      <form
        className="w-full max-w-md rounded-2xl border bg-card p-5"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Mark className="size-8" />
        <h1 className="mt-4 font-display text-3xl">This inbox is locked</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Paste the owner token for <span className="font-mono">{endpointId}</span>. It was shown once, in the browser
          that created the endpoint.
        </p>
        <Input className="mt-4" type="password" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Owner token" />
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <Button className="mt-4" type="submit">
          Unlock
        </Button>
        <p className="mt-4 text-sm">
          <Link href="/" className="text-muted-foreground underline-offset-4 hover:underline">
            Back home
          </Link>
        </p>
      </form>
    </div>
  );
}
