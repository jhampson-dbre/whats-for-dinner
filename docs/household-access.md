# Household access setup

## Local Supabase development

Install a [Docker-compatible container runtime](https://supabase.com/docs/guides/local-development), then run `npm ci`, `npx supabase start`, and `npx supabase db reset --local` from the repository root. The CLI and `supabase/config.toml` are committed with the timestamped migrations so a fresh local database can be rebuilt from source. Local Auth requires email confirmation; use the local mail testing UI printed by `supabase start`. Run `npx supabase stop` when finished. The local stack and its default credentials are for development only.

On a machine without a container runtime, `npx vitest run tests/households.test.ts tests/household-migration.test.ts` exercises the API and migration in embedded PostgreSQL, but does not exercise Supabase Auth or PostgREST integration. Do not use `supabase db push` or `supabase db reset --linked` as a substitute for local verification.

After local reset passes, preview migrations for the intended remote project with `npx supabase db push --dry-run`; apply them with `npx supabase db push` only during an authorized deployment. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` as server-only Vercel environment variables. Never use a `VITE_` prefix for the secret key. Enable email confirmation in Supabase Auth and keep anonymous sign-in disabled. Sign-up can stay open: a verified account has no household until it redeems an invitation.

An operator with the server secret can issue a creator link locally:

```powershell
$env:SUPABASE_URL = 'https://PROJECT.supabase.co'
$env:SUPABASE_SECRET_KEY = '<server secret>'
node scripts/invite-creator.mjs creator@example.com https://APP.example.com/
```

Deliver the printed link privately to the named address. It expires after 24 hours and can be accepted once. The link stores its token in the URL fragment; do not paste it into logs or support tickets. The recipient signs in with Supabase Auth, verifies that same email, and sends the token to `POST /api/households` with `Authorization: Bearer <access token>` and JSON `{"action":"accept","token":"<fragment token>"}`. Acceptance creates an empty household and its creator membership atomically. The current frontend does not implement this flow yet.

An active creator can `POST` `{"action":"invite","householdId":"<uuid>","email":"member@example.com"}` to issue a member token, then deliver it privately. The same `accept` action joins that household. `GET /api/households` lists the caller's live memberships; `GET /api/households?householdId=<uuid>` lists current members. A creator can `POST` `{"action":"revoke-member","householdId":"<uuid>","userId":"<uuid>"}` or `{"action":"revoke-invite","householdId":"<uuid>","inviteId":"<uuid>"}`. Member revocation also invalidates pending invitations for that member's email.

The migration enables RLS and removes `anon` and `authenticated` table privileges and function execution. Only the server secret can use these tables or functions. Every API request verifies the Supabase access token with Auth; household actions check current membership. Future record endpoints must repeat that live check before each read or write and must not expose the server secret to the browser.
