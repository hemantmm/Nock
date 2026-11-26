"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadEndpoints } from "@/lib/client/storage";

export function AuthScreen({ mode }: { mode: "signin" | "signup" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const signup = mode === "signup";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch(signup ? "/api/auth/signup" : "/api/auth/signin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, name: name.trim() || undefined }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error || "Could not sign in.");
        return;
      }
      const pendingClaim = loadEndpoints().length > 0;
      router.push(pendingClaim ? "/dashboard?claim=1" : "/dashboard");
    } catch {
      setError("The server did not respond.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-5">
      <form onSubmit={(event) => void submit(event)} className="w-full max-w-md rounded-2xl border bg-card p-5">
        <Link href="/" className="flex items-center gap-2">
          <Mark className="size-8" />
          <span className="font-display text-xl">HookTrace</span>
        </Link>
        <h1 className="mt-5 font-display text-3xl">{signup ? "Create an account" : "Sign in"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {signup
            ? "Endpoints you already opened in this browser can be claimed after this."
            : "Your inboxes stay on this account. Anonymous endpoints can still be claimed."}
        </p>
        <div className="mt-5 grid gap-3">
          {signup && (
            <label className="grid gap-1.5 text-sm">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </label>
          )}
          <label className="grid gap-1.5 text-sm">
            <Label>Email</Label>
            <Input type="email" value={email} required onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label className="grid gap-1.5 text-sm">
            <Label>Password</Label>
            <Input
              type="password"
              value={password}
              required
              minLength={10}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={signup ? "new-password" : "current-password"}
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Working…" : signup ? "Create account" : "Sign in"}
          </Button>
          <GitHubButton />
          <p className="text-sm text-muted-foreground">
            {signup ? (
              <Link href="/signin" className="underline-offset-4 hover:underline">
                Already have an account
              </Link>
            ) : (
              <Link href="/signup" className="underline-offset-4 hover:underline">
                Create an account
              </Link>
            )}
          </p>
        </div>
      </form>
    </div>
  );
}

function GitHubButton() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    void fetch("/api/auth/me")
      .then((response) => response.json())
      .then((body: { githubOAuth?: boolean }) => setEnabled(Boolean(body.githubOAuth)))
      .catch(() => setEnabled(false));
  }, []);
  if (!enabled) return null;
  return (
    <Button type="button" variant="outline" onClick={() => (window.location.href = "/api/auth/github")}>
      Continue with GitHub
    </Button>
  );
}
