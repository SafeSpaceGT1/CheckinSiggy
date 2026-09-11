// Minimal edge runtime boundary used by the offline TypeScript check. A real
// Supabase/Deno deployment remains a separate integration validation step.
declare namespace Deno {
  namespace env { function get(key: string): string | undefined; }
  function serve(handler: (request: Request) => Response | Promise<Response>): void;
}
