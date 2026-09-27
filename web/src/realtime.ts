import type { RealtimeEvent, RealtimeSnapshot } from "../../src/realtime/types";

export type StreamStatus = "CONNECTING" | "CONNECTED" | "RECONNECTING";

interface SnapshotMessage {
  readonly reason: string;
  readonly snapshot: RealtimeSnapshot;
}

export function connectRealtime(input: {
  onEvent: (event: RealtimeEvent) => void;
  onSnapshot: (snapshot: RealtimeSnapshot) => void;
  onStatus: (status: StreamStatus) => void;
}): () => void {
  input.onStatus("CONNECTING");
  const source = new EventSource("/api/stream");

  source.onopen = () => input.onStatus("CONNECTED");
  source.onerror = () => input.onStatus("RECONNECTING");

  const onSnapshot = (raw: Event) => {
    const event = raw as MessageEvent<string>;
    const message = JSON.parse(event.data) as SnapshotMessage;
    input.onSnapshot(message.snapshot);
  };

  const onRealtime = (raw: Event) => {
    const event = raw as MessageEvent<string>;
    input.onEvent(JSON.parse(event.data) as RealtimeEvent);
  };

  source.addEventListener("snapshot", onSnapshot);
  for (const kind of ["price", "market_state", "event_state", "score", "clock", "stats"]) {
    source.addEventListener(kind, onRealtime);
  }

  return () => source.close();
}
