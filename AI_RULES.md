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

## Prediction Engines

- The live/default engine is Base44: `lib/db/src/schema/base44-engine.ts`, four
  weights (`hot`, `overdue`, `halfLife`, `power`). The old SuperHybrid v1/Hybrid/v3
  *feature-weight* engines and the engine showdown were removed.
- **SuperHybrid is a separate, selectable strategy**: `lib/db/src/schema/superhybrid-engine.ts`.
  It predicts each session from the latest completed draw of the **opposite**
  session (LUNCH→TEA, TEA→LUNCH) and adds a Flip-Flop transition feature. It reuses
  the Base44 primitives and has its own eight weights.
- SuperHybrid config is its own `uk49s_model_configs` row (`strategy = "superhybrid"`,
  status `archived`) so it is never selected as the active model and never
  auto-optimised. The active model (e.g. `vv1790135925577`) must not be modified.
- UK 49s predictions are a 4-number main line + 1 booster; the booster is scored
  separately and never mixed into the main line.
- The Base44 optimizer is the 392-candidate walk-forward tuner (`findChampionAsync`);
  it locks a champion per draw type as the active `uk49s_model_configs` row.
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
