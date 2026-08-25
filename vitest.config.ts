import { defineConfig } from 'vitest/config';

// NOTE: Once wrangler.toml is configured (task 1.3), uncomment the Cloudflare Workers
// pool setup below to enable integration tests running inside the Workers runtime.
//
// import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
//
// For Workers integration tests, use:
// plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.toml' } })],
// pool: '@cloudflare/vitest-pool-workers',

export default defineConfig({
  test: {
    include: [
      'tests/unit/**/*.test.ts',
      'tests/property/**/*.test.ts',
      'tests/integration/**/*.test.ts',
    ],
  },
});
