"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client/api";

export function AccountHeader({ email }: { email?: string | null }) {
  const router = useRouter();
  return (
    <header className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-5">
      <Link href="/" className="flex items-center gap-2.5">
        <Mark className="size-8" />
        <span className="font-display text-xl tracking-tight">HookTrace</span>
      </Link>
      <nav className="flex items-center gap-3 text-sm">
        <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
          Endpoints
        </Link>
        <Link href="/settings" className="text-muted-foreground hover:text-foreground">
          Account
        </Link>
        {email && <span className="hidden text-muted-foreground sm:inline">{email}</span>}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void api("/api/auth/signout", null, { method: "POST" }).then(() => router.push("/"));
          }}
        >
          Sign out
        </Button>
      </nav>
    </header>
  );
}
