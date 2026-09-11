export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export class RequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function guardRequest(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') {
    const response = json({ error: 'method_not_allowed' }, 405);
    response.headers.set('Allow', 'POST, OPTIONS');
    return response;
  }
  if (!/^Bearer\s+\S+$/i.test(req.headers.get('Authorization') ?? '')) {
    return json({ error: 'unauthorized' }, 401);
  }
  return null;
}

export async function readObjectBody(req: Request): Promise<Record<string, unknown>> {
  // Endpoints accept only IDs/options. Bound bytes even without Content-Length.
  const reader = req.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) {
      await reader.cancel();
      throw new RequestError(413, 'body_too_large');
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(buffer).trim();
  if (!text) return {};
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new RequestError(400, 'invalid_json'); }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestError(400, 'object_body_required');
  }
  return body as Record<string, unknown>;
}

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function errorResponse(error: unknown): Response {
  if (error instanceof RequestError) return json({ error: error.code }, error.status);
  // Do not return internal SQL, provider messages, tokens, or journal data.
  return json({ error: 'internal_error' }, 500);
}
