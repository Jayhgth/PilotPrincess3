# Pilot Princess

Pilot Princess is an open-source desktop academic planner for California high-school students. It is available for macOS Apple silicon and Windows x64/ARM64.

**Downloads:** WIP

It combines four-year plans, transcript import, diploma progress, GPA scenarios, community-college catalogs, associate-degree tracking, and a local Codex-powered Pilot assistant. Pilot can read and change the same student-owned data as the interface, with validation, receipts, real-time refresh, and undo.

The app uses Electron, Astro, React, Supabase, and the official Codex app-server. Supabase provides authentication, private storage, Postgres, and row-level security. Pilot uses the Codex account connected on the student's computer; no OpenAI API key is required.

## Forking

Fork the repository on GitHub, then:

```sh
git clone https://github.com/YOUR_USERNAME/PilotPrincess3.git
cd PilotPrincess3
pnpm install
cp .env.example .env
pnpm dev:desktop
```

Use your own Supabase project and apply `supabase/migrations/` in filename order. Enable the email, Google, and GitHub sign-in methods you want to support. Pilot automatically uses the Codex account already authenticated on the computer; if no account is present, run `codex login` before testing Pilot.

Useful commands:

```sh
pnpm check
pnpm build:desktop:mac
pnpm build:desktop:win
pnpm dev:marketing
```

The download website is in `apps/marketing` and can be deployed independently to Vercel. Tagged releases are built by GitHub Actions; setup and release instructions are in the deployment reference below.

## Archived web app

`archive/web-app` is a self-contained snapshot of commit `dbdfc9a`, the final web application before the desktop conversion. It keeps the original Vercel adapter, deployment configuration, source, tests, migrations, and lockfile. Run its commands from that directory; it is intentionally excluded from the active pnpm workspace and does not share dependencies or build output with the desktop app.

## References

- [Product and design](./docs/PRODUCT_DESIGN.md)
- [Academic rules](./docs/ACADEMIC_RULES.md)
- [Pilot transparency](./docs/AI_TRANSPARENCY.md)
- [Deploy, update, and test](./docs/DEPLOYMENT.md)

School support is labeled discovery, partial, or complete. An unsupported school never borrows another school's catalog, diploma rules, or planning profile. Do not commit credentials or private student data.
