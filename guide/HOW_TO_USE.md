# How to use Terraforge

This guide walks through the UI and the local-Terraform workflow. Drop screenshots into [`img/`](./img/) using the filenames listed under each figure — paths are already wired below.

> **Install / Docker / env vars** live in the root [`README.md`](../README.md). This page is about *using* the product after it’s running.

---

## Contents

1. [What Terraforge is](#1-what-terraforge-is)
2. [First run — setup & sign in](#2-first-run--setup--sign-in)
3. [Dashboard](#3-dashboard)
4. [Namespaces](#4-namespaces)
5. [Connect local Terraform](#5-connect-local-terraform)
6. [State, config, and Git](#6-state-config-and-git)
7. [Templates & Playground](#7-templates--playground)
8. [Providers & Documentation](#8-providers--documentation)
9. [Settings (admins)](#9-settings-admins)
10. [Common pitfalls](#10-common-pitfalls)

---

## 1. What Terraforge is

Terraforge is a **self-hosted control plane for Terraform workspaces**. You create **namespaces** (isolated environments), edit configuration in the browser, run **Init / Plan / Apply / Destroy** with live logs, inspect remote **state**, and optionally point a local project at Terraforge’s HTTP backend.

Sidebar navigation (when signed in):

| Item | Purpose |
|------|---------|
| **Dashboard** | Fleet overview — health, drift, runs |
| **Namespaces** | Create / open / rename / delete workspaces |
| **Templates** | Learning tracks → spawn a namespace from a starter |
| **Playground** | Scratch sandboxes (hidden from Dashboard by default) |
| **Providers** | Provider block snippets from the Registry |
| **Documentation** | Module docs + examples from the Registry |
| **Audit log** | Admin-only activity history |
| **Settings** | Admin-only user management |

Footer: **Connect local Terraform** · **Sign out**.

![Sidebar navigation](img/01-sidebar.png)

*Drop your screenshot as `guide/img/01-sidebar.png`.*

---

## 2. First run — setup & sign in

### Create the first admin

On a fresh install, open the site (default `http://localhost:3000`). You’ll land on **setup**:

1. Enter an **Admin email** and **Password** (at least 8 characters).
2. Click **Create admin**.
3. You’re signed in and sent to the Dashboard.

![First-run setup](img/02-setup.png)

*Drop as `guide/img/02-setup.png`.*

### Sign in later

Use **Sign in** with the same email and password. Disabled accounts cannot log in (admins manage that under **Settings**).

![Login](img/03-login.png)

*Drop as `guide/img/03-login.png`.*

---

## 3. Dashboard

The Dashboard is a hawk-eye view of non-playground namespaces:

- Stat tiles: namespaces, active runs, healthy / failed, drift, approvals, version bumps
- **Active now**, **Needs attention**, **Environments in use**, **Recent runs**, **Workspaces**
- Quick create: **New namespace name** → **Create** (optional remote URL + PAT)
- **How to connect** opens the local-connect guide
- **Refresh** reloads live activity

Playground namespaces stay off this list on purpose. If any exist, a hint links to **Open the Playground**. Promote one with **Show on Dashboard** from the namespace page or the Namespaces list.

![Dashboard](img/04-dashboard.png)

*Drop as `guide/img/04-dashboard.png`.*

---

## 4. Namespaces

### List all workspaces

Open **Namespaces** in the sidebar (`/namespaces`).

- **Create namespace** at the top (optional clone-from-remote)
- Filter by name/slug · toggle **Include playgrounds**
- Per row: **Rename**, **Show on Dashboard** / **Mark as playground**, **Open**, **Delete**

Deleting asks you to type the namespace name. That removes Terraforge’s copy of files, state, runs, and tokens — **it does not destroy cloud resources**. Run **Destroy** (or `terraform destroy`) first if you want infra gone.

![Namespaces list](img/05-namespaces-list.png)

*Drop as `guide/img/05-namespaces-list.png`.*

### Inside a namespace

Click **Open** (or a Dashboard workspace link). Typical sections top → bottom:

1. Header — name, status, **Connect with curl**
2. Environment / registry suggestions
3. **State map** — what’s in remote state
4. **Config map** — graph of the `.tf` Terraforge has on disk
5. **Configuration** — file editor + sync status
6. **Terraform lifecycle** — **Init** · **Plan** · **Apply** · **Destroy** + run history
7. **Namespace settings** — display name, Terraform version, approval gate, drift interval
8. **Members**, **Webhooks**, **Secrets**
9. **Local connect & tokens**
10. **Git remote** (optional, collapsed when unused)
11. **Danger zone** — delete namespace

![Namespace detail](img/06-namespace-detail.png)

*Drop as `guide/img/06-namespace-detail.png`.*

**Rename tip:** changing the display name does **not** change the slug. The slug is baked into backend URLs and connect config, so rename is safe for already-connected projects.

---

## 5. Connect local Terraform

Goal: your laptop’s `terraform plan` / `apply` uses Terraforge as the remote HTTP backend, and the Dashboard’s **State map** reflects that state.

### Generate the install command

From a namespace page:

1. Click **Connect with curl** (or **Get curl command** under **Local connect & tokens**).
2. In the dialog, click **Generate curl command** (one-time code, ~15 minutes).
3. Copy the `curl … | sh` line.

You can also open the same guide from the sidebar footer **Connect local Terraform**.

![Connect dialog](img/07-connect-dialog.png)

*Drop as `guide/img/07-connect-dialog.png`.*

### Run it in your project folder

```bash
cd /path/to/your/terraform/project

# Paste the generated command, for example:
curl -fsSL "http://YOUR_HOST:3000/api/connect/install/…" | sh
```

That writes:

- `terraforge_connect.tf` — declares `backend "http" {}`
- `terraforge_connect/` — `backend.hcl`, CLI config, **`sync.sh`**, **`pull.sh`**, README

Then:

```bash
terraform init -reconfigure -backend-config=terraforge_connect/backend.hcl
terraform plan
terraform apply
```

After a successful apply, refresh the namespace **State map** — resources should appear.

![State map after apply](img/08-state-map.png)

*Drop as `guide/img/08-state-map.png`.*

### Push configuration (not just state)

The HTTP backend carries **state only**. Your `.tf` files stay on disk until you push them. Without that push, the config map, in-app runs, and drift checks have nothing to work with.

```bash
# From the same project root:
sh terraforge_connect/sync.sh    # local .tf → Terraforge
sh terraforge_connect/pull.sh    # Terraforge → local (overwrites)
```

Re-run `sync.sh` after you edit files locally. New connect packs run a sync automatically once; older installs need the commands above.

Disconnect later:

```bash
rm -rf terraforge_connect terraforge_connect.tf
```

---

## 6. State, config, and Git

| Piece | What it shows | Do you need it? |
|-------|---------------|-----------------|
| **State map** | Resources Terraforge holds in remote state | **Yes** for local↔Dashboard state (after connect + apply) |
| **Config / editor** | `.tf` files stored in the namespace | **Yes** for UI runs, config map, and drift — use **sync.sh** or edit in the UI |
| **Git remote** | Optional mirror to GitHub / GitLab / Gitea | **No** for local Terraform — only if you want PR-style mirroring |

Empty state with a green “Connected — waiting for your first apply” means the backend is wired but nothing has been applied yet. Run `terraform apply` (or Apply in the UI once config is synced).

---

## 7. Templates & Playground

### Templates

**Templates** offers learning tracks (foundation → cloud starters). Open a template to:

- **Create namespace with this template**
- **Copy all files** / **Import here**

Useful for demos without writing HCL from scratch.

![Templates](img/09-templates.png)

*Drop as `guide/img/09-templates.png`.*

### Playground

**Playground** is scratch space. Sessions are marked `is_playground` and **do not appear on the Dashboard**.

Start options include **Blank playground**, **Blank + starter files**, or launching a saved template. Inside a session you get the deploy map, CLI, and editor. Use **Save playground** to keep a reusable template, and **Show on Dashboard** (or Namespaces → **Show on Dashboard**) when scratch work should become a normal workspace.

![Playground](img/10-playground.png)

*Drop as `guide/img/10-playground.png`.*

---

## 8. Providers & Documentation

### Providers

Search the Registry, pick a provider, copy **required_providers** / **provider** blocks (Copy buttons give clear feedback).

### Documentation

Search modules (e.g. `terraform-aws-modules/vpc/aws`), browse versions and examples, copy module blocks into your config.

![Providers / Documentation](img/11-providers-docs.png)

*Drop as `guide/img/11-providers-docs.png` (or two separate shots — update the path if you split them).*

---

## 9. Settings (admins)

**Settings** is admin-only user management:

- **Create user** — email, password, optional **Grant admin access**
- Per user: **Edit** (email / admin), **Reset password**, **Enable** / **Disable**, **Delete**

You cannot disable or delete yourself, strip your own admin flag, or remove the last active admin.

![Settings users](img/12-settings-users.png)

*Drop as `guide/img/12-settings-users.png`.*

---

## 10. Common pitfalls

1. **“Local isn’t synced” after apply** — Check **State map** first. If resources are there, state *is* synced. Empty config map means you still need `sh terraforge_connect/sync.sh`.
2. **Plan says “1 to add” after connect** — The remote state was empty (or you used `-reconfigure` without migrating). Apply to create, or use `terraform init -migrate-state …` if you already had a local `terraform.tfstate`.
3. **Playground missing from Dashboard** — Expected. Promote with **Show on Dashboard**.
4. **Red plan failures every minute** — Drift interval is set (e.g. 1 minute) but the namespace has no `.tf` yet, or AWS credentials/secrets are missing for in-app plans. Raise the interval under **Namespace settings** → **Save drift**, sync config, and add secrets as needed.
5. **Delete namespace ≠ destroy infra** — Always destroy (UI or CLI) before deleting if you don’t want orphaned cloud resources.
6. **Connect URL** — Use the **website** origin (`APP_PORT`, often `:3000`), not the raw API port.

---

## Screenshot checklist

| File | Suggested capture |
|------|-------------------|
| `img/01-sidebar.png` | Full sidebar with nav labels |
| `img/02-setup.png` | First-run Create admin screen |
| `img/03-login.png` | Sign in |
| `img/04-dashboard.png` | Dashboard overview |
| `img/05-namespaces-list.png` | Namespaces list with actions |
| `img/06-namespace-detail.png` | Namespace page (state + lifecycle visible) |
| `img/07-connect-dialog.png` | Connect local Terraform dialog with curl |
| `img/08-state-map.png` | State map showing resources |
| `img/09-templates.png` | Templates tracks |
| `img/10-playground.png` | Playground workspace |
| `img/11-providers-docs.png` | Providers or Documentation |
| `img/12-settings-users.png` | Settings user list |

See [`img/README.md`](./img/README.md) for naming tips and what **not** to include in screenshots (tokens, secrets).
