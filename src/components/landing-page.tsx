"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Lock, Radio, ShieldCheck } from "lucide-react";
import { Mark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadEndpoints, saveEndpoint, type SavedEndpoint } from "@/lib/client/storage";
import { readBrowserCsrf } from "@/lib/client/api";

export function LandingPage() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<SavedEndpoint[]>([]);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSaved(loadEndpoints());
    void fetch("/api/auth/me")
      .then((response) => response.json())
      .then((body: { user?: { email?: string } | null }) => setSignedIn(Boolean(body.user)))
      .catch(() => setSignedIn(false));
  }, []);

  async function createEndpoint() {
    setPending(true);
    setError("");
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const csrf = readBrowserCsrf();
      if (csrf) headers["x-csrf-token"] = csrf;
      const response = await fetch("/api/endpoints", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: name.trim() || undefined }),
      });
      const data = (await response.json()) as { id?: string; token?: string; name?: string; error?: string };
      if (!response.ok || !data.id || !data.token) {
        setError(data.error || "Could not create an endpoint.");
        return;
      }
      saveEndpoint({
        id: data.id,
        token: data.token,
        name: data.name || "Untitled endpoint",
        createdAt: new Date().toISOString(),
      });
      router.push(`/inbox/${data.id}#t=${encodeURIComponent(data.token)}`);
    } catch {
      setError("The server did not respond.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-dvh">
      <div className="h-1 bg-lime" />
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <Mark className="size-8" />
          <span className="font-display text-xl tracking-tight">HookTrace</span>
        </Link>
        <div className="flex items-center gap-2">
          <a href="#failures" className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline">
            Signature failures
          </a>
          {signedIn ? (
            <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
              Endpoints
            </Link>
          ) : (
            <Link href="/signin" className="text-sm text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
          )}
          <Button onClick={() => setOpen(true)}>Create endpoint</Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-20">
        <section className="grid items-center gap-10 py-8 lg:grid-cols-[1.05fr_0.95fr] lg:py-14">
          <div>
            <p className="mb-4 font-mono text-xs tracking-[0.18em] text-lime uppercase">Webhook debugger</p>
            <h1 className="font-display text-4xl leading-[1.05] text-balance sm:text-6xl">
              See the raw request. Know why the signature failed.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Point Stripe, GitHub, Razorpay, or anything else at an unguessable URL. HookTrace keeps the bytes,
              checks the provider&apos;s signature scheme, and lets you replay the call. No account.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button size="lg" className="h-11 px-4" onClick={() => setOpen(true)}>
                Create endpoint
                <ArrowRight />
              </Button>
              <p className="text-sm text-muted-foreground">The owner token stays in this browser.</p>
            </div>
          </div>
          <InspectorPreview />
        </section>

        <section className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-3">
          {steps.map((step, index) => (
            <article key={step.title} className="bg-card p-5">
              <p className="font-mono text-xs text-lime">0{index + 1}</p>
              <h2 className="mt-2 font-medium">{step.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </article>
          ))}
        </section>

        <section id="failures" className="mt-16">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl">The failure is the product.</h2>
            <p className="mt-3 text-muted-foreground">
              A 400 from your server only says the signature was wrong. HookTrace runs the documented scheme and says
              which part broke: the header, the timestamp, the secret, or the bytes.
            </p>
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {failures.map((failure) => (
              <article key={failure.title} className="rounded-2xl border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-xs text-muted-foreground">{failure.provider}</p>
                  <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">Invalid</span>
                </div>
                <h3 className="mt-3 font-medium">{failure.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{failure.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-16 grid gap-4 sm:grid-cols-2">
          {features.map((feature) => (
            <article key={feature.title} className="rounded-2xl border p-5">
              <h3 className="font-medium">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.body}</p>
            </article>
          ))}
        </section>

        {saved.length > 0 && (
          <section className="mt-16">
            <h2 className="font-display text-2xl">In this browser</h2>
            <ul className="mt-4 divide-y overflow-hidden rounded-2xl border">
              {saved.map((endpoint) => (
                <li key={endpoint.id}>
                  <Link
                    href={`/inbox/${endpoint.id}`}
                    className="flex items-center justify-between gap-4 bg-card px-4 py-3 hover:bg-muted"
                  >
                    <span>
                      <span className="block font-medium">{endpoint.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">/h/{endpoint.id}</span>
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-muted-foreground">
          <p className="flex items-center gap-2">
            <Lock className="size-3.5" />
            Inboxes are unlisted. The token in local storage is the only key.
          </p>
          <p>Events expire. The default is 7 days.</p>
        </div>
      </footer>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New webhook endpoint</DialogTitle>
            <DialogDescription>
              You get a URL and an owner token. Anyone with the URL can send requests. Only this token can read them.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void createEndpoint();
            }}
          >
            <Label htmlFor="endpoint-name">Name</Label>
            <Input
              id="endpoint-name"
              value={name}
              placeholder="Stripe staging"
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create endpoint"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InspectorPreview() {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-[0_24px_80px_-40px_oklch(0.92_0.19_126/0.45)]">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 font-mono text-xs">
          <Radio className="size-3.5 text-good" />
          <span className="text-good">Live</span>
          <span className="text-muted-foreground">/h/ep_7f3a…/stripe</span>
        </div>
        <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">Invalid</span>
      </div>
      <div className="grid gap-0 sm:grid-cols-[160px_1fr]">
        <div className="border-b bg-background/40 p-3 sm:border-r sm:border-b-0">
          <p className="font-mono text-[11px] text-lime">POST</p>
          <p className="truncate text-sm">/stripe</p>
          <p className="mt-3 font-mono text-[11px] text-muted-foreground">POST</p>
          <p className="truncate text-sm text-muted-foreground">/github</p>
        </div>
        <div className="space-y-3 p-4">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-4 text-destructive" />
            <div>
              <p className="text-sm font-medium">The raw body was modified before verification.</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Stripe&apos;s payload hint says the body hash should end in a25aefc6. This body ends in 73baa202.
                The JSON was parsed and serialized again.
              </p>
            </div>
          </div>
          <pre className="overflow-x-auto rounded-lg bg-background p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {`t=1492774577
v1 expected c2f890de…9812
tolerance 300s · age 4s`}
          </pre>
        </div>
      </div>
    </div>
  );
}

const steps = [
  {
    title: "Mint a URL",
    body: "The id is 144 bits of randomness. Sending does not require the owner token. Reading does.",
  },
  {
    title: "Catch the delivery",
    body: "Method, path, query, headers, and the raw body, up to 1 MB. The response status is yours to set.",
  },
  {
    title: "Check the signature",
    body: "Stripe, GitHub, Razorpay, or a generic HMAC. Valid or invalid, with the check that failed.",
  },
];

const failures = [
  {
    provider: "Stripe",
    title: "Timestamp outside tolerance",
    body: "The v1 HMAC matches, and t= is 18 minutes old. Stripe's libraries reject that after 5 minutes.",
  },
  {
    provider: "GitHub",
    title: "sha256= prefix missing",
    body: "The digest matches the raw body, but X-Hub-Signature-256 is bare hex. GitHub always sends the prefix.",
  },
  {
    provider: "Razorpay",
    title: "JSON was re-serialized",
    body: "The signature matches JSON.stringify of the payload, not the bytes Razorpay actually sent.",
  },
];

const features = [
  {
    title: "Live inspector",
    body: "The list updates over server-sent events. Pretty JSON, the raw body, headers, and the query string sit side by side.",
  },
  {
    title: "Replay, with a guard",
    body: "Edit headers and body, then resend. Loopback, private, and link-local targets are blocked unless you explicitly allow them on a local server.",
  },
  {
    title: "Redacted by default",
    body: "Authorization, cookies, and signature headers are masked in the UI and in copied cURL. Reveal them when you mean to.",
  },
  {
    title: "They expire",
    body: "A cleanup job deletes events older than the endpoint's retention window. The default is 7 days, and you can set 1 to 30.",
  },
];
