/// <reference types="astro/client" />

declare module 'cloudflare:workers' {
  interface Env {
    DB: D1Database;
  }
  export const env: Env;
}
