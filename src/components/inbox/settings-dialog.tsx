"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CopyButton } from "@/components/copy-button";
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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/client/api";
import { forgetEndpoint } from "@/lib/client/storage";
import type { EndpointView, ProviderId, SigningEncoding } from "@/lib/types";

export function SettingsDialog({
  open,
  onOpenChange,
  endpointId,
  token,
  endpoint,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpointId: string;
  token: string | null;
  endpoint: EndpointView;
  onSaved: (endpoint: EndpointView) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(endpoint.name);
  const [status, setStatus] = useState(String(endpoint.responseStatus));
  const [contentType, setContentType] = useState(endpoint.responseContentType);
  const [responseBody, setResponseBody] = useState(endpoint.responseBody);
  const [provider, setProvider] = useState<string>(endpoint.signingProvider ?? "none");
  const [secret, setSecret] = useState("");
  const [headerName, setHeaderName] = useState(endpoint.signingHeader ?? "X-Signature-256");
  const [encoding, setEncoding] = useState<SigningEncoding>(endpoint.signingEncoding);
  const [timestampHeader, setTimestampHeader] = useState(endpoint.timestampHeader ?? "");
  const [tolerance, setTolerance] = useState(String(endpoint.toleranceSeconds));
  const [retention, setRetention] = useState(String(endpoint.retentionDays));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(endpoint.name);
    setStatus(String(endpoint.responseStatus));
    setContentType(endpoint.responseContentType);
    setResponseBody(endpoint.responseBody);
    setProvider(endpoint.signingProvider ?? "none");
    setSecret("");
    setHeaderName(endpoint.signingHeader ?? "X-Signature-256");
    setEncoding(endpoint.signingEncoding);
    setTimestampHeader(endpoint.timestampHeader ?? "");
    setTolerance(String(endpoint.toleranceSeconds));
    setRetention(String(endpoint.retentionDays));
    setError("");
  }, [open, endpoint]);

  async function save(clearSecret = false) {
    setPending(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        name,
        responseStatus: Number(status),
        responseContentType: contentType,
        responseBody,
        signingProvider: provider === "none" ? null : (provider as ProviderId),
        signingHeader: headerName.trim() || null,
        signingEncoding: encoding,
        timestampHeader: timestampHeader.trim() || null,
        toleranceSeconds: Number(tolerance),
        retentionDays: Number(retention),
      };
      if (clearSecret) payload.signingSecret = null;
      else if (secret.trim()) payload.signingSecret = secret;
      const saved = await api<EndpointView>(`/api/endpoints/${endpointId}`, token, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      onSaved(saved);
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save settings.");
    } finally {
      setPending(false);
    }
  }

  async function clearHistory() {
    if (!window.confirm("Delete every captured request for this endpoint?")) return;
    await api(`/api/endpoints/${endpointId}/events`, token, { method: "DELETE" });
    onOpenChange(false);
    window.location.reload();
  }

  async function destroy() {
    if (!window.confirm("Delete this endpoint and its captured requests?")) return;
    await api(`/api/endpoints/${endpointId}`, token, { method: "DELETE" });
    forgetEndpoint(endpointId);
    router.push("/");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Endpoint settings</DialogTitle>
          <DialogDescription>
            The response below is what HookTrace returns to the sender. The signing secret is encrypted at rest and
            used only to check captured requests.
          </DialogDescription>
          </DialogHeader>
          {token && (
          <div className="rounded-lg border bg-background px-3 py-2">
            <p className="text-xs text-muted-foreground">Owner token for this endpoint</p>
            <p className="mt-1 font-mono text-xs break-all">{token}</p>
            <CopyButton className="mt-2" value={token} label="Copy token" />
          </div>
          )}
          <div className="grid gap-3">
          <Field label="Name">
            <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Response status">
              <Input value={status} inputMode="numeric" onChange={(e) => setStatus(e.target.value)} />
            </Field>
            <Field label="Keep events (days)">
              <Input value={retention} inputMode="numeric" onChange={(e) => setRetention(e.target.value)} />
            </Field>
          </div>
          <Field label="Response content type">
            <Input value={contentType} onChange={(e) => setContentType(e.target.value)} />
          </Field>
          <Field label="Response body">
            <Textarea value={responseBody} onChange={(e) => setResponseBody(e.target.value)} className="font-mono text-xs" />
          </Field>
          <Field label="Signature provider">
            <Select value={provider} onValueChange={(value) => setProvider(value ?? "none")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="stripe">Stripe</SelectItem>
                <SelectItem value="github">GitHub</SelectItem>
                <SelectItem value="razorpay">Razorpay</SelectItem>
                <SelectItem value="hmac_sha256">Generic HMAC-SHA256</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {provider !== "none" && (
            <Field label={endpoint.hasSigningSecret ? `Signing secret (${endpoint.signingSecretPreview})` : "Signing secret"}>
              <Input
                type="password"
                value={secret}
                autoComplete="new-password"
                placeholder={endpoint.hasSigningSecret ? "Leave blank to keep the saved secret" : "whsec_… or the webhook secret"}
                onChange={(e) => setSecret(e.target.value)}
              />
            </Field>
          )}
          {provider === "stripe" && (
            <Field label="Tolerance (seconds)">
              <Input value={tolerance} inputMode="numeric" onChange={(e) => setTolerance(e.target.value)} />
            </Field>
          )}
          {provider === "hmac_sha256" && (
            <>
              <Field label="Signature header">
                <Input value={headerName} onChange={(e) => setHeaderName(e.target.value)} />
              </Field>
              <Field label="Encoding">
                <Select value={encoding} onValueChange={(value) => setEncoding((value as SigningEncoding) ?? "hex")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hex">Bare hex</SelectItem>
                    <SelectItem value="prefixed_hex">sha256=hex</SelectItem>
                    <SelectItem value="base64">Base64</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Timestamp header (optional)">
                <Input
                  value={timestampHeader}
                  placeholder="Blank signs the raw body"
                  onChange={(e) => setTimestampHeader(e.target.value)}
                />
              </Field>
              <Field label="Tolerance (seconds)">
                <Input value={tolerance} inputMode="numeric" onChange={(e) => setTolerance(e.target.value)} />
              </Field>
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={() => void save(false)}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {endpoint.hasSigningSecret && (
              <Button type="button" variant="outline" disabled={pending} onClick={() => void save(true)}>
                Remove secret
              </Button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 border-t pt-3">
            <Button type="button" variant="outline" onClick={() => void clearHistory()}>
              Clear captured requests
            </Button>
            <Button type="button" variant="destructive" onClick={() => void destroy()}>
              Delete endpoint
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
