# 14 · Phase 2 report

Masters — projects, ULBs, files, documents, people. What was built, what was verified, and the three defects found on the way.

---

## 1 · What Phase 2 enforces

**Money is never a float, and never becomes one on the wire.** `Decimal(14,2)` in the database, and serialised as a *string* — `"120.00"`, not `120`. A project cost of ₹120.45 cr passed through JSON as a number is a rounding error waiting for an audit to find it. The web layer formats strings and never parses them back except to draw the drawdown bar.

**Exactly one lead ULB per project, enforced by the database.** A partial unique index (`ulbs_one_lead_per_project … WHERE is_lead`) makes a second lead impossible rather than unlikely. The service catches the resulting `P2002` and returns *"City 1 Municipal Corporation is already the lead ULB on this project. Change that one first."* — a constraint name in a toast is not an error message.

**A document needs a name, a type and a file. All three.** This was asked for by name, and it is the rule most likely to be softened by whoever is in a hurry. It is enforced in three places that cannot drift: `NOT NULL` in the database, `documentInput` in `packages/shared`, and the form. The form's job is only to save a round trip — deleting the client check changes nothing about what the server accepts.

**A file arrives in two steps, and is unusable in between.** `POST /files` reserves a row and returns where the bytes go; `PUT /files/:id/content` sends them; only then does `uploaded_at` get set. A document may only point at a file that has bytes. With S3 the first step becomes a presigned URL and the bytes never touch the API — the client's flow is identical, which is why it is shaped this way rather than as one multipart POST.

**Only the officer who reserved a file may fill it, and only once.** Otherwise a reservation id is a free write handle to anyone who guesses it.

**Out of scope reads as absent.** `GET /projects/<an id you may not see>` returns 404 with `NOT_FOUND`, not 403. Verified in the browser against a real session.

---

## 2 · Decisions worth recording

**The storage driver is an interface, not S3.** `LocalStorage` writes under a folder; `MemoryStorage` backs the tests; a future `S3Storage` implements the same three methods. Nothing above `FilesService` knows which is in use. The local driver still re-resolves every key against its root and refuses anything that escapes — the keys are server-generated, but one traversal would let an upload land anywhere the process can write, so it is treated as hostile anyway.

**25 MB cap and an allow-list of MIME types.** What a government office actually attaches: PDF, images, Office documents, CSV, plain text. Anything executable is absent on purpose. An extension proves nothing, so Phase 7 checks the declared type against the bytes; until then the cap and the list are the whole defence, and this is stated rather than implied.

**Tab state lives in the URL.** `?tab=ulb` means a link to a tab is a link to that tab — which matters the first time someone pastes "the ULB list for Project 1" into an email.

**People are scoped, not global.** The officer list contains the people on your projects plus everyone who sees every project. It is the list the Phase 5 share picker will draw from, which is why you cannot share with someone you cannot see.

---

## 3 · The demo, walked in a browser

Signed in as Officer C (PDMC), against the real seeded database:

| Step | Result |
|---|---|
| Projects list | 3 project cards, each with cost, sanctioned, drawn and a drawdown bar |
| Project info tab | ₹ 120.00 cr / ₹ 90.00 cr / ₹ 78.00 cr, 87% drawn |
| Officers tab | 4 officers with designation, role on the project and contact |
| ULB info tab | 2 ULBs, **exactly one** marked LEAD |
| Documents tab | 3 on file, each downloadable |
| **Upload with no name** | **refused** — form: *"Give the document a name someone else would recognise."*; server, past the form: `422 VALIDATION_FAILED`, field `name` |
| Upload with a name | accepted, listed, and the file downloads as `application/pdf` |
| People | 14 officers, 9 designations, departments with headcounts |
| Check another officer's access | refused — PDMC does not hold `manage_access` |
| Check your own access | 17 capabilities shown, held **and not held**, with the 3 projects |
| `GET /projects/<unknown id>` | `404 NOT_FOUND` |

Screens captured at each step. The tab URL changed with the tab in every case.

---

## 4 · Three defects, found and fixed

**1 · One failing list emptied all three People tabs.** The page fetched users, designations and departments with `Promise.all`, so a single failure left every tab blank with one message at the top and no way to tell which list had broken. Each list now loads on its own: the two that worked still render, and only the third says what went wrong. Found when a stub query failed against a column name — which is exactly the shape a real outage takes.

**2 · The breadcrumb stopped at the section.** On a project detail page it read *Masters / Projects* — the same as the list it came from. The trail now carries the record's name (*Masters / Projects / Project 1*), supplied by the screen that has already loaded it through a small context. Phase 3 has several detail screens that need the same thing, which is why it is a context rather than a prop.

**3 · "Officer C is a PDMC."** Two designations in the master data (CDMA, PDMC) have their acronym as their name, because the source documents never expanded them. The effective-access summary now reads *"holds the PDMC designation"*, which is correct for an acronym and for "Mission Director" alike. **Open question for the client:** what do CDMA and PDMC stand for? They are the only two designations with no readable title, and every screen that names a designation will show the acronym until they are given one.

Also tidied: the sidebar prefetched every not-yet-built route on every page load, and they all resolve to the same catch-all — `prefetch={false}` on planned links removes a request per link.

---

## 5 · Verified

| Check | Result |
|---|---|
| `pnpm test` | 80 tests — 9 DTO, 71 API |
| Document rules | 18 tests: name, type and file each mandatory; whitespace-only name refused; file ownership and upload-completion checked |
| Storage | 8 tests: object keys, round-trip, traversal refused |
| Money | fixed(2) strings end to end; sanctioned ≥ drawn and date order refused at the DTO |
| Migrations | `20260912000000_auth` and `20260913000000_files` applied to a real PostgreSQL |
| `pnpm assert:invariants` | both database invariants still hold |
| `pnpm assert:seed` | 21 figures still match the prototype |
| Browser walkthrough | §3 above, including the refused upload |
| `pnpm lint`, `pnpm typecheck`, both builds | clean |

**Not verified here, and worth knowing.** As in Phase 1, this environment cannot download Prisma's engine binary, so the API process could not be run against the real database and the SQL Prisma generates for these services is unexercised. The browser walkthrough ran against a throwaway stub speaking the same contract over the real seeded data — and where a *rule* was being demonstrated rather than merely served, the stub imported the shipped code itself: `documentInput` and `reserveFileDto` from `packages/shared`, `newObjectKey` and `LocalStorage` from the files module. The 422 in §3 is the real validator refusing the real request. On the target machine the engine downloads normally and `pnpm dev:all` runs the real API.

---

## 6 · Carried into Phase 3

- **P2-06 is partial.** The people, designation and department *lists* ship, and so does the effective-access checker. The write paths — create a user, map projects, retire a department, edit the capability matrix — exist on the API with tests, but have no screen yet. They are small forms and belong with the Phase 6 admin screens rather than blocking meetings.
- **CDMA and PDMC need real names** (§4.3).
- **Fonts are fetched from Google.** Fine on a connected machine; a government network that blocks it silently falls back to the system stack. Self-hosting the two families is a ten-minute job and belongs in Phase 7 hardening.
- **Type is checked by declaration, not by content.** Phase 7 verifies the bytes.

---

## 7 · Next

Phase 3 · Meetings, tickets P3-01 to P3-10 — the meeting entity and both state machines, the instant flow, the four-step scheduled wizard, carry-forward, the agenda freeze, attendance, and the meeting detail with its five tabs. It ends with: run both journeys end to end, from creation to attendance.
