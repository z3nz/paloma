# Paloma Machine Fleet

All machines running Paloma instances. They communicate via email for parallel work coordination.

## Machines

### 1. LYNCH-TOWER (Desktop Tower)
- **Hostname:** `LYNCH-TOWER`
- **Role:** Primary Paloma instance. The main machine. Adam's desktop tower.
- **Path:** `/home/adam/paloma`
- **Email:** `paloma@verifesto.com` (primary alias — the main account)
- **OS:** Linux (WSL2) on Windows
- **Status:** Active
- **Notes:** Uses `paloma@verifesto.com` as its identity. This is the Google Workspace primary account — no machine-specific alias needed unless we want strict symmetry.

### 2. MacBook Pro
- **Hostname:** TBD (Adam to confirm)
- **Role:** Adam's primary dev machine, secondary Paloma instance
- **Path:** `/Users/adam/projects/paloma`
- **Email:** `macbook.paloma@verifesto.com` (to be added as Google Workspace alias)
- **OS:** macOS
- **Status:** Active (email alias not yet created in Google Workspace)
- **Notes:** Email referenced in TRUSTED_SENDERS and email-watcher.js. Needs Google Workspace alias setup.

### 3. Lenovo
- **Hostname:** TBD (Adam to confirm)
- **Role:** Secondary dev machine for parallel work
- **Path:** TBD
- **Email:** `lenovo.paloma@verifesto.com` (to be added as Google Workspace alias)
- **OS:** TBD
- **Status:** Off (Adam powers on when needed)
- **Notes:** Email referenced in TRUSTED_SENDERS. Needs Google Workspace alias setup and machine-profile.json on that machine.

## Email Architecture

### How it works:
- `paloma@verifesto.com` is a **Google Workspace** account
- Machine-specific aliases (`lenovo.paloma@`, `macbook.paloma@`) are Google Workspace **aliases** added to the same account via Admin Console
- All emails to any alias land in the **same Gmail inbox**
- Each machine's `email-watcher.js` filters by checking the `To:` / `Delivered-To:` header against its `emailAlias` from `machine-profile.json`
- Each machine sends FROM its `emailAlias` (configured via `GMAIL_SENDER` env var or machine-profile)

### Cloudflare Email Routing: NOT used
Cloudflare Email Routing would conflict with Google Workspace MX records. The current setup (MX → Google) is correct. Do not enable Cloudflare Email Routing for verifesto.com.

### Gmail Send-As setup (per machine):
1. Google Workspace Admin Console → Users → paloma@verifesto.com → Add alias
2. On each machine: Gmail Settings → Accounts and Import → "Send mail as" → add machine alias → "Treat as alias" (no SMTP config needed for Workspace aliases)
3. Set `GMAIL_SENDER` env var in `~/.paloma/mcp-settings.json` to the machine alias

See full walkthrough: `.paloma/docs/email-admin-setup.md`

## How Machines Coordinate

- **Email** is the inter-machine communication channel — Paloma instances email each other for status updates, blocker notifications, and completion signals
- **git** is the code coordination channel — all machines pull from the same remote
- For sprint work, each machine gets a file-disjoint work stream on its own git feature branch
- Merges back to main when each stream completes

## Rules

- Every machine should read this file to know about its siblings
- When a new machine comes online: (1) add an entry here, (2) create machine-profile.json with emailAlias, (3) push — siblings will see it on next git pull
- `machine-profile.json` is the per-machine identity file (gitignored? or committed?) — it stores emailAlias, hardware info, backend preferences
- Coordinate via email before touching shared files (constants, styles, etc.)

## Pending Actions (Adam)

> WU-1 (code fixes) and WU-2 (Scout research + fleet doc) are complete. Remaining actions are infrastructure setup.

- [ ] Add `lenovo.paloma@verifesto.com` as alias in Google Workspace Admin Console
- [ ] Add `macbook.paloma@verifesto.com` as alias in Google Workspace Admin Console
- [ ] Configure "Send mail as" in Gmail Settings for each machine alias
- [ ] Set `GMAIL_SENDER` in `~/.paloma/mcp-settings.json` on Lenovo and MacBook
- [ ] Update `machine-profile.json` on Lenovo and MacBook with correct `emailAlias`
- [ ] Confirm hostnames and OS for Lenovo and MacBook (update this file)
- [ ] Run WU-5 cross-machine email test once aliases are provisioned
