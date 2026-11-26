"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AccountHeader } from "@/components/account-header";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/client/api";

type Me = {
  user: { email: string; name: string | null; hasPassword: boolean; githubLinked: boolean } | null;
  githubOAuth?: boolean;
};

type TokenRow = { id: string; name: string; preview: string; lastUsedAt: string | null; createdAt: string };

export function SettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me["user"]>(null);
  const [github, setGithub] = useState(false);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [freshToken, setFreshToken] = useState("");
  const [tokenName, setTokenName] = useState("Laptop");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const body = await api<Me>("/api/auth/me", null);
        if (cancelled) return;
        if (!body.user) {
          router.replace("/signin");
          return;
        }
        setMe(body.user);
        setGithub(Boolean(body.githubOAuth));
        const listed = await api<{ tokens: TokenRow[] }>("/api/auth/tokens", null);
        if (!cancelled) setTokens(listed.tokens);
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 401) router.replace("/signin");
        else setError(caught instanceof Error ? caught.message : "Could not load account.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="min-h-dvh">
      <div className="h-1 bg-lime" />
      <AccountHeader email={me?.email} />
      <main className="mx-auto grid max-w-3xl gap-8 px-5 pb-16">
        <div>
          <h1 className="font-display text-4xl">Account</h1>
          <p className="mt-2 text-sm text-muted-foreground">{me?.email}</p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {message && <p className="text-sm text-good">{message}</p>}

        <section className="rounded-2xl border bg-card p-4">
          <h2 className="font-medium">{me?.hasPassword ? "Change password" : "Set a password"}</h2>
          <form
            className="mt-3 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              setError("");
              void api("/api/auth/password", null, {
                method: "POST",
                body: JSON.stringify({ currentPassword, newPassword }),
              })
                .then(() => {
                  setMessage("Password updated.");
                  setCurrentPassword("");
                  setNewPassword("");
                })
                .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not update password."));
            }}
          >
            {me?.hasPassword && (
              <label className="grid gap-1.5 text-sm">
                <Label>Current password</Label>
                <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              </label>
            )}
            <label className="grid gap-1.5 text-sm">
              <Label>New password</Label>
              <Input type="password" value={newPassword} minLength={10} onChange={(e) => setNewPassword(e.target.value)} />
            </label>
            <Button type="submit" className="w-fit">
              Save password
            </Button>
          </form>
        </section>

        <section className="rounded-2xl border bg-card p-4">
          <h2 className="font-medium">API tokens</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            `hooktrace login` stores one of these in ~/.config/hooktrace. Revoking a token stops the CLI that uses it.
          </p>
          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void api<{ token: string }>("/api/auth/tokens", null, {
                method: "POST",
                body: JSON.stringify({ name: tokenName }),
              }).then(async (created) => {
                setFreshToken(created.token);
                setMessage("Copy this token now. It will not be shown again.");
                const listed = await api<{ tokens: TokenRow[] }>("/api/auth/tokens", null);
                setTokens(listed.tokens);
              });
            }}
          >
            <Input value={tokenName} onChange={(e) => setTokenName(e.target.value)} className="max-w-xs" />
            <Button type="submit">Create token</Button>
          </form>
          {freshToken && (
            <div className="mt-3 rounded-lg bg-background p-3">
              <p className="font-mono text-xs break-all">{freshToken}</p>
              <CopyButton className="mt-2" value={freshToken} label="Copy token" />
            </div>
          )}
          <ul className="mt-4 divide-y">
            {tokens.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span>
                  <span className="font-medium">{token.name}</span>
                  <span className="mt-1 block font-mono text-xs text-muted-foreground">{token.preview}</span>
                  <span className="block text-xs text-muted-foreground">
                    {token.lastUsedAt ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}` : "Not used yet"}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void api(`/api/auth/tokens/${token.id}`, null, { method: "DELETE" }).then(() =>
                      setTokens((current) => current.filter((item) => item.id !== token.id)),
                    );
                  }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </section>

        {github && !me?.githubLinked && (
          <section className="rounded-2xl border bg-card p-4">
            <h2 className="font-medium">GitHub</h2>
            <Button className="mt-3" variant="outline" onClick={() => (window.location.href = "/api/auth/github")}>
              Link GitHub
            </Button>
          </section>
        )}

        <section className="rounded-2xl border border-destructive/40 bg-card p-4">
          <h2 className="font-medium">Delete account</h2>
          <p className="mt-1 text-sm text-muted-foreground">This removes your endpoints, captured requests, sessions, and API tokens.</p>
          <form
            className="mt-3 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!window.confirm("Delete this account and every endpoint on it?")) return;
              void api("/api/auth/account", null, {
                method: "DELETE",
                body: JSON.stringify(me?.hasPassword ? { password: deletePassword } : { confirmEmail }),
              })
                .then(() => router.push("/"))
                .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Could not delete the account."));
            }}
          >
            {me?.hasPassword ? (
              <Input type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} placeholder="Password" />
            ) : (
              <Input value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} placeholder="Type your email" />
            )}
            <Button type="submit" variant="destructive" className="w-fit">
              Delete account
            </Button>
          </form>
        </section>
      </main>
    </div>
  );
}
