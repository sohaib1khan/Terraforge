# Terraforge

Self-hosted control plane for Terraform workspaces. Manage namespaces, edit configuration, run init/plan/apply/destroy, stream logs, track state, and connect a local project over an HTTP backend — without handing your day-to-day workflow to a SaaS.

The stack is Docker Compose first: API and worker (Go), Postgres, Redis, a Terraform runner image, and a React UI behind nginx.

## What you get

- Namespaces with file tree inspect/edit, config map, and remote state view
- Runs from the UI with live console output, history, cancel, and optional approval gates
- Secure local connect: one-time install codes (`curl | sh` or companion CLI), scoped tokens — not browser JWTs
- Sync between a local project and the namespace (`terraforge sync` / `pull` / `watch`)
- Encrypted namespace secrets, RBAC-ish membership, audit log, drift scheduling hooks
- Optional Slack notify and GitHub PR comments when configured

This repo will keep growing; treat the list above as the current baseline, not a finished product catalog.

## Architecture (short)

| Piece | Role |
|--------|------|
| `apps/web` | UI (React + Vite + Tailwind). Served by nginx; proxies `/api` to the API. |
| `apps/api` | HTTP API, auth, namespaces, runs, state backend, connect/install. |
| `apps/api` worker | Dequeues runs, launches the Terraform runner container, streams logs. |
| `apps/cli` | Companion binary: connect, sync, watch, wrap terraform with run recording. |
| `runner-image` | Terraform image used for remote runs. |
| Postgres / Redis | Persistence and run queue. |

Persistent namespace repos and logs live in the `terraforge_data` Docker volume (not in git).

## Prerequisites

- Docker Engine with Compose v2
- Enough disk for images and the data volume
- (Optional) Go 1.22+ if you build `apps/cli` locally
- (Optional) Node 22+ only if you develop the UI outside Compose

Host ports are configurable; defaults assume nothing else is bound to them.

## Quick start

```bash
git clone https://github.com/sohaib1khan/Terraforge.git
cd Terraforge
cp .env.example .env
# Edit .env: set JWT_SECRET to something non-default before any real use.
# Change APP_PORT if 3000 is taken.

docker compose up -d --build
```

Open `http://localhost:3000` (or `http://localhost:$APP_PORT`).

First visit creates the initial admin account (setup screen). After that, sign in and create a namespace.

Useful checks:

```bash
docker compose ps
curl -fsS "http://localhost:${APP_PORT:-3000}/healthz"
```

Stop:

```bash
docker compose down
```

Data survives `down` unless you remove the named volumes.

## Configuration

Primary knobs live in `.env` (copied from `.env.example`):

| Variable | Meaning | Default |
|----------|---------|---------|
| `APP_PORT` | Website port (browser, connect URLs, CLI `api_url`) | `3000` |
| `API_PORT` | Host mapping for the API container (prefer the website origin) | `8088` |
| `POSTGRES_PORT` / `REDIS_PORT` | Host mappings if you need them exposed | `5432` / `6379` |
| `JWT_SECRET` | Signing secret — change this | see example |
| `JWT_TTL` | Session lifetime | `24h` |
| `RUNNER_IMAGE` | Image tag for Terraform jobs | `terraforge-runner:local` |
| `RUN_TIMEOUT_SECONDS` | Per-run timeout | `600` |

Always use the **website origin** (`APP_PORT`) for connect packs and the companion CLI — not the raw `API_PORT`.

Optional: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` mounts migrations for API iteration.

## Companion CLI

From a machine that can reach the UI:

```bash
cd apps/cli
go build -o ../../bin/terraforge ./cmd/terraforge
```

Typical flow after creating a namespace in the UI:

1. Generate a connect command in the namespace (**Connect with curl**).
2. In your Terraform project directory, run that command (or `terraforge connect <tarball-url>`).
3. `terraform init -reconfigure -backend-config=terraforge_connect/backend.hcl`
4. Optionally: `terraforge sync` to push local `.tf` into the namespace IDE, then `terraforge watch` to keep local and remote aligned.

```text
terraforge status   # digests + checklist
terraforge sync     # local → Terraforge
terraforge pull     # Terraforge → local
terraforge watch    # auto bi-directional
terraforge doctor
terraforge plan|apply|destroy   # recorded runs via the API
```

## Security notes

- Change `JWT_SECRET` before exposing the stack beyond a trusted network.
- Connect install codes are short-lived and single-use; do not share them.
- Namespace secrets are stored encrypted; still treat the host and volume as sensitive.
- Do not commit `.env`, data directories, or local blueprint/planning docs.

## Repository layout

```text
apps/api/          Go API + worker + migrations
apps/web/          React UI
apps/cli/          Companion CLI
runner-image/      Terraform runner
docker-compose.yml Full stack
.env.example       Port and secret template
```

Local-only planning documents and runtime data are intentionally excluded from version control.

## Source

https://github.com/sohaib1khan/Terraforge

Issues and pull requests are welcome as the feature set grows.

## Credits

| Role | |
|------|--|
| Solution Architect & QA | Sohaib Khan |
| Development | Cursor |

