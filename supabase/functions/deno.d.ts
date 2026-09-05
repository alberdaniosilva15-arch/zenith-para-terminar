// VS Code Editor declarations for Supabase Edge Functions (Deno runtime)
// Editor-only typing - does NOT require or install Deno locally.

declare namespace Deno {
  export const env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    toObject(): Record<string, string>;
  };
  export function serve(handler: (req: Request) => Promise<Response> | Response): void;
  export function serve(options: any, handler: (req: Request) => Promise<Response> | Response): void;
}

declare module 'https://*' {
  const content: any;
  export default content;
  export const createClient: any;
  export const GoogleGenerativeAI: any;
  export const encodeBase64: any;
  export const serve: any;
}
