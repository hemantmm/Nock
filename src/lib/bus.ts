import type { LiveMessage } from "./live";

type Listener = (message: LiveMessage) => void;
type Bus = Map<string, Set<Listener>>;

const globalBus = globalThis as typeof globalThis & { __hooktraceBus?: Bus };

function bus(): Bus {
  if (!globalBus.__hooktraceBus) globalBus.__hooktraceBus = new Map();
  return globalBus.__hooktraceBus;
}

export function subscribe(endpointId: string, listener: Listener): () => void {
  const listeners = bus().get(endpointId) ?? new Set<Listener>();
  listeners.add(listener);
  bus().set(endpointId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) bus().delete(endpointId);
  };
}

export function publish(endpointId: string, message: LiveMessage): void {
  const listeners = bus().get(endpointId);
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      listener(message);
    } catch {
      // A closed stream should not break capture.
    }
  }
}
