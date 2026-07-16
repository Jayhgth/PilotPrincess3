# Pilot Princess

Pilot Princess is an open-source academic planning web app for California high-school students.

**Hosted app:** WIP

Students can:

- build and revise a four-year course plan;
- import a transcript and track diploma progress;
- compare weighted GPA scenarios;
- explore community-college courses and associate-degree progress; and
- ask Pilot to make validated, reversible changes to their account and plan.

School support is shown in the app as discovery, partial, or complete. A school without verified local data never inherits another school's catalog, graduation rules, or course sequence. SMCCD degree planning currently covers Cañada College, College of San Mateo, and Skyline College.

## Project

The web app uses Astro, React, Supabase, TypeScript, Vitest, Playwright, and the Codex SDK. Supabase provides authentication, private storage, row-level security, and the application database.

Important references:

- [Product and design](./docs/PRODUCT_DESIGN.md)
- [Academic rules](./docs/ACADEMIC_RULES.md)
- [Pilot transparency](./docs/AI_TRANSPARENCY.md)

## Forking

Fork the repository on GitHub, clone your fork, and install the development dependencies:

```sh
git clone https://github.com/YOUR_USERNAME/PilotPrincess3.git
cd PilotPrincess3
pnpm install
cp .env.example .env
pnpm dev
```

Use your own Supabase project and credentials. Apply the migrations in `supabase/migrations/` before testing authenticated features. Google sign-in and Pilot require their respective server-side credentials; never commit secrets.

Useful checks:

```sh
pnpm check
pnpm test:e2e
pnpm check:release
```

The focused suite is intentionally small. The main live Pilot test covers a progress-aware diploma and associate-degree schedule through read, proposal, validated apply, and undo.

## Data

School identity comes from CDE, UC A–G course evidence from UCOP, and community-college identity from CCCCO. Local catalogs, diploma policies, mappings, and planning profiles retain their source and review status.

Do not commit credentials, generated task reports, or private student data.
