"use client";

import { useEffect, useState } from "react";
import { Bell, CheckCheck, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/client/api";
import { formatRelative } from "@/lib/format";
import type { AlertView } from "@/lib/types";

type AlertResponse = { alerts: AlertView[]; unreadCount: number };

export function AlertsDialog({
  open,
  onOpenChange,
  endpointId,
  token,
  onUnreadCount,
  onSelectEvent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpointId: string;
  token: string | null;
  onUnreadCount: (count: number) => void;
  onSelectEvent: (eventId: string) => void;
}) {
  const [alerts, setAlerts] = useState<AlertView[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function load() {
    try {
      const response = await api<AlertResponse>(`/api/endpoints/${endpointId}/alerts`, token);
      setAlerts(response.alerts);
      onUnreadCount(response.unreadCount);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load alerts.");
    }
  }

  useEffect(() => {
    if (open) void load();
    // load only when the dialog opens or the selected endpoint changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, endpointId, token]);

  async function markRead(alertId?: string) {
    setPending(true);
    try {
      const response = await api<AlertResponse & { updated: number }>(`/api/endpoints/${endpointId}/alerts`, token, {
        method: "PATCH",
        body: JSON.stringify(alertId ? { alertId } : { all: true }),
      });
      setAlerts(response.alerts);
      onUnreadCount(response.unreadCount);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update alerts.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bell className="size-4" /> Alerts</DialogTitle>
          <DialogDescription>Signature failures, traffic bursts, and replay failures for this endpoint.</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="outline" disabled={pending || !alerts.some((alert) => !alert.readAt)} onClick={() => void markRead()}>
            <CheckCheck /> Mark all read
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {alerts.length === 0 && !error ? (
          <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">No alerts yet.</div>
        ) : (
          <div className="grid max-h-[55dvh] gap-2 overflow-auto">
            {alerts.map((alert) => (
              <div key={alert.id} className={`rounded-lg border p-3 ${alert.readAt ? "" : "bg-muted/50"}`}>
                <div className="flex items-start gap-3">
                  <CircleAlert className={`mt-0.5 size-4 shrink-0 ${alert.type === "signature_failure" ? "text-destructive" : "text-warn"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">{alert.title}</p>
                      <time className="shrink-0 text-xs text-muted-foreground" title={alert.createdAt}>
                        {formatRelative(alert.createdAt, Date.now())}
                      </time>
                    </div>
                    <p className="mt-1 break-words text-sm text-muted-foreground">{alert.message}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {alert.eventId && (
                        <Button type="button" size="sm" variant="outline" onClick={() => {
                          if (!alert.readAt) void markRead(alert.id);
                          onOpenChange(false);
                          onSelectEvent(alert.eventId!);
                        }}>
                          View request
                        </Button>
                      )}
                      {!alert.readAt && (
                        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => void markRead(alert.id)}>
                          Mark read
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
