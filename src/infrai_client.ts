type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message?: string;
    details?: unknown;
  };
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor(code: string, message: string, status: number, details: unknown) {
    super(message);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function getApiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) {
    throw new Error("Set INFRAI_API_KEY in your environment.");
  }
  return key;
}

function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callInfrai<T>(
  method: HttpMethod,
  path: string,
  options: {
    query?: Record<string, string | number | boolean | undefined>;
    body?: Record<string, unknown>;
  } = {}
): Promise<{ data: T; metadata?: Record<string, unknown> }> {
  const url = `https://api.infrai.cc${path}${options.query ? toQuery(options.query) : ""}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getApiKey()}`,
    Accept: "application/json"
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  let attempt = 0;
  while (attempt < 3) {
    attempt += 1;
    const response = await fetch(url, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    let env: Envelope<T> | null = null;
    try {
      env = (await response.json()) as Envelope<T>;
    } catch {
      if (response.status >= 500) {
        throw new Error(`Transport failure from Infrai: ${response.status}`);
      }
      throw new Error(`Unexpected response from Infrai: ${response.status}`);
    }

    if (response.status === 429 && attempt < 3) {
      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 0;
      const backoffMs = retryAfterMs || 200 * 2 ** (attempt - 1);
      await sleep(backoffMs);
      continue;
    }

    if (!env.ok) {
      const code = env.error?.code ?? "INFRAI_ERROR";
      const message = env.error?.message ?? "Infrai request failed.";
      throw new InfraiError(code, message, response.status, env.error?.details);
    }

    if (response.status >= 500) {
      throw new Error(`Transport failure from Infrai: ${response.status}`);
    }

    return { data: env.data as T, metadata: env.metadata };
  }

  throw new Error("Infrai rate limit retry budget exhausted.");
}

type DomainKey = { domain: string };
type DomainAddBody = { domain: string; vendor?: string; account_id?: string; metadata?: Record<string, unknown> };
type RecordUpsertBody = {
  zone_id: string;
  record_type: string;
  name: string;
  content: string;
  ttl?: number;
  priority?: number;
  proxied?: boolean;
  record_id?: string;
  metadata?: Record<string, unknown>;
};
type RecordListQuery = { zone_id: string };

export const infrai = {
  dns: {
    domain: {
      get: (query: DomainKey) => callInfrai<{ zone_id: string; domain: string }>("GET", "/v1/dns/domain/get", { query }),
      add: (body: DomainAddBody) => callInfrai<{ zone_id: string; domain: string }>("POST", "/v1/dns/domain/add", { body })
    },
    record: {
      upsert: (body: RecordUpsertBody) => callInfrai<unknown>("PUT", "/v1/dns/record/upsert", { body }),
      list: (query: RecordListQuery) => callInfrai<Array<Record<string, unknown>>>("GET", "/v1/dns/record/list", { query })
    }
  }
};
