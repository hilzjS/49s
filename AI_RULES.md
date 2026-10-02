# AI Rules

## Tech Stack

- React 19 with TypeScript for all frontend code
- Vite as the frontend build tool (artifacts/uk49s-scraper, artifacts/mockup-sandbox)
- Express.js for the API server (artifacts/api-server)
- pnpm workspaces for monorepo management
- Tailwind CSS v4 for styling
- Radix UI / shadcn/ui for component primitives
- TanStack Query v5 for server state
- Lucide React for icons
- Zod for runtime validation
- Custom lib packages: api-client-react, api-zod, db

## Prediction Engine

- There is exactly **one** engine: `lib/db/src/schema/base44-engine.ts`, with four
  weights (`hot`, `overdue`, `halfLife`, `power`). The old SuperHybrid, Hybrid and
  SuperHybrid v3 engines, and the engine showdown, were removed — do not reintroduce them.
- UK 49s predictions are a 4-number main line + 1 booster.
- The optimizer is the 392-candidate walk-forward tuner (`findChampionAsync`). It
  locks a champion per draw type as the active `uk49s_model_configs` row (weights
  mapped onto `weight_frequency`/`weight_recency`/`weight_hot_cold`/`weight_gap_analysis`,
  tuner stats in `description` JSON).
- Walk-forward evaluation must never train on the target draw or later.

## Library Rules

- UI components: use shadcn/ui primitives from `@/components/ui/*`
- Icons: use lucide-react
- Server state / data fetching: use TanStack Query (React Query)
- Forms: use react-hook-form with Zod resolvers
- Validation: use Zod schemas
- API client: use lib/api-client-react
- Database: use lib/db
- Styling: Tailwind CSS utility classes
- Routing: React Router (keep routes in src/App.tsx)
