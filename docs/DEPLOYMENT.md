# Deploy, update, and test

Pilot Princess ships as a desktop app. Supabase hosts authentication, private storage, and Postgres; Pilot runs locally through the bundled official Codex app-server. It reads the existing Codex account with the app-server `account/read` method and uses the standard Codex home and OS credential store, matching t3code. It never starts a separate browser login. No OpenAI API key is used.

## One-time setup

1. Create a Supabase project and apply `supabase/migrations/` in filename order.
2. Copy `.env.example` to `.env` and set `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`. `.env` is ignored by Git.
3. In Supabase Auth, enable the desired email, Google, and GitHub providers.
4. Give each OAuth provider `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback` as its callback URL.
5. Add `http://127.0.0.1:47831/auth/callback` and `http://127.0.0.1:47831/reset-password` to Supabase's redirect allow list.

Provider client secrets stay in Supabase. Never put service-role keys, OAuth client secrets, database passwords, Codex credentials, or student data in GitHub or the desktop bundle.

## GitHub Actions

`.github/workflows/release-desktop.yml` runs for tags beginning with `v`. It publishes macOS ARM64 plus Windows x64 and ARM64 installers as a public, non-draft GitHub Release. The repository must be public for anonymous downloads from the marketing site; a private repository redirects visitors through GitHub authentication.

Repository Actions secrets:

| Name | Value |
| --- | --- |
| `PUBLIC_SUPABASE_URL` | Production Supabase project URL |
| `PUBLIC_SUPABASE_ANON_KEY` | Production publishable/anon key |
| `CSC_LINK` | Base64-encoded Developer ID Application `.p12` certificate |
| `CSC_KEY_PASSWORD` | Password used when exporting that `.p12` certificate |
| `APPLE_API_KEY` | Complete contents of an App Store Connect API `.p8` key |
| `APPLE_API_KEY_ID` | App Store Connect API key ID |
| `APPLE_API_ISSUER` | App Store Connect API issuer ID |

`GITHUB_TOKEN` is supplied automatically by GitHub Actions. No additional GitHub or OpenAI token is required. Confirm secrets with `gh secret list`; values cannot be read back after saving.

Stable macOS releases require all five Apple secrets. The workflow signs with the Developer ID certificate, submits the app to Apple notarization, and verifies the stapled ticket with `codesign`, `stapler`, and Gatekeeper before it can be uploaded. It intentionally fails instead of publishing a broken unsigned DMG. Local development does not require these credentials. Windows signing remains a separate future release-hardening step.

To configure macOS distribution:

1. Join the Apple Developer Program and create a **Developer ID Application** certificate.
2. Export the certificate and private key from Keychain Access as a password-protected `.p12`. Base64-encode the file and save the result as `CSC_LINK`; save its export password as `CSC_KEY_PASSWORD`.
3. Create an App Store Connect API key and save the complete `.p8` file contents as `APPLE_API_KEY`, plus its key ID and issuer ID as `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`.
4. Add the five values under **GitHub repository settings → Secrets and variables → Actions**, then publish a new version tag.

Do not upload the certificate, private key, `.p8`, or their decoded contents to the repository.

## Run and test locally

```sh
pnpm install
pnpm dev:desktop
pnpm check
pnpm deployment:check
pnpm build:marketing
pnpm build:desktop:mac   # macOS ARM64
pnpm build:desktop:win   # Windows x64 and ARM64
```

Before a release, use an isolated QA account to verify sign-in, transcript import, plans, undo, Pilot read → apply → live refresh → undo, move/resize, quit/relaunch persistence, and account isolation. Remove the QA records afterward.

Pilot settings must show `Authenticated · <account type>` and the account email before a Pilot test can run. If it shows `Not authenticated`, authenticate Codex outside Pilot with the Codex app or `codex login`, then refresh the status. Pilot does not own, copy, or replace that login.

## Release an update

1. Change the version in `package.json`.
2. Run `pnpm check` and the relevant desktop build locally.
3. Commit and push the change.
4. Create and push the matching tag, for example `git tag v0.2.0 && git push origin v0.2.0`.
5. Check the **Release desktop apps** workflow and its GitHub Release artifacts.

Confirm that the release contains `Pilot-Princess-mac-arm64.dmg`, `Pilot-Princess-win-x64.exe`, and `Pilot-Princess-win-arm64.exe`; those stable names are the marketing site's direct download targets.

Installed apps check GitHub Releases and install a downloaded update when the app quits.

## Download website

Create a Vercel project with `apps/marketing` as its Root Directory. The static site needs no runtime secrets. Add the final domain later and update the site metadata when it is known.
