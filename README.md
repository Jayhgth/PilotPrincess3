# Pilot Princess

Pilot Princess is a student-first academic planning workspace for California public and charter high-school students. It combines official school evidence, four-year course planning, transcript import, diploma progress, GPA scenarios, nearby community-college discovery, SMCCD degree planning, and an optional Pilot Assistant.

Schools remain searchable statewide even when their academic data is incomplete. The app labels each school as discovery-only, partially supported, or fully supported and never substitutes another school's catalog or graduation rules.

## Stack

- Astro 7 SSR shell with React 19 workspaces
- Supabase Auth, Postgres, RLS, RPCs, and private Storage
- Official Codex SDK for the opt-in Pilot Assistant and image-only transcript fallback
- TypeScript, Zod, Vitest, and Playwright

## Local setup

Requirements: Node 24+, pnpm 11, Supabase CLI, and a migrated Supabase project.

```sh
pnpm install
cp .env.example .env
supabase login
supabase link --project-ref your-project-ref
supabase db push --linked
pnpm dev
```

Set the public Supabase URL and publishable/anon key in `.env`. AI credentials remain server-only. Google OAuth additionally requires a Google web client configured in Supabase; set the local client ID and secret through the non-public variables in `.env.example`. Production must allow the exact `/auth/callback` and `/reset-password` URLs.

New users are created through Supabase Auth, provisioned into a neutral onboarding workspace by `ensure_current_user_workspace_v1`, and receive access only through per-user RLS. Email/password and Google use PKCE callback handling. Before production, configure custom SMTP, email confirmation, CAPTCHA, separate OAuth clients per environment, HTTPS, monitoring, backups, and retention.

## Architecture

- `src/lib/app-capabilities.ts` is the shared capability registry for Pilot tool routing, mutation risk, workspace invalidation, and receipts.
- `src/lib/workspace-bootstrap.ts`, `src/lib/workspace-refresh.ts`, and `get_workspace_snapshot_v1` own initial and targeted authenticated reads.
- `src/lib/workspace-commands.ts` and database RPCs own atomic multi-row course and transcript operations.
- `src/components/PlanningWorkspace.tsx` coordinates the authenticated shell; feature workspaces, catalogs, settings, and Pilot load on demand.
- `src/lib/planning.ts`, `src/lib/smccd.ts`, `src/lib/prerequisites/`, and `src/lib/transcript.ts` contain deterministic academic rules.
- `src/server/codex.ts`, `src/server/ai-tools.ts`, `src/server/ai-knowledge.ts`, and `src/server/ai-memory.ts` own Pilot conversation orchestration without granting arbitrary database access.
- `supabase/migrations/` is the schema, RLS, auth, storage, and RPC source of truth.
- `scripts/` contains official school, college, catalog, and validation pipelines.

Pilot retains the same app-wide capability surface on every page. Each message receives only the relevant capability subset, selected from the request rather than the active tab. Exact low-risk writes are validated deterministically; ambiguous or destructive writes use the independent reviewer. Every applied write runs normal RLS and academic rules, stores a private inverse, and produces an undoable receipt. RAG guidance and explicit lightweight student memory remain separate from canonical student records.

## Verification

```sh
pnpm check                # typecheck and 61 focused unit/component cases
pnpm build
pnpm performance:budget   # chunk and total client-JS budgets
pnpm test:e2e             # authenticated, statewide-school, and live Pilot flows
pnpm check:release        # complete release gate
```

The complete suite is capped at 70 cases: 61 unit/component cases and 9 browser/live workflows. Run focused checks during development. Pilot schedule changes must still demonstrate a live read, exact proposal, validated apply, and undo. Browser tests create isolated student accounts and must confirm that ordinary users do not receive administrator access.

## Data maintenance

California schools come from CDE, UC A–G identity and course evidence from UCOP, and community-college identity from CCCCO. Local district and charter sources supply diploma rules, current catalogs, mappings, and school-specific planning profiles. Source year, URL, confidence, and review status are retained.

```sh
pnpm schools:sync
pnpm schools:academics --selected
pnpm schools:academics --all
pnpm schools:audit
pnpm providers:sync
pnpm uc-ag:sync-schools
pnpm uc-ag:sync-courses

pnpm smccd:scrape
pnpm smccd:ge-scrape
pnpm smccd:requirements-migration
pnpm smccd:validate
```

The current college degree engine supports the separate 2025-26 CSM, Skyline, and Cañada patterns. Other California community-college districts use the shared provider/district architecture but require their own reviewed catalog, degree, GE, prerequisite, and enrollment-policy adapters before equivalent planning claims are enabled.

## Durable references

- [Product and design](./docs/PRODUCT_DESIGN.md)
- [Academic rules](./docs/ACADEMIC_RULES.md)
- [Pilot transparency](./docs/AI_TRANSPARENCY.md)

Do not add task logs, completion reports, implementation-status files, or committed secrets.
