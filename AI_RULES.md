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
