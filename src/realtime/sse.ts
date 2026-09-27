import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { RealtimeHub } from "./hub.js";
import type { RealtimeEvent, RealtimeSnapshot } from "./types.js";

export interface RealtimeSseGatewayOptions {
  readonly path?: string;
  readonly heartbeatMs?: number;
  readonly retryMs?: number;
}

function eventName(event: RealtimeEvent): string {
  return event.kind.toLowerCase();
}

function encodeEvent(event: RealtimeEvent): string {
  return `id: ${event.sequence}\nevent: ${eventName(event)}\ndata: ${JSON.stringify(event)}\n\n`;
}

function encodeSnapshot(snapshot: RealtimeSnapshot, reason: string): string {
  return `id: ${snapshot.sequence}\nevent: snapshot\ndata: ${JSON.stringify({ reason, snapshot })}\n\n`;
}

function parseAfterSequence(req: IncomingMessage, url: URL): number | null {
  const queryValue = url.searchParams.get("after");
  const headerValue = req.headers["last-event-id"];
  const raw =
    queryValue ??
    (Array.isArray(headerValue) ? headerValue[headerValue.length - 1] : headerValue) ??
    null;

  if (raw === null || raw === "") return null;
  if (!/^\d+$/.test(raw)) throw new Error("Invalid reconnect sequence");
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Invalid reconnect sequence");
  return parsed;
}

export class RealtimeSseGateway {
  private readonly hub: RealtimeHub;
  private readonly path: string;
  private readonly heartbeatMs: number;
  private readonly retryMs: number;

  constructor(hub: RealtimeHub, opts?: RealtimeSseGatewayOptions) {
    this.hub = hub;
    this.path = opts?.path ?? "/stream";
    this.heartbeatMs = opts?.heartbeatMs ?? 15_000;
    this.retryMs = opts?.retryMs ?? 2_000;

    if (!this.path.startsWith("/")) throw new Error("SSE path must start with /");
    if (!Number.isInteger(this.heartbeatMs) || this.heartbeatMs < 1000) {
      throw new Error("heartbeatMs must be an integer >= 1000");
    }
    if (!Number.isInteger(this.retryMs) || this.retryMs < 0) {
      throw new Error("retryMs must be a non-negative integer");
    }
  }

  createServer(): Server {
    return createServer((req, res) => this.handle(req, res));
  }

  handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname !== this.path) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405, {
        Allow: "GET",
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Method not allowed");
      return;
    }

    let afterSequence: number | null;
    try {
      afterSequence = parseAfterSequence(req, url);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Invalid reconnect sequence");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    let closed = false;
    let bootstrapping = true;
    let lastSent = afterSequence ?? 0;
    const pendingLive: RealtimeEvent[] = [];
    const outbound: string[] = [];
    let backpressured = false;

    const flushOutbound = () => {
      if (closed) return;
      backpressured = false;
      while (outbound.length > 0) {
        const chunk = outbound.shift();
        if (chunk === undefined) break;
        if (!res.write(chunk)) {
          backpressured = true;
          res.once("drain", flushOutbound);
          break;
        }
      }
    };

    const writeChunk = (chunk: string) => {
      if (closed) return;
      if (backpressured) {
        outbound.push(chunk);
        return;
      }
      if (!res.write(chunk)) {
        backpressured = true;
        res.once("drain", flushOutbound);
      }
    };

    const writeLiveEvent = (event: RealtimeEvent) => {
      if (event.sequence <= lastSent) return;
      if (event.sequence !== lastSent + 1) {
        const snapshot = this.hub.snapshot();
        writeChunk(encodeSnapshot(snapshot, "LIVE_GAP"));
        lastSent = snapshot.sequence;
        return;
      }
      writeChunk(encodeEvent(event));
      lastSent = event.sequence;
    };

    const unsubscribe = this.hub.subscribe((event) => {
      if (bootstrapping) {
        pendingLive.push(event);
        return;
      }
      writeLiveEvent(event);
    });

    try {
      writeChunk(`retry: ${this.retryMs}\n\n`);
      const bootstrap = this.hub.bootstrap(afterSequence);
      if (bootstrap.mode === "SNAPSHOT") {
        writeChunk(encodeSnapshot(bootstrap.snapshot, bootstrap.reason));
        lastSent = bootstrap.snapshot.sequence;
      } else {
        for (const event of bootstrap.events) {
          writeLiveEvent(event);
        }
      }

      bootstrapping = false;
      for (const event of pendingLive.sort((a, b) => a.sequence - b.sequence)) {
        writeLiveEvent(event);
      }
      pendingLive.length = 0;
    } catch {
      unsubscribe();
      res.end();
      return;
    }

    const heartbeat = setInterval(() => {
      writeChunk(": keepalive\n\n");
    }, this.heartbeatMs);
    heartbeat.unref();

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      outbound.length = 0;
      pendingLive.length = 0;
    };

    req.once("close", cleanup);
    res.once("close", cleanup);
    res.once("finish", cleanup);
  }
}
