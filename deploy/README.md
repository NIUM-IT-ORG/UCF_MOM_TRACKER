# Deploying the UCF Meeting & Action Item Tracker on Ubuntu

One Ubuntu 24.04 server on AWS. PostgreSQL and Redis on the same box; uploaded
documents and nightly backups in S3; nginx in front with a Let's Encrypt
certificate; the API and the web app as ordinary systemd services.

Nothing here needs Docker, and nothing needs a managed AWS service beyond S3.

> **What is actually running, as of 24 September 2026.** The server was not
> built the way sections 1-4 below describe. There is no `mom` service user and
> no `/opt/mom/app`; the checkout is at **`/var/www/ucfmom`** with its `.env`
> beside it, and the two processes run under **pm2** as `ucfmom-api` and
> `ucfmom-web` rather than as systemd units. `deploy/deploy.sh` matches that,
> and defaults to it. **Releasing a change is section 5 and nothing else** —
> the provisioning steps describe a machine that was never provisioned this
> way, and following them produces `sudo: user 'mom' not found`.
>
> They are left in place because they are a coherent alternative and the next
> environment may well be built that way. Read them as a proposal, not as a
> description.

| | |
|---|---|
| Region | Asia Pacific (Hyderabad), `ap-south-2` |
| Instance | `t4g.medium` — 2 vCPU, 4 GB, ARM |
| OS | Ubuntu Server 24.04 LTS (arm64) |
| Domain | `ucfmom.nium.org.in` |
| Database | PostgreSQL 16, on the instance, listening on localhost only |
| Queue | Redis, on the instance, localhost only |
| Documents | S3, `files/` prefix |
| Backups | S3, `backups/` prefix, nightly at 01:30 IST |

---

## Before you start

You need three things:

1. **An AWS account** with permission to create an EC2 instance, an S3 bucket
   and an IAM role.
2. **Control of the DNS for `nium.org.in`** — one A record.
3. **A copy of this repository** the server can fetch. A private GitHub repo
   with a deploy key is the usual answer; a `git bundle` copied up with `scp`
   also works and is fine for a first deployment.

---

## 1. The bucket

From your own machine, with admin credentials:

```bash
BUCKET=ucf-mom-files REGION=ap-south-2 ./deploy/aws/bucket-setup.sh
```

Bucket names are globally unique, so `ucf-mom-files` may be taken — use
something like `ucf-mom-files-tg` and keep the name for step 3.

This creates the bucket and then locks it down: public access blocked
entirely, encryption on by default, versioning on, TLS required by policy, and
lifecycle rules that move backups to infrequent-access after 30 days, expire
them after a year, and expire old versions after 90 days.

## 2. The instance

Launch in `ap-south-2`:

- **AMI** Ubuntu Server 24.04 LTS, **arm64** (it must match `t4g`)
- **Type** `t4g.medium`
- **Storage** 40 GB gp3
- **Key pair** one you keep, or none if you will use Session Manager
- **Security group** inbound: 443 and 80 from anywhere; 22 from your office
  address only — not from `0.0.0.0/0`
- **Elastic IP** allocate one and associate it, so the address survives a stop

Then the IAM role:

```bash
# Substitute your bucket name into the policy first.
sed 's/ucf-mom-files/YOUR-BUCKET/' deploy/aws/instance-role-policy.json > /tmp/policy.json
```

Create a role for **EC2**, attach that policy as an inline policy, and attach
the role to the instance. Do not create an IAM user and paste its keys into
the environment file — a role rotates its own credentials, and there is nothing
to leak.

The policy's shape is deliberate: the application can read, write and delete
under `files/`, because officers delete documents; under `backups/` it can only
**write**. An instance that is compromised cannot destroy the backup history.

## 3. Provision

SSH in, fetch the repository to `/opt/mom/app`, and run the provisioner once:

```bash
sudo apt-get update && sudo apt-get install -y git
sudo install -d -o ubuntu -g ubuntu /opt/mom
git clone <your repo url> /opt/mom/app
cd /opt/mom/app

sudo DOMAIN=ucfmom.nium.org.in CERT_EMAIL=you@nium.org.in ./deploy/provision.sh
```

It installs Node 20, PostgreSQL 16, Redis, nginx, certbot and the AWS CLI;
creates the `mom` service account, the database and a 2 GB swap file; tunes
PostgreSQL for a 4 GB box; writes the systemd units and the nginx site; locks
the firewall to 22/80/443; and requests the certificate.

**Point DNS at the Elastic IP before this step**, or the certificate request
fails. Everything else still completes — rerun the script once DNS resolves.

It is idempotent. Rerunning it after a change to a unit or the nginx site is
the intended way to apply that change.

## 4. Fill in the environment

```bash
sudo nano /etc/mom/mom.env
```

Three values are left as `REPLACE_ME`:

- `DATABASE_URL` — the password is in `/etc/mom/db-password`
- `S3_BUCKET` — from step 1
- `BACKUP_S3_URI` — `s3://YOUR-BUCKET/backups`

The signing secrets were generated for you. Leave `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY` unset — credentials come from the instance role.

Then put the state emblem where the MoM renderer will find it:

```bash
sudo -u mom cp assets/branding/emblem.png /opt/mom/var/branding/emblem.png
```

Without it the masthead prints with no crest. That is deliberate — a
government document gets the real seal or none, never a placeholder.

## 5. Deploy

Releasing a change on the live server is one command:

```bash
cd /var/www/ucfmom && ./deploy/deploy.sh --pull
```

Install, build, migrate, restart both pm2 processes, then curl each until it
answers. If either does not come up it prints that process's last 40 lines and
exits non-zero.

The order is **build → migrate → restart**, so the old version keeps serving
while the new one is built, a failed build is not an outage, and the window in
which running code is older than the schema beneath it is as short as it can
be.

Without `--pull` it deploys whatever is already checked out.

### Local modifications on the server

`--pull` uses `git pull --rebase --autostash`. It does **not** hard-reset.

That is deliberate: this server carries a deliberate uncommitted change, and a
reset would delete it silently — the first anybody would know is a behaviour
quietly reverting in production. Autostash is the stash / pull / pop sequence
done by hand, without the step somebody forgets.

If the rebase conflicts, the deployment stops before touching anything, and
the local change is still in the stash:

```bash
git stash list && git stash pop
```

Anything carried this way should be an entry in `config/env.ts` and
`.env.example` instead, so it is visible, reviewable and switchable. A change
that exists only in a server's working tree is one failed `pop` away from
disappearing, and nothing in the repository records that it was ever there.

### Overriding the defaults

Every path and process name is an environment variable, because the next
environment will differ again:

```bash
APP_DIR=/srv/ucf ENV_FILE=/etc/ucf.env API_PROC=api WEB_PROC=web ./deploy/deploy.sh --pull
```

## 6. Seed the first administrator

Only for a brand-new database:

```bash
cd /opt/mom/app
sudo -u mom bash -c 'set -a; . /etc/mom/mom.env; set +a; corepack pnpm db:seed'
```

The seed refuses to run if the database already holds real work — it counts
rows that are not seed rows and stands down. That guard exists because the
seed truncates.

## 7. Check it

```bash
systemctl status mom-api mom-web nginx postgresql redis-server
systemctl list-timers mom-backup
curl -s https://ucfmom.nium.org.in/api/v1/health
```

Then open `https://ucfmom.nium.org.in`, sign in, and upload one document.
That last step is the one that proves the IAM role, the bucket policy and the
S3 driver all agree with each other — and it is the step people skip.

---

## Backups

The nightly job runs at 01:30 IST. It dumps the database, **reads the dump
back to check it is not truncated**, uploads it to S3, and keeps the last three
locally.

```bash
sudo -u mom /opt/mom/app/deploy/backup.sh     # run one now
journalctl -u mom-backup -n 50                # what happened last night
aws s3 ls s3://YOUR-BUCKET/backups/ --recursive | tail
```

### The drill

Once a quarter, restore into a scratch database. This touches nothing live:

```bash
cd /opt/mom/app
sudo -u mom bash -c 'set -a; . /etc/mom/mom.env; set +a; ./deploy/restore.sh --latest --into mom_restore_drill'
```

A backup nobody has restored is a hope, not a backup.

### A real restore

```bash
sudo -u mom bash -c 'set -a; . /etc/mom/mom.env; set +a; ./deploy/restore.sh --latest'
```

It stops the application, makes you type the database name, restores in a
single transaction so a failure leaves nothing half-applied, and restarts.
Afterwards run `prisma migrate deploy` in case the code is newer than the dump.

### What this does and does not cover

| | |
|---|---|
| Covers | The instance dying, the volume failing, someone deleting data, a bad migration |
| Exposure | **Up to 24 hours of work.** The dump is nightly; there is no point-in-time recovery |
| Does not cover | Losing the S3 bucket itself — enable cross-region replication if that matters |

That 24-hour window is the price of running PostgreSQL on the instance instead
of RDS. It is a deliberate trade, and it is the one thing on this page worth
revisiting if the programme grows: RDS would reduce it to about five minutes
for roughly ₹1,700 a month.

---

## Day to day

These are for the server as it actually runs — pm2 at `/var/www/ucfmom`.

```bash
pm2 status                                  # both processes, at a glance
pm2 logs ucfmom-api                         # API logs, live
pm2 logs ucfmom-web --lines 100 --nostream  # web app, last 100
sudo tail -f /var/log/nginx/mom.access.log  # requests

pm2 restart ucfmom-api                      # restart one process
cd /var/www/ucfmom && ./deploy/deploy.sh    # rebuild and restart both
sudo certbot renew --dry-run                # certificate renewal works

sudo -u postgres psql mom_tracker           # a database prompt
df -h /                                     # disk
free -m                                     # memory
```

### When something is wrong

| Symptom | First thing to check |
|---|---|
| 502 from nginx | `pm2 status` — one of the two is stopped or errored |
| "Request failed (500)" on sign-in | `pm2 logs ucfmom-api --lines 50 --nostream`; usually the database |
| Uploads fail | The instance role and the bucket name. `aws s3 ls s3://BUCKET/files/` |
| The MoM prints without the crest | `var/branding/emblem.png` under the checkout is missing or unreadable |
| Site is slow at month end | `free -m`. If swap is being used heavily, the box wants 8 GB |
| Deployment failed | It printed the log lines and did not restart. The old version is still serving |
| The PDF will not open | No browser on the server to print with. `snap install chromium`, or set `MOM_BROWSER_PATH` |

There is also `pnpm doctor`, which checks migrations against the live schema,
every Prisma field against the real columns, and then performs four writes and
reports exactly what failed.

---

## What is deliberately not here

- **No Docker.** One box, four apt packages and two systemd units is less to
  learn, less to debug and about 500 MB less RAM.
- **No load balancer.** At two meetings a week, an hour of downtime costs this
  programme nothing. An ALB is ₹2,300 a month for an availability guarantee
  nobody has asked for.
- **No email.** WhatsApp only, by decision. `EMAIL_PROVIDER=none` is a
  supported setting and the application will not start in production with the
  development sink.
- **No secrets manager.** `/etc/mom/mom.env` is `root:mom 0640` on a box only
  two people can reach. Moving to SSM Parameter Store is worth doing when more
  than one machine needs the same secrets.

## Moving to two machines later

Nothing here blocks it, and three things are already right for it: documents
are in S3 rather than on the instance, the queue is Redis rather than
in-process, and sessions are JWTs rather than server state. What would change:
point `DATABASE_URL` and `REDIS_URL` at RDS and ElastiCache, put an ALB in
front of two instances, and make sure the scheduled work runs on exactly one
of them.
