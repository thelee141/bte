import type {
  ApiBootstrap,
  ApiBooking,
  ApiErrorBody,
  ApiReceipt,
  ApiSlip,
} from "../../src/app/contracts";

export class ApiClientError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let error: ApiErrorBody["error"] = {
      code: "HTTP_ERROR",
      message: `Request failed with status ${response.status}`,
    };
    try {
      const body = (await response.json()) as ApiErrorBody;
      if (body?.error) error = body.error;
    } catch {
      // Keep the transport-level error.
    }
    throw new ApiClientError(error.code, error.message, error.details);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  bootstrap(): Promise<ApiBootstrap> {
    return request("/api/bootstrap");
  },

  toggleSelection(input: { eventId: string; marketId: string; outcomeId: string }): Promise<{ slip: ApiSlip }> {
    return request("/api/slip/selection", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  setStake(stakeMinor: number): Promise<{ slip: ApiSlip }> {
    return request("/api/slip/stake", {
      method: "POST",
      body: JSON.stringify({ stakeMinor }),
    });
  },

  acceptPrices(): Promise<{ slip: ApiSlip }> {
    return request("/api/slip/accept-prices", { method: "POST" });
  },

  clearSlip(): Promise<{ slip: ApiSlip }> {
    return request("/api/slip/clear", { method: "POST" });
  },

  bookSlip(): Promise<{ booking: ApiBooking }> {
    return request("/api/slip/book", { method: "POST" });
  },

  loadBooking(code: string): Promise<{ slip: ApiSlip }> {
    return request("/api/slip/load", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  },

  placeBet(idempotencyKey: string): Promise<{ receipt: ApiReceipt; slip: ApiSlip }> {
    return request("/api/bets/place", {
      method: "POST",
      body: JSON.stringify({ idempotencyKey }),
    });
  },

  settleDemo(betId: string, outcome: "WON" | "LOST" | "VOID"): Promise<void> {
    return request("/api/demo/settle", {
      method: "POST",
      body: JSON.stringify({ betId, outcome }),
    });
  },

  topUp(): Promise<{ balanceMinor: number }> {
    return request("/api/demo/top-up", { method: "POST" });
  },
};
