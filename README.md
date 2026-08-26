# HackFinder

Find hackathons from around the world. HackFinder aggregates events from Devpost, MLH, and HackerEarth into one searchable, filterable interface. Deployed on Cloudflare's edge network for fast global access with zero server management.

## What It Does

- **Aggregates** hackathon data from Devpost, MLH, and HackerEarth on an hourly schedule
- **Searches** across all events with full-text search (FTS5 with BM25 ranking)
- **Filters** by date range, format (virtual/in-person/hybrid), and tags
- **Displays** results in a responsive grid with infinite scroll
- **Serves** SEO-friendly pages with server-side rendering and meta tags

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Astro](https://astro.build/) with SSR via `@astrojs/cloudflare` adapter |
| UI Islands | [React](https://react.dev/) for interactive components (search, filters, grid) |
| Styling | [Tailwind CSS](https://tailwindcss.com/) v4 |
| Database | [Cloudflare D1](https://developers.cloudflare.com/d1/) (edge SQLite with FTS5) |
| ORM | [Drizzle ORM](https://orm.drizzle.team/) with D1 driver |
| Hosting | [Cloudflare Pages](https://pages.cloudflare.com/) (static + Pages Functions) |
| Aggregation | [Cloudflare Workers](https://workers.cloudflare.com/) with Cron Triggers |
| Testing | [Vitest](https://vitest.dev/) + [fast-check](https://fast-check.dev/) + [Playwright](https://playwright.dev/) |

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- **npm** 9+
- **Wrangler CLI** (installed as a dev dependency, or globally via `npm install -g wrangler`)
- **Cloudflare account** (free tier is sufficient)

## Local Development Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create the D1 database

```bash
npx wrangler d1 create hackathon-discovery-db
```

This outputs a `database_id`. Copy it and update both `wrangler.toml` files:

- `wrangler.toml` (root - Pages project)
- `workers/aggregator/wrangler.toml` (Aggregation Worker)

Replace `<your-d1-database-id>` with the actual ID in both files.

### 3. Run the database migration

```bash
npx wrangler d1 execute hackathon-discovery-db --local --file=src/lib/db/migrations/0001_create_tables.sql
```

This creates all tables, the FTS5 virtual table, and sync triggers in your local D1 instance.

### 4. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` with your D1 database ID (same as step 2).

### 5. Start the development server

```bash
npm run dev
```

This starts Astro's dev server with the Cloudflare adapter and local D1 access via `platformProxy`.

The site will be available at `http://localhost:4321`.

### 6. (Optional) Test the aggregation worker locally

```bash
npx wrangler dev --config workers/aggregator/wrangler.toml
```

Then trigger a manual aggregation run:

```bash
curl http://localhost:8787/__scheduled
```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Astro dev server with hot reload |
| `npm run build` | Build for production (Cloudflare Pages output) |
| `npm run preview` | Preview the production build locally |
| `npm test` | Run unit and property-based tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:e2e` | Run end-to-end tests (Playwright) |
| `npm run check` | Run Astro type checking |

## Deployment to Cloudflare

### 1. Deploy the Pages project (frontend + API)

```bash
npm run build
npx wrangler pages deploy dist
```

Or connect your repository to Cloudflare Pages for automatic git-based deploys:
1. Go to Cloudflare Dashboard > Pages
2. Create a new project and connect your Git repository
3. Set build command: `npm run build`
4. Set build output directory: `dist`

### 2. Deploy the Aggregation Worker

```bash
npx wrangler deploy --config workers/aggregator/wrangler.toml
```

This deploys the worker with its Cron Trigger (runs every hour by default).

### 3. Run the migration on production D1

```bash
npx wrangler d1 execute hackathon-discovery-db --remote --file=src/lib/db/migrations/0001_create_tables.sql
```

## Custom Domain Setup

Cloudflare Pages supports custom domains with automatic HTTPS:

1. **Add a CNAME record** in Cloudflare DNS:
   - Name: `hackathons` (or your preferred subdomain)
   - Target: `<your-pages-project>.pages.dev`
   - Proxy: enabled (orange cloud)

2. **Configure in Pages settings**:
   - Go to Cloudflare Dashboard > Pages > your project > Custom domains
   - Click "Set up a custom domain"
   - Enter your domain (e.g., `hackathons.yourdomain.com`)
   - Cloudflare provisions a TLS certificate automatically

3. **HTTPS is automatic**:
   - Cloudflare provides Universal SSL (free TLS certificate)
   - HTTP to HTTPS redirect is enabled by default at the CDN edge
   - No manual certificate management required

### HTTPS Redirect (Requirement 7.3)

All HTTP requests are automatically redirected to HTTPS by Cloudflare's edge network. This is enabled by default for all Pages projects and requires no configuration. To verify:

- Go to Cloudflare Dashboard > your domain > SSL/TLS > Edge Certificates
- Ensure "Always Use HTTPS" is toggled ON (it is by default)

### TLS Certificates (Requirement 7.4)

Cloudflare handles TLS certificate provisioning and renewal automatically:
- **Universal SSL**: Free, covers `*.yourdomain.com` and `yourdomain.com`
- **Certificate renewal**: Automatic, no manual intervention needed
- **Minimum TLS version**: Configurable in SSL/TLS settings (recommend TLS 1.2+)

## Environment Variables Reference

### Pages Project (wrangler.toml)

| Variable | Description | Default |
|----------|-------------|---------|
| `DB` (D1 binding) | Cloudflare D1 database binding | Required |

### Aggregation Worker (workers/aggregator/wrangler.toml)

| Variable | Description | Default |
|----------|-------------|---------|
| `DB` (D1 binding) | Cloudflare D1 database binding | Required |
| `REFRESH_INTERVAL_MINUTES` | How often to refresh data (min: 15) | `60` |
| `SOURCE_DEVPOST_ENABLED` | Enable Devpost source adapter | `true` |
| `SOURCE_MLH_ENABLED` | Enable MLH source adapter | `true` |
| `SOURCE_HACKEREARTH_ENABLED` | Enable HackerEarth source adapter | `true` |

## Project Structure

```
.
├── src/
│   ├── pages/              # Astro pages (SSR) and API routes
│   │   ├── api/            # REST API endpoints
│   │   ├── hackathons/     # Listing and detail pages
│   │   └── index.astro     # Landing page
│   ├── components/         # React islands and Astro components
│   ├── lib/
│   │   ├── db/             # Drizzle schema, queries, migrations
│   │   ├── search.ts       # FTS5 search engine
│   │   ├── filters.ts      # Filter composition logic
│   │   ├── slug.ts         # URL slug generation
│   │   └── types.ts        # Shared TypeScript types
│   ├── layouts/            # Astro layout templates
│   └── styles/             # Global CSS (Tailwind)
├── workers/
│   └── aggregator/         # Cron-triggered aggregation worker
│       ├── adapters/       # Source adapters (Devpost, MLH, HackerEarth)
│       ├── normalizer.ts   # Data normalization
│       ├── deduplicator.ts # Deduplication engine
│       └── index.ts        # Worker entry point
├── tests/
│   ├── unit/               # Unit tests (Vitest)
│   ├── property/           # Property-based tests (fast-check)
│   ├── integration/        # Integration tests
│   └── e2e/                # End-to-end tests (Playwright)
├── wrangler.toml           # Pages project config
├── astro.config.mjs        # Astro configuration
├── vitest.config.ts        # Vitest configuration
└── package.json
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge Network                   │
├─────────────────────────┬───────────────────────────────────┤
│   Cloudflare Pages      │       Cloudflare Workers          │
│                         │                                   │
│  ┌─────────────────┐   │   ┌─────────────────────────┐     │
│  │  Static Assets  │   │   │  Aggregation Worker     │     │
│  │  (HTML/CSS/JS)  │   │   │  (Cron: every 60min)    │     │
│  └─────────────────┘   │   └──────────┬──────────────┘     │
│                         │              │                     │
│  ┌─────────────────┐   │              │  fetch/scrape       │
│  │ Pages Functions  │   │              ▼                     │
│  │ (Astro SSR +    │   │   ┌──────────────────────┐        │
│  │  API routes)    │   │   │  External Sources     │        │
│  └────────┬────────┘   │   │  - Devpost            │        │
│           │             │   │  - MLH                │        │
│           │ query       │   │  - HackerEarth        │        │
│           ▼             │   └──────────────────────┘        │
│  ┌─────────────────────────────────────────────────┐        │
│  │              Cloudflare D1                       │        │
│  │         (SQLite + FTS5 at the edge)             │        │
│  └─────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Cloudflare Free Tier

This project is designed to run entirely within Cloudflare's free tier:

| Resource | Free Limit | Expected Usage |
|----------|-----------|----------------|
| Worker requests/day | 100,000 | ~1,000-5,000 |
| D1 rows read/day | 5,000,000 | ~50,000 |
| D1 rows written/day | 100,000 | ~500 |
| D1 storage | 5 GB | ~50 MB |
| Static assets | Unlimited | Unlimited |
| Cron triggers | 5 per Worker | 1 |

## License

ISC
