# Setting up on Windows, without Docker

You said Node is installed and Docker is not, so this is the path that needs
neither Docker Desktop nor WSL.

## The short way

Double-click **`SETUP.bat`** in the repository root.

It checks Node, enables pnpm, finds (or offers to install) PostgreSQL, creates
the role and database, writes a `.env` with freshly generated secrets, installs
everything, applies the migration, loads the demo data, proves the two database
guarantees hold, and offers to start the application. It is safe to run more
than once — each step is skipped if it has already been done.

After that, **`RUN.bat`** starts it, and opens <http://localhost:3000> for you.

The only thing it will ask you for is the **postgres superuser password** — the
one set when PostgreSQL was installed.

If it stops with an error, it says exactly what to fix and changes nothing else.
The rest of this document is the same thing done by hand.

---

## About the database

Setup prefers a **properly installed PostgreSQL** and uses it whenever it finds
one. If there isn't one, it falls back to a **project-local PostgreSQL**: the
binaries come from the npm registry into `var/localdb`, the data lives in
`var/pgdata`, and it listens on port 5433 so it can never collide with a real
PostgreSQL on 5432.

Nothing is installed system-wide, no Windows service is created, and no
administrator rights are needed. Deleting the `var` folder undoes all of it.

The bundled database runs as a child of `pnpm dev:all`, so it starts and stops
with the application - `RUN.bat` picks the right command for you. It is a
development convenience only; a server runs a properly installed PostgreSQL
(see `docs/10-DEPLOYMENT.md`). To move onto one later, install PostgreSQL,
create the role and database as below, point `DATABASE_URL` at port 5432, and
run `pnpm db:deploy && pnpm db:seed`.

---

## The long way - two installs, five commands

Everything the compose file would have provided has a local equivalent, chosen
so that nothing extra has to be running:

| Compose service | What runs instead in development |
|---|---|
| PostgreSQL | PostgreSQL 16 installed natively — the one thing you do install |
| Redis | The queue runs **in process** (`QUEUE_DRIVER=memory`) |
| MinIO | Files go to `var/files` on disk (`STORAGE_DRIVER=local`) |
| Mailpit | Email is written to `var/mail` as `.eml` files you can double-click |

`docker-compose.yml` stays in the repository. The day you want the full set —
or when you move to a server — switch the four environment variables and it
works, with no code change. That is why they are adapters.

---

## 1 · Install PostgreSQL 16

Download the Windows installer from
<https://www.postgresql.org/download/windows/> and run it. During setup:

- Keep the default port **5432**.
- Set a password for the `postgres` superuser and **write it down**.
- The Stack Builder step at the end can be skipped.

Then open **SQL Shell (psql)** from the Start menu, press Enter through the
prompts, type the password, and run:

```sql
CREATE ROLE ucf LOGIN PASSWORD 'ucf_dev_only';
CREATE DATABASE mom_tracker OWNER ucf;
```

If you would rather use the `postgres` superuser, skip that and change
`DATABASE_URL` in step 3 instead.

## 2 · Get pnpm

`SETUP.bat` handles this for you and tries three routes in turn, so one of them
works whatever your machine allows. By hand, in order of preference:

```powershell
corepack enable            # ships with Node; needs admin if Node is in Program Files
corepack prepare pnpm@10 --activate

npm install -g pnpm@10     # if Corepack could not write its shims

npx --yes pnpm@10 --version  # needs no install and no elevation at all
```

If you end up on the `npx` route, put `npx --yes pnpm@10` wherever this
document says `pnpm`. It is slower on the first call and identical afterwards.

## 3 · Configure

From the repository root, in PowerShell:

```powershell
Copy-Item .env.example .env
```

Open `.env` and change two things:

- `DATABASE_URL` — only if you used the `postgres` superuser rather than the
  `ucf` role above.
- The two `JWT_*` secrets. Any long random string will do in development:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## 4 · Install, migrate, seed

```powershell
pnpm install
pnpm db:deploy          # applies prisma/migrations
pnpm db:seed            # loads the prototype's dataset
pnpm assert:invariants   # proves the two database guarantees hold
```

`pnpm db:seed` should print 3 projects · 14 users · 7 meetings · 19 items, and
`pnpm assert:invariants` should print eleven ticks. If either disagrees,
something is wrong with the database, not with your code — stop there.

## 5 · Run

```powershell
pnpm dev
```

- Web: <http://localhost:3000>
- API: <http://localhost:4000/api/v1/health>

The dashboard shows a live check of all three services, so you can see at a
glance whether the API and the database are answering.

---

## Useful commands

```powershell
pnpm dev                 # api :4000 and web :3000 together
pnpm --filter @mom/api dev
pnpm --filter @mom/web dev

pnpm test                # unit + api tests
pnpm lint                # must be clean; --max-warnings 0
pnpm typecheck

pnpm db:migrate          # create a new migration after editing schema.prisma
pnpm db:reset            # drop, re-migrate, re-seed
pnpm db:studio           # browse the data
pnpm assert:invariants   # re-check the two database guarantees
```

## When something does not work

**`prisma generate` fails on install, or `pnpm db:deploy` cannot start.**
Prisma downloads its engine binaries from `binaries.prisma.sh`, and some
corporate networks block that host. If you are behind a proxy, set `HTTPS_PROXY`
and run `pnpm install` again — nothing else in the stack needs that host.

If it stays blocked, the migrations are plain SQL and do not need the engine:

```powershell
pnpm db:apply      # applies prisma/migrations directly, same bookkeeping
pnpm db:seed
```

That gets you a correct database. The API still needs the query engine to
*run*, so the host has to be reachable before `pnpm dev` will work — but you
can get everything else in place while that is sorted out.

**`pnpm db:deploy` says the database does not exist.** The `CREATE DATABASE`
step in part 1 did not run, or `DATABASE_URL` points somewhere else. Check the
database name at the end of the URL.

**"pnpm is still not on PATH".** Corepack writes its shims into the Node
installation folder, which needs administrator rights when Node is under
Program Files. Setup now falls through to `npm install -g pnpm@10` and then to
`npx`, so this should no longer stop you — but if you want a real install,
run `npm install -g pnpm@10` in a new window.

**Port 5432 is already in use.** An older PostgreSQL is running as a service.
Either use it, or change the new one's port and update `DATABASE_URL`.

**The dashboard says the API is not reachable.** It is a separate process —
`pnpm dev` starts both, but if you started only the web app, start the API too.

## Moving off the development profile

Later, on a server:

```env
QUEUE_DRIVER=bullmq
REDIS_URL=redis://…
STORAGE_DRIVER=s3
EMAIL_PROVIDER=smtp
```

The application refuses to start in production with `QUEUE_DRIVER=memory` or
`EMAIL_PROVIDER=console`, so neither can be left on by accident.
