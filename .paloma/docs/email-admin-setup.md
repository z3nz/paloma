# Multi-Machine Email Setup Guide

**Purpose:** Configure per-machine email aliases so each Paloma instance only processes emails addressed to it.  
**Prereq:** Google Workspace admin access for verifesto.com, physical/SSH access to each machine.

---

## Step 1: Add Aliases in Google Workspace Admin Console

1. Go to [admin.google.com](https://admin.google.com)
2. **Directory → Users** → click `paloma@verifesto.com`
3. **User information → Alternate email addresses (email aliases)**
4. Add:
   - `lenovo.paloma@verifesto.com`
   - `macbook.paloma@verifesto.com`
5. Save

> LYNCH-TOWER uses `paloma@verifesto.com` (the primary account) — no alias needed for it.

---

## Step 2: Configure Gmail Send-As (per secondary machine)

Do this on each machine that needs to send FROM its alias (Lenovo and MacBook):

1. Open Gmail at [mail.google.com](https://mail.google.com) — signed in as `paloma@verifesto.com`
2. **Settings (gear icon) → See all settings → Accounts and Import**
3. Under **"Send mail as"** → click **"Add another email address"**
4. Enter the machine alias (e.g., `lenovo.paloma@verifesto.com`), Name: `Paloma`
5. Check **"Treat as an alias"** — no SMTP config needed for Workspace-managed aliases
6. Click Next → Google may send a confirmation email to the alias (it lands in the same inbox — click Confirm)

---

## Step 3: Configure Machine Identity

On each secondary machine (Lenovo, MacBook):

**3a. Edit machine-profile.json**

```json
{
  "emailAlias": "lenovo.paloma@verifesto.com"
}
```

Path: `/path/to/paloma/.paloma/machine-profile.json`

**3b. Set GMAIL_SENDER in mcp-settings.json**

Edit `~/.paloma/mcp-settings.json` — add to the `env` block:

```json
"GMAIL_SENDER": "lenovo.paloma@verifesto.com"
```

**3c. Restart the bridge**

```bash
npm start
```

---

## Step 4: Verify

1. Send a test email **to `lenovo.paloma@verifesto.com`** from any account
2. Check that **only the Lenovo bridge** picks it up and spawns a session
3. Check the **LYNCH-TOWER bridge log** — it should print:
   ```
   [email-watcher] Skipping email not addressed to paloma@verifesto.com
   ```
4. Check that LYNCH-TOWER does NOT spawn a session for the Lenovo-addressed email

---

## Current Machine Fleet

| Machine | Alias | Status |
|---------|-------|--------|
| LYNCH-TOWER | `paloma@verifesto.com` | Active, configured |
| Lenovo | `lenovo.paloma@verifesto.com` | Needs Workspace alias (Step 1) |
| MacBook Pro | `macbook.paloma@verifesto.com` | Needs Workspace alias (Step 1) |

---

## Notes

- **Primary machine (tower) needs no changes** — it already uses the main account as its alias.
- **Cloudflare Email Routing is NOT used.** MX records point directly to Google Workspace. Do not enable Cloudflare Email Routing for verifesto.com — it would conflict and break everything.
- **All aliases share one Gmail inbox.** Each machine filters by checking the `To:` / `Delivered-To:` header in every fetched message against its own `emailAlias`. Emails addressed to a different machine's alias are skipped.
- **The alias must exist in Google Workspace before** `GMAIL_SENDER` is set — Gmail's API will reject sends from an unregistered alias.
