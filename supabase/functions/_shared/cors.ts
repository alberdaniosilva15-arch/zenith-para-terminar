const DEFAULT_ALLOWED_HEADERS =
  'authorization, x-client-info, apikey, content-type';

type CorsOptions = {
  methods: string;
  headers?: string;
  allowNoOrigin?: boolean;
};

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function parseConfiguredOrigins(): Set<string> {
  const configured = new Set<string>();
  const raw =
    Deno.env.get('ALLOWED_ORIGINS') ??
    Deno.env.get('ALLOWED_ORIGIN') ??
    '';

  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed || trimmed === '*') {
      continue;
    }

    const normalized = normalizeOrigin(trimmed);
    if (normalized) {
      configured.add(normalized);
    }
  }

  return configured;
}

function isDevOrigin(origin: string): boolean {
  if (origin === 'capacitor://localhost' || origin === 'ionic://localhost') {
    return true;
  }

  try {
    const url = new URL(origin);
    const isLocalHost =
      url.hostname === 'localhost' || url.hostname === '127.0.0.1';

    return isLocalHost && (url.protocol === 'http:' || url.protocol === 'https:');
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin: string): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return false;
  }

  const configuredOrigins = parseConfiguredOrigins();
  if (configuredOrigins.has(normalized)) {
    return true;
  }

  return isDevOrigin(normalized);
}

export function resolveCorsHeaders(
  req: Request,
  options: CorsOptions,
): Headers | null {
  const headers = new Headers({
    'Access-Control-Allow-Headers': options.headers ?? DEFAULT_ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': options.methods,
    Vary: 'Origin',
  });

  const origin = req.headers.get('Origin');
  if (!origin) {
    return options.allowNoOrigin === false ? null : headers;
  }

  if (!isAllowedOrigin(origin)) {
    return null;
  }

  headers.set('Access-Control-Allow-Origin', normalizeOrigin(origin)!);
  return headers;
}

export function applyCors(response: Response, corsHeaders: Headers | null): Response {
  if (!corsHeaders) {
    return response;
  }

  corsHeaders.forEach((value, key) => response.headers.set(key, value));
  return response;
}

export function corsHeadersToObject(
  corsHeaders: Headers | null,
): Record<string, string> {
  return corsHeaders ? Object.fromEntries(corsHeaders.entries()) : {};
}

export function corsForbidden(message = 'Origin nao permitido.'): Response {
  return new Response(
    JSON.stringify({
      error: true,
      message,
    }),
    {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
        Vary: 'Origin',
      },
    },
  );
}
