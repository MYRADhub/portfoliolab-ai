# PortfolioLab AI

Product description: `description.md`. Plan: `ROADMAP.md`. Decisions: `docs/adr`.

## Local setup

Requires Node 22, pnpm, Docker, and uv (for `services/analytics`).

```sh
cp .env.example .env
pnpm install
pnpm db:up          # Postgres on localhost:54330
pnpm db:migrate
pnpm db:seed        # development fixtures only
pnpm data:sp500     # load the committed S&P 500 snapshot (add --refresh to re-fetch)
pnpm data:ingest --provider fixture   # synthetic prices; use --provider tiingo with a key, --limit N to stage
pnpm --filter @portfolio-lab/web dev
```

The analytics service: `cd services/analytics && uv sync && uv run uvicorn analytics.main:app --reload`.

## Checks

`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` (DB tests need `DATABASE_URL` pointing at a running Postgres; they create and drop their own databases).

## Layout

- `apps/web` Next.js app and API route handlers
- `packages/db` Drizzle schema, migrations, seed
- `packages/shared` shared types and env validation
- `services/analytics` Python FastAPI service
