# 13 · Phase 1 report

Identity and access. What was built, what was verified, and the four defects found on the way.

---

## The demo

Sign in as four officers and the application is four different things:

| Officer | Designation | Capabilities | Navigation | Scope |
|---|---|---|---|---|
| Officer D | Meeting Coordinator | 12 of 17 | Access control locked | Project 1 only |
| Officer A | Mission Director | 5 of 17 | Minutes editor and Access control locked | Every project |
| Officer L | System Administrator | 4 of 17 | Minutes editor locked | Every project |
| Officer H | ULB Nodal Officer | 4 of 17 | Minutes editor and Access control locked | Project 1 only |

Password for every seeded officer: `ucf-demo-2026`, at `<name>@example.gov`. **Development only** — it is the same for everyone precisely so nobody mistakes it for a real credential, and `pnpm db:seed` truncates every table before it runs.

The one-time code is logged by the API and returned in the response outside production, so the demo needs no mail server. Phase 5 delivers it by email and WhatsApp.

---

## What Phase 1 actually enforces

**Capabilities are read from the database on every request**, never from the token. The access token carries an id and a session id and nothing else. Removing `approve_mom` from a designation revokes it for everyone holding that designation on their *next request* — no logout, no waiting for a token to expire. That is what `docs/04-RBAC.md` §8 requires, and it is covered by a test.

**Scope failures return 404, never 403.** An officer must not be able to discover that a meeting exists on a project they cannot see by probing ids and reading the status code.

**Nothing is stored that would be useful to steal.** Passwords are Argon2id at the current OWASP parameters. Refresh tokens are opaque random bytes, stored only as SHA-256 digests — a database leak hands nobody a working session, and a test asserts the token never appears in the row.

**Refresh rotation with reuse detection.** Each refresh issues a new token and marks the old one rotated. A valid client never presents one twice, so a replay means the token leaked, and the whole session family is revoked and audited rather than just that one row.

**Failed sign-ins are counted against the address, not the account**, so attempts on an address that does not exist are counted too and the response cannot be used to enumerate accounts. Five failures in fifteen minutes locks the account, and the lock is audited. Unknown addresses are verified against a decoy hash so every path costs the same.

---

## Four defects, found and fixed

**1 · The middleware blocked sign-in entirely.** Its matcher covered `/api`, so the sign-in request itself was redirected to the sign-in page. Nobody could ever have signed in. Found by walking the flow in a browser rather than trusting the code to be right.

**2 · The session provider ignored the server.** `useState(initialUser)` takes its prop once; the provider lives in the root layout and is not remounted by client-side navigation. After signing in, the top bar sat there saying "Sign in" while `/auth/me` happily returned 200.

**3 · The capability matrix had two sources of truth.** The seed was taking designation capabilities from the prototype's fixture rather than from `packages/shared`, so `share_object` existed in the code and was granted to nobody. The symptom would have been a button that never appeared for anyone, with nothing in any log to explain it. The seed now reads the documented matrix, and `pnpm assert:seed` compares the database against it on every CI run.

**4 · The scope card printed internal ids.** `SessionUser` carried only `projectIds`, so the screen had nothing else to show. It now carries the named projects too.

---

## Verified

| Check | Result |
|---|---|
| `pnpm test` | 54 tests — 9 DTO, 45 API |
| Capability matrix, both ways | every capability × every designation, allowed and denied — `capability.guard.spec.ts` |
| Scope helpers | including the `{ in: [] }` vs `{}` distinction that would otherwise show every project to an officer mapped to none |
| Auth state machine | lockout, single-use codes, OTP attempt limit, rotation, replay detection, digest-only storage |
| Browser walkthrough | four designations, four different navigations; anonymous deep link round-trips through `?next=`; wrong password refused with the shared message |
| `pnpm lint`, `pnpm typecheck`, both builds | clean |

**Not verified here, and worth knowing.** This environment cannot download Prisma's engine binary, so the API process could not be run against the real database — the SQL Prisma generates for these services is unexercised. The browser walkthrough ran against a throwaway stub that spoke the same contract over the real seeded data, which is what makes the web half trustworthy. The first `pnpm test` and the first CI run on a machine with the engine will exercise the rest; CI's `database` job already does exactly that.

---

## Shape to follow in Phase 2

- Guard a route with `@UseGuards(JwtAuthGuard, CapabilityGuard)` and `@RequireCapability('…')`. Capability only — row-level questions belong in the service.
- Take the caller with `@CurrentUser()`, and pass it to the repository so the finder can scope. Never filter in a controller.
- Throw `AppError` with a documented code; the filter maps it to the documented status.
- Mark mutations `@Audited({ objectType, event })`.
- Add a screen's route to `apps/web/src/lib/roadmap.ts` and delete its entry when the real page lands.

---

## Next

Phase 2 · Masters, tickets P2-01 to P2-06. It ends with: create a project, add two ULBs, upload a sanction order, and fail to upload one without a name.
