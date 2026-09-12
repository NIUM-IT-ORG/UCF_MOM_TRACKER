# 15 · Phases 3 and 4 report

Meetings, minutes, actions, clarifications and the MoM — the working core of the product. Built as one pass because they are one loop: a meeting you cannot minute is not a feature.

---

## 1 · What these phases enforce

**Two journeys, one ladder.** A scheduled review goes PLANNED → AGENDA → INVITEES → INVITEE_INPUTS → CONFIRMED → HELD → MINUTED → CLOSED. An instant meeting goes COMPOSED → LIVE → HELD → MINUTED → CLOSED. From HELD onwards they are identical, and the reference makes the difference permanent: `UCF/P1/RM-04` is a review, `UCF/P1/IM-01` is instant, and every register, header and export says so — because a reader has to know no agenda was circulated.

**A transition not in the table does not exist.** Both meeting machines, both item machines and the MoM machine are written as tables of `{from, event, to}`. Each has a test asserting every listed transition works *and* that the table has no rows beyond the ones the document lists. A meeting cannot be cancelled after it was held; a MoM cannot be approved without being submitted; an action cannot be confirmed without somebody first reporting it done.

**Planning stages only move forward.** A coordinator who fixes the venue after adding invitees has not undone anything — dropping the meeting back to AGENDA would silently re-open invitee contributions. `advanceMonotonic` raises the stage to the floor an action implies and never lowers it. The first version of this threw an error instead, which would have refused a perfectly legitimate edit; a test caught it before it shipped.

**Confirmation circulates and freezes.** Confirming is the Meeting Coordinator's own decision — there is no approval gate on a meeting — but it does gate completeness: an agenda, an invitee and a chairperson, refused by name when missing. After it, `POST /agenda-items` returns `409 AGENDA_FROZEN`.

**Nobody confirms their own work.** Enforced in `items/confirmation.policy.ts`, not in the UI. Joint ownership means every named officer is equally accountable, so every one of them is equally disqualified from signing it off.

**Circulation is the hinge.** On `sign`, in one transaction: every item for that meeting gets `activatedAt`, `ACT-01` fires per responsible officer, `MOM-05` goes to the invitees, and the meeting closes. All four or none. A MoM that says the officers were told while the register shows nothing outstanding is the worst failure this product could have.

**A circulated MoM is immutable.** There is no transition out of SIGNED — that absence *is* the rule. A correction is a new row pointing at the original with `correctsMomId`, so the document people read, filed and acted on stays exactly as it was.

**The minutes lock from submission until the MoM comes back.** Once an approver is reading a document, the text underneath it must not move. Returning it unlocks them, which is what makes the remark answerable.

---

## 2 · Decisions worth recording

**One template for the document.** `mom.template.ts` is the only thing in the product that knows what a MoM looks like. The preview, the print view and any future server-side renderer all emit that one string, following `prototype/Sample-MoM-draft.pdf` — seven sections, the header block, the DRAFT watermark, the signature block.

**Served as print-ready HTML rather than a server-rendered PDF.** `docs/03` asks for Puppeteer. That is deferred, and the reason is the deployment: this runs on the client's own Windows machine with no Docker, and bundling a headless Chromium is a ~300 MB download and a per-platform install to do something the browser already does. The API serves the document at `/meetings/:id/mom.html` carrying `@page { size: A4 }` and the watermark; the screen offers "Save as PDF". Because there is one template, adding Puppeteer in Phase 5 for e-mail attachments changes nothing about the document itself. **P3-08 (agenda PDF) and P4-07 are marked partial for this reason, not because the layout is missing.**

**A small hand-written sanitiser, not a library.** The allow-list is fixed by `docs/03`: `p h3 b i u mark ol ul li br a[href]`. A heavier editor would produce output the server then silently discards, which teaches officers that the application loses their work. So the toolbar offers exactly what survives, and the sanitiser is 120 readable lines with 21 tests — including `javascript:` and `data:` hrefs, unclosed `<script>`, Word's conditional comments, and idempotency.

**The wizard creates the meeting at step 1.** The agenda, the carry candidates and the invitee list all need an id to attach to, and a coordinator who closes the tab at step 3 should not lose the first two steps. The meeting sits at its planning stage until confirmed — which is what those stages are for.

**Notifications are emitted, not sent.** `NotificationsService.emit` writes one `notifications` row per event, inside the same transaction as the change. Nothing is dispatched; that is P5-01. It is built now because a state machine that shipped with no emit call would make Phase 5 a hunt through two modules for transitions that were missed — and a missed one is invisible, since nothing fails when a message is simply never sent. Rows in a table can be counted.

---

## 3 · Three defects, found and fixed

**1 · Nothing could be raised at all.** `docs/05` §4 says an item "has no status transitions and no notifications" before activation, and the service read that as *store a null status*. The `items_shape` CHECK constraint requires an ACTION to carry an `action_status` and a CLARIFICATION a `clarification_status` — always — so **every single item creation was rejected by the database**. Inertness is `activatedAt`, never a null status; the item gets its opening status at creation and `activatedAt` alone decides whether it is live. Found by running the journey, not by reading the code, and `items/inertness.spec.ts` now reads both the migration and the service so the two cannot drift apart again.

**2 · A corrigendum would have overwritten the document it corrects.** `moms.meeting_id` was `UNIQUE`, which made "a correction creates a new MoM row" impossible — the only way to satisfy the schema was to mutate the circulated row. Migration `20260914000000_mom_versions` replaces that with `UNIQUE (meeting_id, version)`, adds the missing foreign key on `corrects_mom_id`, and the register now shows the version in force (`correctedBy: { none: {} }`) rather than one row per version.

**3 · The planning stage could refuse a legitimate edit.** See `advanceMonotonic` in §1 — caught by its own test.

Also fixed on the way: the breadcrumb read *Meetings / Meetings / …* where a nav group and its item share a name; the sidebar linked to `/minutes` with no page behind it (there is now a real index of meetings awaiting write-up, oldest first, because a fortnight-late minute is the one that matters); and the signature block printed *Meeting Coordinator / Meeting Coordinator*.

---

## 4 · The two demos, walked in a browser

Against the real seeded database, as three different officers.

**P3 — both journeys, creation to attendance**

| Step | Result |
|---|---|
| Type chooser | two journeys, each explaining itself; the one you lack the capability for is disabled, not hidden |
| Instant: compose → launch | stage **LIVE**, marked **Instant** |
| Instant: end | stage **HELD** |
| Scheduled step 1 | reference issued — `UCF/P1/RM-12` |
| Scheduled step 2 | 2 agenda points; 18 carry candidates offered |
| **Carrying a second time with no new date** | **`422 REVISED_DUE_REQUIRED`**, naming the item; accepted once a date was given |
| Scheduled step 3 | 5 invitees, chairperson locked in |
| Scheduled step 4 | **CONFIRMED**, agenda circulated |
| Adding to the agenda afterwards | **`409 AGENDA_FROZEN`** |
| Mark held → attendance | 5 officers marked; stage **MINUTED** |

**P4 — minute it, raise four items, and run the MoM to circulation**

| Step | Result |
|---|---|
| Minutes | saved, sanitised on write |
| Three actions + one clarification | recorded; all four show **Not yet active** |
| Editing the minutes after submission | **`409 MINUTES_LOCKED`** |
| Generate → submit | **Awaiting approval** |
| Mission Director returns it | remark mandatory; minutes unlocked |
| Coordinator resubmits | **version 2** |
| Mission Director approves | **Approved** |
| Items *before* circulation | 4 total, **0 active** |
| PDMC uploads the signed PDF and circulates | — |
| Items *after* circulation | 4 total, **4 active** · 3 actions In Progress · 1 clarification Open · meeting **CLOSED** |
| Regenerating the circulated MoM | **`409 MOM_IMMUTABLE`** |
| The document | all seven sections, the joint-ownership note, no watermark once signed |

Screens captured at every step.

---

## 5 · Verified

| Check | Result |
|---|---|
| `pnpm test` | **203 tests** — 9 DTO, 194 API |
| Meeting machines | every listed transition, plus an assertion that the tables contain nothing else |
| Item machines | both vocabularies, the nightly `DELAYED` job, `daysOverdue`, self-confirmation |
| MoM machine | the full journey including return → resubmit → approve → sign, and the absence of any exit from SIGNED |
| Sanitiser | 21 tests, including the XSS and Word-paste cases |
| Inertness | the migration and the service checked against each other |
| Migration `20260914000000_mom_versions` | applied to a real PostgreSQL; `assert:invariants` and `assert:seed` still pass |
| Browser walkthrough | §4 above, clean |
| `pnpm lint`, `pnpm typecheck`, both builds | clean |

**Not verified here, and worth knowing.** The Prisma engine still cannot be downloaded in this environment, so the API process could not be run and the SQL Prisma generates for these services is unexercised. This was tested properly this time rather than assumed: Prisma 5.22 **refuses** an `adapter` together with `--no-engine`, and without `--no-engine` it requires the native binary — so the driver-adapter route is a dead end on this version, and nobody should spend another afternoon on it. `scripts/prisma-generate.mjs` now falls back to generating types only when the engine host is unreachable, so a blocked network no longer fails `pnpm install` with a bare 403; it prints what does and does not work. On the target machine the engine downloads normally and `pnpm dev:all` runs the real API.

The walkthrough ran against a throwaway stub speaking the same contract over the real seeded data — and where a *rule* was demonstrated the stub imported the shipped code: the sanitiser, the MoM template, the meeting and item reference generators, the MoM state machine, and the zod DTOs. The 422s and 409s in §4 are the real validators refusing real requests.

---

## 6 · Carried into Phase 5

- **The 27 events are emitted, none are delivered.** Phase 5 adds the worker, the adapters, the templates and the dispatch log. The emit calls and their recipient lists are already in place.
- **Nine scheduled jobs are not wired.** `shouldMarkDelayed` and `daysOverdue` exist and are tested; the cron that calls them is P5-08.
- **The signed-scan check (P4-08) compares what it can.** It refuses a non-PDF and a file whose bytes never arrived, and records the action count for the comparison. The page-count check needs the rendered draft, which arrives with the renderer.
- **Still open with the client:** priority routing (`confirmation.policy.ts` is written so the matrix drops into one function), the email and WhatsApp provider, and the expansion of CDMA and PDMC.

---

## 7 · Next

Phase 5 · Notifications, email and WhatsApp — P5-01 to P5-12. It ends with: circulate a MoM and show the dispatch log filling, including a deliberately failing number. **It cannot be finished without the provider decision** — the adapters and all 27 events can be built and tested against `Console` and `Failing`, but nothing reaches a real inbox until a provider is named.
