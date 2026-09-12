# MoM_Tracker

**UCF Meeting & Action Item Tracker** — after every meeting, each commitment is written down with named officers and a date, and tracked until a senior officer agrees it is done.

**Phases 0 to 4 are complete — the product does its job end to end.** Call a meeting (instantly, or
as a four-step scheduled review with an agenda and items carried forward from last time), hold it,
record attendance, write the minutes, raise actions and clarifications, then generate the MoM and
take it through approval, signature and circulation. Circulating is what makes the commitments
live. Notifications, the dashboard and the reports arrive in Phases 5 and 6.

Sign in with any seeded officer at `<name>@example.gov`, password `ucf-demo-2026` (development
only). The sign-in page lists them; picking one fills the form.

---

## Get it running

**On Windows: double-click `SETUP.bat`, then `RUN.bat`.** Setup checks what is installed, prepares
the database, installs everything, migrates, seeds, verifies, and offers to start. It is safe to
run more than once.

It uses an installed PostgreSQL if it finds one, and asks for the postgres superuser password.
If there isn't one, it fetches a **project-local PostgreSQL** from the npm registry into `var/` —
no installer, no Windows service, no administrator rights, and deleting `var/` undoes it.

By hand, or on any other platform:

```bash
cp .env.example .env      # then set DATABASE_URL and the two JWT secrets
pnpm install
pnpm db:deploy            # apply migrations
pnpm db:seed              # load the prototype's dataset
pnpm assert:invariants     # prove the two database guarantees
pnpm dev                  # api :4000 · web :3000
```

Full steps, and what to do when something does not work: **[`SETUP-WINDOWS.md`](SETUP-WINDOWS.md)**.
If Docker is available, `pnpm db:up` brings up PostgreSQL, Redis, MinIO and Mailpit instead of
installing PostgreSQL natively.

---

## Layout

```
MoM_Tracker/
├─ SETUP.bat · RUN.bat     double-click setup, then double-click run
├─ CLAUDE.md               the build contract — read it first
├─ SETUP-WINDOWS.md        local setup without Docker
├─ docs/                   the specification, 00 to 12
├─ prototype/              the clickable reference build ← the source of truth
├─ prisma/                 schema, migrations, seed, extracted fixture
├─ packages/shared/        enums, capabilities, zod DTOs — used by both apps
├─ apps/api/               NestJS
├─ apps/web/               Next.js
├─ scripts/                the two CI assertions, and the Windows setup scripts
└─ .github/workflows/ci.yml
```

---

## Open the prototype first

`prototype/UCF-MoM-Tracker-Interactive.html` — double-click it. No server, no build. Sign in as any officer; the chip in the top bar switches designation and the whole application changes with it.

It is the **visual and behavioural source of truth**. When a document and the prototype disagree, the prototype wins on layout and interaction; the documents win on rules, data and permissions. Twenty minutes in it will save an hour of specification.

Worth walking specifically: both meeting journeys (instant and scheduled) · the five tabs on a held meeting · the minutes editor, switching an entry between Action and Clarification · the MoM cycle from generate to circulate, then the register lighting up · the Share dialog anywhere it appears.

---

## Version control

This is already a Git repository with Phase 0 committed on `main`. To put it on a remote:

```bash
git remote add origin <your repository URL>
git push -u origin main
```

Conventions, so history stays readable and tickets stay traceable:

- **Branches** — `feat/P1-03-capability-guard`, `fix/P4-07-watermark`. One ticket per branch.
- **Commits** — `type(scope): summary`, with the ticket id as the scope where there is one:
  `feat(P3-04): agenda carry-forward`. Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`.
- **`main` stays green.** Merge only when `pnpm lint`, `pnpm typecheck` and `pnpm test` all pass —
  the CI workflow runs exactly those, plus the migration, the seed and the two assertions.
- **Never commit `.env`.** It is ignored; `.env.example` is the one that is tracked.
- `pnpm-lock.yaml` **is** committed — CI installs with `--frozen-lockfile`.

---

## Commands

```bash
pnpm dev                  # both apps
pnpm dev:all              # both apps plus the project-local database
pnpm build                # both apps
pnpm test                 # unit + api
pnpm lint                 # --max-warnings 0, must be clean
pnpm typecheck

pnpm db:deploy            # apply existing migrations
pnpm db:apply             # same, without Prisma's engine (blocked-CDN fallback)
pnpm db:local             # run the project-local database on its own
pnpm db:migrate           # create a migration after editing schema.prisma
pnpm db:seed              # reload the prototype dataset
pnpm db:reset             # drop, migrate, seed
pnpm db:studio            # browse the data

pnpm assert:invariants     # append-only audit + the items shape constraint
pnpm assert:seed          # the seeded figures must equal the prototype's
```

---

## The five rules most likely to be built the ordinary way instead of the right way

1. **Circulation activates items.** An action created while minuting is *inert* — not assigned, not clocked, not notified. It goes live when the signed MoM is circulated, and every dashboard count, reminder and escalation filters on `activated_at IS NOT NULL`. The seed proves the difference: 7 actions are "In Progress" unscoped, but the dashboard shows **4**, because six items have not been circulated yet.
2. **Access is computed, never stored per user.** Capability comes from the designation, data scope from the project mapping, and the filter belongs in the repository — not the controller, not the UI. A missing scope filter is a security bug.
3. **One MoM template, one output.** The screen preview and the PDF come from the same HTML. Two renderers is how the printed minutes and the on-screen minutes end up disagreeing about what was decided.
4. **Joint ownership is real.** Several officers on an action are equally accountable. There is no primary-owner column, and adding one later is a scope change.
5. **Nobody confirms their own work.** Under Review exists for exactly this, and the guard is server-side.

---

## Two decisions the client has deferred

Do not invent answers. Build so they drop in.

| # | Decision | Build this instead |
|---|---|---|
| 1 | **Priority routing** — which action priority requires whose confirmation | `resolveConfirmers(action)` returning a single default confirmer, with the matrix's future home marked. Priority is captured and displayed; it does not route. |
| 2 | **Email provider and hosting target** | The adapter interface only. `Console` and `Smtp` ship; assume nothing managed. |

---

## Working with Claude Code

Each phase is one prompt. For the next one:

> Read CLAUDE.md and docs/15-PHASE-3-4-REPORT.md, then implement Phase 5 of docs/08-BUILD-PLAN.md — tickets P5-01 through P5-12. Work one ticket at a time. Do not start Phase 6 while any Phase 5 test fails.

`docs/15-PHASE-3-4-REPORT.md` records what the meeting and MoM machines enforce, the three defects found while building them, and what Phase 5 inherits — the 27 events are already emitted, and draining them is the work. `docs/13-PHASE-1-REPORT.md` has the shape every guarded route follows.

---

## Out of scope for v1

CSV bulk upload with row-wise validation · bilingual (Telugu) interface · native mobile app · offline field capture · digital signature (DSC / eSign) · calendar (ICS) integration · departmental SSO.

CSV bulk upload was Phase 5 of the original brief and is the strongest v1.1 candidate. The import buttons exist in the prototype and are deliberately inert.
