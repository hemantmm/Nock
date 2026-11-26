"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AccountHeader } from "@/components/account-header";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/client/api";
import { loadEndpoints } from "@/lib/client/storage";
import type { EndpointView } from "@/lib/types";

type Me = { user: { id: string; email: string; name: string | null } | null };

export function DashboardPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState<string | null>(null);
  const [endpoints, setEndpoints] = useState<EndpointView[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [claimNote, setClaimNote] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await api<Me>("/api/auth/me", null);
        if (cancelled) return;
        if (!me.user) {
          router.replace("/signin");
          return;
        }
        setEmail(me.user.email);
        const page = await api<{ endpoints: EndpointView[] }>("/api/endpoints", null);
        if (cancelled) return;
        setEndpoints(page.endpoints);
        setReady(true);
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 401) router.replace("/signin");
        else setError(caught instanceof Error ? caught.message : "Could not load endpoints.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!ready || params.get("claim") !== "1") return;
    const local = loadEndpoints();
    if (local.length === 0) return;
    void (async () => {
      let claimed = 0;
      for (const item of local) {
        try {
          await api("/api/auth/claim", null, {
            method: "POST",
            body: JSON.stringify({ endpointId: item.id, ownerToken: item.token }),
          });
          claimed += 1;
        } catch {
          // Already claimed, or the token does not match.
        }
      }
      if (claimed > 0) {
        setClaimNote(`Added ${claimed} temporary endpoint${claimed === 1 ? "" : "s"} to this account.`);
        const page = await api<{ endpoints: EndpointView[] }>("/api/endpoints", null);
        setEndpoints(page.endpoints);
      }
    })();
  }, [params, ready]);

  async function createEndpoint() {
    setError("");
    try {
      const created = await api<EndpointView & { token: string }>("/api/endpoints", null, {
        method: "POST",
        body: JSON.stringify({ name: name.trim() || undefined }),
      });
      setName("");
      setEndpoints((current) => [created, ...current]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create an endpoint.");
    }
  }

  async function rename(endpoint: EndpointView, next: string) {
    const saved = await api<EndpointView>(`/api/endpoints/${endpoint.id}`, null, {
      method: "PATCH",
      body: JSON.stringify({ name: next }),
    });
    setEndpoints((current) => current.map((item) => (item.id === endpoint.id ? saved : item)));
  }

  async function remove(endpoint: EndpointView) {
    if (!window.confirm(`Delete ${endpoint.name}? Captured requests go with it.`)) return;
    await api(`/api/endpoints/${endpoint.id}`, null, { method: "DELETE" });
    setEndpoints((current) => current.filter((item) => item.id !== endpoint.id));
  }

  return (
    <div className="min-h-dvh">
      <div className="h-1 bg-lime" />
      <AccountHeader email={email} />
      <main className="mx-auto max-w-5xl px-5 pb-16">
        <h1 className="font-display text-4xl">Endpoints</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          These inboxes belong to your account. A visitor can still mint a temporary URL without signing in, then claim it here.
        </p>
        {claimNote && <p className="mt-4 text-sm text-good">{claimNote}</p>}
        <form
          className="mt-6 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void createEndpoint();
          }}
        >
          <Label className="sr-only" htmlFor="new-endpoint">
            Name
          </Label>
          <Input id="new-endpoint" value={name} onChange={(e) => setName(e.target.value)} placeholder="Stripe staging" className="max-w-xs" />
          <Button type="submit">Create endpoint</Button>
        </form>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <ul className="mt-6 divide-y overflow-hidden rounded-2xl border">
          {ready && endpoints.length === 0 && (
            <li className="bg-card px-4 py-6 text-sm text-muted-foreground">No endpoints yet.</li>
          )}
          {endpoints.map((endpoint) => (
            <EndpointRow key={endpoint.id} endpoint={endpoint} onRename={rename} onDelete={remove} />
          ))}
        </ul>
      </main>
    </div>
  );
}

function EndpointRow({
  endpoint,
  onRename,
  onDelete,
}: {
  endpoint: EndpointView;
  onRename: (endpoint: EndpointView, name: string) => Promise<void>;
  onDelete: (endpoint: EndpointView) => Promise<void>;
}) {
  const [name, setName] = useState(endpoint.name);
  const url = typeof window === "undefined" ? endpoint.hookPath : `${window.location.origin}${endpoint.hookPath}`;
  return (
    <li className="grid gap-3 bg-card px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void onRename(endpoint, name);
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
          <Button type="submit" variant="outline" size="sm">
            Rename
          </Button>
        </form>
        <p className="mt-2 truncate font-mono text-xs text-muted-foreground">{url}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={url} label="Copy URL" />
        <Link
          href={`/inbox/${endpoint.id}`}
          className="inline-flex h-7 items-center rounded-lg border px-2.5 text-sm hover:bg-muted"
        >
          Open
        </Link>
        <Button variant="destructive" size="sm" onClick={() => void onDelete(endpoint)}>
          Delete
        </Button>
      </div>
    </li>
  );
}
