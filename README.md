# Check-In with SIGGY

Between-session reflection, mood tracking, journaling, crisis planning, and clinician notes, using the supplied Brightside design. This package repairs the Brightside Angular upload; the unbranded Angular archive had the same application logic. Brand colors, typography, and the supplied component reference were retained.

## Explore the interactive demo

Explore SIGGY with fictional sample data and no Supabase account or API keys:

1. Open [SafeSpaceGT1/CheckinSiggy](https://github.com/SafeSpaceGT1/CheckinSiggy) and choose **Code → Codespaces → Create codespace on main**.
2. Wait for the first setup to finish. The included Codespaces configuration installs Node.js 24 dependencies, builds the app, and starts its preview automatically.
3. Open the browser preview and click **Explore demo**. If the browser does not open automatically, choose the **Ports** tab and click the globe beside **SIGGY demo / 4173**.

You can also add `?demo=1` to the app's preview URL to enter the demo directly. An existing Codespace needs **Codespaces: Rebuild Container** from the command palette after pulling this configuration. To start a preview manually, run `npm ci`, `npm run build`, then `npm run preview` and open port **4173**.

If an older Codespace stops at Angular's usage-data question, click in its terminal, type `N`, and press Enter to let setup continue. Angular analytics is disabled in the project configuration so new checkouts skip this prompt.

Use the demo banner's **Explore demo pages** selector to try mood check-ins, journals and sentiment summaries, wellness goals, breathing and grounding activities, the calendar, crisis planning, and client records and notes in clinician view. Choosing clinician tools switches the view automatically. Demo changes and preferences stay in this browser tab across reloads. Use **Reset demo** to restore the sample records or **Exit demo** to leave the demo.

Demo records and changes are local to the preview. They do not create a real account, modify a live database, send email, or call an AI provider. Sentiment and insights are computed locally from the demo records. Exiting the demo preserves real account sessions and preferences. Use fictional information while exploring.

## Before your therapy session

Open **Therapy sessions** from Home, Calendar, or the navigation menu. SIGGY asks **“Is there anything you would like your therapist to know?”** during the 24 hours before a scheduled session while the app is open. A client can also open **Write note** at any time before that session starts.

- **Save private draft** keeps the note visible only to the client. **Share with therapist** makes it available to the connected therapist. Notes accept up to 2,000 characters.
- **Not now** postpones the automatic prompt for one hour. Cancelled and past sessions do not prompt. Rescheduling uses the new appointment time.
- Therapists see shared notes beside the appointment and can select **Mark reviewed**. Editing a shared note clears its reviewed status. Version checks prevent stale edits and marking a newer, unseen note as reviewed.
- Notes are not monitored for urgent help. Sharing does not guarantee that a therapist has read a note before the session.

For a quick demonstration, choose **Therapy sessions → Try pre-session check-in**, save or share a sample note, then choose **Therapist session review** in the demo menu. The demo includes upcoming sessions and previously reviewed sample notes; it never contacts a real therapist.

For real accounts, the therapist opens **Therapy sessions → Manage connections**, selects an existing client record, and creates an invitation. Give that client the private, single-use code through an existing trusted channel. It expires after seven days. The client previews the therapist's name and explicitly accepts before either account can add sessions. A display-role selection alone never grants access to another account's records. Use only a code received directly from your therapist; a displayed name is not professional-credential verification.

Both linked participants can add or reschedule an appointment they have already agreed on. Dates are stored as instants and displayed in each participant's local time zone. This is SIGGY's session calendar; it does not book or synchronize appointments in an external EHR. Disconnecting prevents further sharing, removes therapist access through that connection, and cancels future sessions. The client's saved notes remain available. A clinician cannot delete a connected client record through the client list and thereby erase the client's session history.

The automatic prompt requires SIGGY to be open; background push, email, and SMS reminders are not implemented. Live sharing requires the backend migration described below. The interactive demo works without a backend.

## Run locally

Use Node.js 24 and npm. From this directory:

```sh
npm ci
npm start
```

Open `http://localhost:8080` and choose **Explore demo** to use the sample app. Without backend configuration, real account sign-in remains disabled and the app displays **Setup required**. Demo mode works independently of the live backend.

Configure a Supabase project using either the two public values in `src/environments/environment.ts`, or environment variables before starting/building:

```sh
export SIGGY_SUPABASE_URL='https://YOUR-PROJECT.supabase.co'
export SIGGY_SUPABASE_ANON_KEY='YOUR-PUBLISHABLE-OR-ANON-KEY'
npm start
```

The build script validates the pair and generates the browser configuration. With neither variable set, it preserves the existing environment file. Do not commit deployment-specific generated configuration. Server secret/service-role keys and AI keys must never go in this file or browser variables. `.env` files are not read automatically.

## Backend setup

For a new project, apply all SQL files under `supabase/migrations` in filename order. With the Supabase CLI installed and authenticated, link the intended project and use `supabase db push`. Configure Auth's site URL and allowed redirect URLs for the real app origin. Email/password registration is implemented; email confirmation must be verified against your project's email settings.

For an existing SIGGY backend, also apply `20260911120000_therapy_sessions.sql`. It adds connections, private invitations, appointments, private/shared notes, and authenticated RPCs with row-level access rules. Browser clients cannot write directly to these tables or read invitation tokens. No real Supabase database was changed while developing this feature.

Deploy the four functions with the Supabase CLI:

```sh
supabase functions deploy analyze-sentiment
supabase functions deploy analyze-journal-history
supabase functions deploy siggy-insight
supabase functions deploy delete-account
```

The functions require server-side `SUPABASE_URL` and `SUPABASE_ANON_KEY`; account deletion also requires `SUPABASE_SERVICE_ROLE_KEY`. Hosted Supabase normally provides these. Keep the function JWT verification configuration enabled. Each handler additionally verifies the caller with Auth and scopes database operations to that caller.

Optional AI integration uses the existing Lovable gateway or Gemini provider. Configure `LOVABLE_API_KEY` or `GEMINI_API_KEY` as server-side function secrets. No provider key was supplied or used during validation. Missing/unavailable AI is handled with local journal sentiment or statistics-only insights, as applicable. AI output is untrusted and is not a diagnosis or clinical risk assessment.

### Existing database upgrade

Keep the five original migrations and apply the additive migration `20260911090000_owner_integrity.sql`. It adds matching-owner foreign keys, narrows table privileges, and creates the atomic goal completion RPC. The frontend now expects that RPC.

A pre-existing mismatched parent/owner record makes the new constraints fail. Investigate and correct those records with the project owner before retrying; the migration deliberately does not delete or reassign data to make the upgrade pass. Apply the migration in a staging copy before production. No live database was modified by this repair.

## Checks

```sh
npx playwright install --with-deps chromium
npm run test:config
npm run test:db
npm run test:functions
npm run typecheck:functions
npm run test:ci -- --code-coverage
npm run build
SIGGY_E2E_UNCONFIGURED=1 npm run test:e2e
```

The database suite runs all migrations against PGlite, an embedded PostgreSQL engine. It supplies an Auth schema and synthetic users, then tests real SQL, RLS, sharing, ownership, goal toggles, and deletion cascades. This does not substitute for the hosted Supabase integration check.

For authenticated browser workflows, build with the synthetic test configuration and run Playwright:

```sh
SIGGY_SUPABASE_URL=https://siggy-e2e.supabase.co \
SIGGY_SUPABASE_ANON_KEY=sb_publishable_siggy-e2e-not-a-real-key \
npm run build
npm run test:e2e
```

Every API call in these tests is intercepted. Never deploy this synthetic build. Clear the test configuration before preparing your actual deployment. `npm run preview` serves `dist/siggy/browser` on `http://127.0.0.1:4173`, including SPA route fallback; it is a local preview server.

If a local Chromium executable is already installed, tests accept `CHROME_BIN` for Karma and `SIGGY_CHROMIUM_EXECUTABLE` for Playwright. CI installs the Playwright-managed browser instead.

## GitHub

`.github/workflows/ci.yml` runs on pushes, pull requests, and manual dispatch. It installs locked dependencies; tests configuration, database rules, Edge Function handlers, Angular services/components, and browser workflows; builds both configuration states; and checks dependency advisories. All test accounts and provider responses are synthetic. The workflow requires no live Supabase or AI secrets and does not deploy.

The source repository is [SafeSpaceGT1/CheckinSiggy](https://github.com/SafeSpaceGT1/CheckinSiggy). Open [SIGGY checks in GitHub Actions](https://github.com/SafeSpaceGT1/CheckinSiggy/actions/workflows/ci.yml) to see verification results for each commit. The app lives at the repository root, so the workflow runs automatically when changes are pushed.

## Behavior and boundaries

- Angular 21, PrimeNG 21, TypeScript 5.9; route components and PDF code remain lazy loaded.
- Home reuses the mood/journal queries. Mood history and exports use pagination instead of silently truncating at the API's row cap.
- Session startup errors settle; stale startup responses cannot restore a signed-out account. Cached account data is cleared when the account changes.
- Failed reads show retry states. Save handlers validate input and reject repeated submissions while pending. Journals get an immediate local sentiment fallback when the AI function is unavailable.
- Theme, sound, and haptics are device preferences. The clinician-view preference and reminder delivery markers are scoped to the account on that device.
- The clinician selector changes the interface only; it does not verify a professional credential or link a therapist to another app user's health data. Clinician records remain owned by `therapist_id`.
- Reminders run while SIGGY is open; background push/email scheduling is not implemented. Notification permission is browser/device dependent.
- Shared crisis plans are accessible to anyone who possesses a valid share token until its expiry or revocation.
- Crisis support is not continuously monitored. The existing urgent-help disclosures remain visible. This code review does not certify clinical effectiveness, HIPAA compliance, or accreditation readiness.

See `TEST_REPORT.md` for the actual verification results and deployment limits.
