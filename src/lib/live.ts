import type { EventSummary } from "./types";

export type LiveMessage =
  | { type: "hello"; endpointId: string; latestEventId: string | null }
  | { type: "event"; event: EventSummary }
  | { type: "refresh" };
