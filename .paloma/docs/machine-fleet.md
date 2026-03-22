# Paloma Machine Fleet

All machines running Paloma instances. They communicate via email for parallel work coordination.

## Machines

### 1. LYNCH-TOWER (Desktop Tower) — ORCHESTRATOR
- **Hostname:** `LYNCH-TOWER`
- **Role:** **Orchestrator.** The main Paloma instance. Delegates work across machines, tracks resource availability, manages model usage budgets. Adam's desktop tower.
- **Path:** `/home/adam/paloma`
- **Email:** `paloma@verifesto.com` (primary alias — the main account)
- **OS:** Linux (WSL2) on Windows
- **CPU:** AMD Ryzen 7 3800X 8-Core Processor
- **RAM:** 16GB
- **Backends:** Claude, Codex, Copilot, Gemini, Ollama (codellama:7b, phi3:mini, deepseek-coder-v2:16b, qwen2.5-coder:7b)
- **Status:** Active, fully configured
- **Notes:** Uses `paloma@verifesto.com` as its identity. This is the Google Workspace primary account. As orchestrator, Lynch Tower knows all machine specs and decides which machine handles which task.

### 2. MacBook Pro
- **Hostname:** TBD (Adam to confirm)
- **Role:** TBD — secondary Paloma instance
- **Path:** `/Users/adam/projects/paloma`
- **Email:** `macbook.paloma@verifesto.com`
- **OS:** macOS
- **Status:** Active (email alias verified working 2026-03-22)
- **Notes:** Role to be determined by Adam.

### 3. Lenovo ThinkPad — THE BRAIN
- **Hostname:** TBD (Adam to confirm)
- **Role:** **The Brain.** Heavy compute, deep thinking tasks.
- **Path:** TBD
- **Email:** `lenovo.paloma@verifesto.com`
- **OS:** TBD
- **Status:** Off (Adam powers on when needed; email alias verified working 2026-03-22)
- **Notes:** Designated as "the brain" by Adam. Needs machine-profile.json on that machine. Specs TBD once powered on.

### 4. Adam's MacBook Pro (adambookpro)
- **Hostname:** `AdamBook Pro` (Mac17,7)
- **Role:** TBD — newest machine, incredible specs
- **Path:** `/Users/adam/Projects/paloma`
- **Email:** `adambookpro.paloma@verifesto.com`
- **OS:** macOS 26.3.1 (Darwin 25.3.0)
- **Chip:** Apple M5 Max (18 cores: 6 Super + 12 Performance)
- **GPU:** Apple M5 Max, 40-core, Metal 4
- **Memory:** 128 GB unified
- **Storage:** 8 TB Apple SSD (7.84 TB free)
- **Display:** Built-in Liquid Retina XDR, 3024x1964
- **Status:** Active (email alias verified working 2026-03-22, specs confirmed 2026-03-22)
- **Notes:** Newest addition to the fleet. Beast hardware — M5 Max with 128GB unified memory makes this the most powerful machine in the fleet by far. Needs machine-profile.json created.

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

- [x] Add `lenovo.paloma@verifesto.com` as alias in Google Workspace Admin Console (done 2026-03-22)
- [x] Add `macbook.paloma@verifesto.com` as alias in Google Workspace Admin Console (done 2026-03-22)
- [x] Add `adambookpro.paloma@verifesto.com` as alias in Google Workspace Admin Console (done 2026-03-22)
- [x] Verify all aliases deliver to shared inbox (tested 2026-03-22 — all 3 confirmed)
- [ ] Configure "Send mail as" in Gmail Settings for each machine alias
- [ ] Set `GMAIL_SENDER` in `~/.paloma/mcp-settings.json` on Lenovo, MacBook, and adambookpro
- [ ] Create `machine-profile.json` on Lenovo, MacBook, and adambookpro with correct `emailAlias` and hardware specs
- [ ] Confirm hostnames and OS for all secondary machines (update this file)
- [ ] Install Paloma on adambookpro MacBook Pro
- [ ] Run cross-machine email test once all machines are online
