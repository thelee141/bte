import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createAppContext, type AppContext } from "./context.js";
import { handleApiRequest } from "./api.js";
import { RealtimeSseGateway } from "../realtime/sse.js";

const DEFAULT_PORT = 4100;
const DEFAULT_HOST = "127.0.0.1";
const WEB_DIST = resolve(process.cwd(), "web-dist");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function webPath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const segments = decoded.replace(/\\/g, "/").split("/");
  if (segments.includes("..")) return null;

  const relativePath = normalize(decoded).replace(/^[/\\]+/, "");
  const candidate = resolve(WEB_DIST, relativePath);
  if (candidate !== WEB_DIST && !candidate.startsWith(`${WEB_DIST}${sep}`)) {
    return null;
  }
  return candidate;
}

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function serveWeb(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const candidate = webPath(url.pathname);
  if (candidate === null) {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  const target = (await fileExists(candidate)) ? candidate : join(WEB_DIST, "index.html");
  if (!(await fileExists(target))) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Customer web build not found. Run pnpm run build:web.");
    return;
  }

  const body = await readFile(target);
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[extname(target)] ?? "application/octet-stream",
    "Cache-Control": target.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
    "Content-Length": body.byteLength,
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}

export async function createCustomerServer(context?: AppContext) {
  const app = context ?? (await createAppContext());
  const sse = new RealtimeSseGateway(app.realtimeHub, {
    path: "/api/stream",
    heartbeatMs: 15_000,
    retryMs: 2_000,
  });

  const server = createServer(async (req, res) => {
    setSecurityHeaders(res);

    try {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

      if (pathname === "/api/stream") {
        sse.handle(req, res);
        return;
      }

      if (await handleApiRequest(app, req, res)) return;
      await serveWeb(req, res);
    } catch (error) {
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : undefined);
        return;
      }
      const payload = JSON.stringify({
        error: {
          code: "INTERNAL_ERROR",
          message: "Unexpected server error",
        },
      });
      res.writeHead(500, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(payload),
      });
      res.end(payload);
    }
  });

  return { server, context: app };
}

async function main(): Promise<void> {
  const { server, context } = await createCustomerServer();
  const port = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  const host = process.env.HOST ?? DEFAULT_HOST;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT ${String(process.env.PORT)}`);
  }

  const feedIntervalMs = Number.parseInt(process.env.REALTIME_TICK_MS ?? "4000", 10);
  if (!Number.isInteger(feedIntervalMs) || feedIntervalMs < 250) {
    throw new Error("REALTIME_TICK_MS must be an integer >= 250");
  }

  const interval = setInterval(() => {
    void context.realtimeFixture.nextTick().catch((error: unknown) => {
      console.error("realtime fixture tick failed", error);
    });
  }, feedIntervalMs);
  interval.unref();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  console.log(`BTE Play server listening on http://${host}:${port}`);

  const shutdown = async () => {
    clearInterval(interval);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await context.prisma.$disconnect();
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
}

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
