# Scout: Multi-Machine Email Infrastructure Research

**Date:** 2026-03-22  
**Author:** Scout (WU-2)  
**Feeds:** Chart → Forge (Tier 2 email hardening)

---

## 1. Current State

### DNS Configuration (verifesto.com)
**MX Records (5 total) — all point directly to Google:**
```
aspmx.l.google.com      (priority 1)
alt1.aspmx.l.google.com (priority 5)
alt2.aspmx.l.google.com (priority 10)
alt3.aspmx.l.google.com (priority 20)
alt4.aspmx.l.google.com (priority 30)
```

**TXT Records:**
- `v=spf1 include:_spf.google.com ~all` — SPF already allows Google to send
- Google site verification records (2x)
- Google GWS recovery verification

**Cloudflare Email Routing: NOT active.** Cloudflare Email Routing would use Cloudflare's own MX servers (`route1.mx.cloudflare.net`, etc.). The current MX records point directly to Google — Cloudflare is only the DNS/nameserver, not the email router.

### Current Code State
**`bridge/email-watcher.js`:**
- Poll query: `is:unread in:inbox` — no recipient filtering, catches all emails regardless of which alias they were sent to
- TRUSTED_SENDERS already includes `lenovo.paloma@verifesto.com` and `macbook.paloma@verifesto.com` — the machine aliases are anticipated but not yet working
- `seenIds`: in-memory Set, lost on bridge restart
- `_isThreadReplied`: only checks `paloma@verifesto.com`, misses replies sent from machine aliases

**`mcp-servers/gmail.js`:**
- `SENDER_ADDRESS = process.env.GMAIL_SENDER || 'paloma@verifesto.com'` — **NOT hardcoded**, already reads from env var. If `GMAIL_SENDER` is set in the environment, it uses that. The "hardcoded fallback" is the real issue.
- `From: Paloma <${SENDER_ADDRESS}>` — used in both `buildRawEmail` and `buildReplyRaw`

**`.paloma/machine-profile.json` (LYNCH-TOWER, this machine):**
- Already has `"emailAlias": "paloma@verifesto.com"` — field exists, correct for the main tower
- This field was added during earlier identity/backend work (before WU-1 in the current plan)

**`.paloma/docs/machine-fleet.md`:**
- MacBook Pro: Email listed as `TBD`
- Lenovo: `lenovo.paloma@verifesto.com`
- Third machine: TBD, unidentified

---

## 2. Cloudflare Email Routing — NOT the right tool here

**Critical finding: Cloudflare Email Routing is incompatible with Google Workspace MX.**

Cloudflare Email Routing is a **forwarding service** — it receives email at Cloudflare's MX servers and forwards it to a destination inbox (like a personal Gmail). It was designed for personal domains where someone wants to avoid setting up a full mail server.

**It cannot coexist with Google Workspace MX records.** Enabling it would require replacing the Google MX records with Cloudflare's routing MX records, which would break the existing Google Workspace email setup entirely. You'd lose the ability to receive email in the Google Workspace Gmail account.

**Since verifesto.com uses Google Workspace for email, the correct approach is Google Workspace alias management — not Cloudflare Email Routing.**

### What the Cloudflare DNS MCP tools can/cannot do:
- ✅ Manage DNS records (MX, TXT, A, CNAME) — used for regular DNS  
- ❌ Manage Cloudflare Email Routing rules — those are a separate service-layer API
- **Verdict:** The existing Cloudflare DNS MCP tools are irrelevant to this task. Alias setup happens in Google Workspace Admin Console.

---

## 3. Correct Architecture: Google Workspace Aliases

Since `paloma@verifesto.com` is a Google Workspace account, aliases are managed in the **Google Workspace Admin Console** (not Gmail settings, not Cloudflare).

### How aliases work in Google Workspace:
1. In Admin Console → Users → paloma@verifesto.com → Add alternate emails (aliases)
2. Add: `lenovo.paloma@verifesto.com`, `macbook.paloma@verifesto.com`, `tower.paloma@verifesto.com`
3. All emails to those aliases land in the SAME Gmail inbox (`paloma@verifesto.com`)
4. No additional mailboxes, no extra accounts, no extra cost
5. **To:** header in each email shows which alias was used

### Receiving — how to filter by recipient:
The Gmail search API supports the `deliveredto:` operator, but there are documented issues with Google Workspace aliases (the operator sometimes doesn't work consistently for alias addresses). 

**Reliable approach:** Don't filter at the API query level. Instead:
1. Poll with `is:unread in:inbox` as now (or `to:paloma@verifesto.com OR to:tower.paloma@verifesto.com` for multi-machine)
2. After fetching each message, extract the `To` or `Delivered-To` header
3. Match against the machine's `emailAlias` field from `machine-profile.json`
4. Skip emails not addressed to this machine's alias

This requires adding `To` and `Delivered-To` to the `metadataHeaders` list in `email-watcher.js`'s `messages.get` call.

### Sending — Gmail Send-As for aliases:
For Google Workspace aliases (added via Admin Console), the Gmail account can send FROM those aliases automatically. Two configuration paths:

**Path A: Google Workspace Admin Console (automated, preferred)**
- Admin adds aliases directly to the user account
- Gmail automatically recognizes them as valid "Send As" addresses
- No SMTP verification required for Workspace-managed aliases
- Paloma can then specify `From: Paloma <lenovo.paloma@verifesto.com>` in the raw email, and Gmail will honor it

**Path B: Gmail Settings UI (manual, per-machine)**
- Gmail Settings → Accounts and Import → "Send mail as" → Add another email address
- For Google Workspace aliases: select "Treat as an alias" — no SMTP server config needed
- For non-Workspace addresses: requires SMTP server credentials (more complex)
- **This is the per-machine step Adam needs to do manually for now**

**Critical constraint:** Gmail will REJECT (or silently override) the `From:` header if the alias is not configured. The Gmail API's `messages.send` enforces this. So the alias must be added to the account before `GMAIL_SENDER` can be set to a machine alias.

---

## 4. Naming Convention — Machine-Based (Confirmed)

### Current state:
- `paloma@verifesto.com` — main/primary (this machine: LYNCH-TOWER)
- `lenovo.paloma@verifesto.com` — Lenovo laptop (already in TRUSTED_SENDERS, machine-fleet.md)
- `macbook.paloma@verifesto.com` — MacBook Pro (in TRUSTED_SENDERS, machine-fleet.md says TBD)

### The naming convention is already decided — machine-based wins:
The codebase already commits to `{machine}.paloma@verifesto.com`. It's in TRUSTED_SENDERS, in machine-fleet.md, and the instructions.md documents it explicitly. There's no reason to change it.

### LYNCH-TOWER needs a machine alias too:
The tower (this machine) currently uses `paloma@verifesto.com` as its alias, which is the primary. For clean multi-machine routing, the tower should also have a machine-specific alias:
- **Option A:** Keep `paloma@verifesto.com` as the tower's alias (primary machine stays primary)
- **Option B:** Add `tower.paloma@verifesto.com` as an alias for the tower too, so all machines follow the same pattern

**Recommendation: Option A — keep `paloma@verifesto.com` as the tower alias.** It's already working, it's the "main" instance, and adding a third alias adds complexity for no benefit. The tower IS the primary Paloma.

### MacBook Pro email:
The MacBook Pro is listed as Adam's "primary dev machine" in machine-fleet.md but has `Email: TBD`. Based on the naming convention, it should be `macbook.paloma@verifesto.com` (already in TRUSTED_SENDERS). This needs to be confirmed with Adam and then added as a Google Workspace alias.

---

## 5. Fleet Discovery

### Current state:
`.paloma/docs/machine-fleet.md` is the fleet registry. It's committed to the git repo and travels with `git clone`. It's the right place.

### Problems with current fleet doc:
- MacBook Pro email is `TBD` (should be `macbook.paloma@verifesto.com`)
- LYNCH-TOWER (this machine) is not listed at all
- Third machine is unknown

### Recommendation: Manual registration, file-based discovery
For a 2-3 machine fleet, automated discovery is over-engineering. The workflow should be:

1. When a new machine comes online, Adam (or Paloma on that machine) updates `machine-fleet.md` with:
   - Machine name/hostname
   - Role
   - Email alias
   - Status
2. The machine creates its `machine-profile.json` with its `emailAlias`
3. Commit and push — all machines get the update via `git pull`

No dynamic discovery needed. `machine-fleet.md` is the source of truth.

### Fleet registry enrichment needed:
The fleet doc should also include:
- Hostname (for disambiguation)
- OS / platform
- Current git branch (changes, not storable)
- Last seen (changes, not storable)

Static fields only in the file. Hostname + email alias is enough.

---

## 6. WU-1 Status: Already Partially Done

**Important discovery:** `machine-profile.json` already has `"emailAlias": "paloma@verifesto.com"`. This was added during the backend identity parity work (commit: `a097b73`), not as part of WU-1.

**What WU-1 still needs to do:**
1. ✅ emailAlias field in machine-profile.json — ALREADY EXISTS
2. ❌ Filter poll query by recipient (`to:${emailAlias} is:unread in:inbox`) 
3. ❌ Read GMAIL_SENDER from machine profile (pass to gmail.js as env var via mcp-settings.json)
4. ❌ Persist seenIds to `~/.paloma/email-seen-ids.json`
5. ❌ Fix `_isThreadReplied` to detect replies from ANY Paloma alias

The emailAlias field existing is a nice surprise — WU-1 Forge work is slightly simpler.

---

## 7. Gmail API — Recipient Filtering Implementation Details

For WU-1's recipient filtering fix, the implementation should:

```js
// In email-watcher.js — fetch To header
const msg = await this.gmail.users.messages.get({
  userId: 'me',
  id: ref.id,
  format: 'full',
  metadataHeaders: ['From', 'Subject', 'Date', 'To', 'Delivered-To']  // Add To + Delivered-To
})

// Check if email was addressed to this machine
const toHeader = this._getHeader(msg.data, 'To') || ''
const deliveredTo = this._getHeader(msg.data, 'Delivered-To') || ''
const machineAlias = this.machineAlias  // loaded from machine-profile.json at startup

if (!toHeader.includes(machineAlias) && !deliveredTo.includes(machineAlias)) {
  console.log(`[email-watcher] Skipping email not addressed to ${machineAlias}: ${subject}`)
  continue
}
```

The poll query can also be tightened to reduce API calls:
```
to:${machineAlias} is:unread in:inbox
```
But per the deliveredto: reliability concerns above, the header check is the definitive gate.

---

## 8. Implementation Checklist

### Prerequisites (Adam must do manually):
- [ ] Google Workspace Admin Console → Users → paloma@verifesto.com → Add aliases:
  - `lenovo.paloma@verifesto.com`
  - `macbook.paloma@verifesto.com`
  - *(tower already uses paloma@verifesto.com, no alias needed)*
- [ ] On each machine's Gmail account: Settings → Accounts and Import → "Send mail as" → add machine alias
- [ ] On Lenovo: set `GMAIL_SENDER=lenovo.paloma@verifesto.com` in `~/.paloma/mcp-settings.json`
- [ ] On MacBook: set `GMAIL_SENDER=macbook.paloma@verifesto.com` in `~/.paloma/mcp-settings.json`

### WU-1 Forge Tasks (code changes on this machine):
- [ ] `email-watcher.js`: Load `emailAlias` from `machine-profile.json` at startup
- [ ] `email-watcher.js`: Add `To` and `Delivered-To` to `metadataHeaders`
- [ ] `email-watcher.js`: Filter: skip emails not addressed to `this.machineAlias`
- [ ] `email-watcher.js`: Persist `seenIds` to `~/.paloma/email-seen-ids.json` (load on start, save on update)
- [ ] `email-watcher.js`: Fix `_isThreadReplied` to check all TRUSTED_SENDERS Paloma aliases
- [ ] `mcp-servers/gmail.js`: Read `emailAlias` from machine-profile.json as GMAIL_SENDER fallback (instead of hardcoding `paloma@verifesto.com`)

### WU-2 Forge Tasks (infrastructure + fleet docs):
- [ ] Update `machine-fleet.md` with LYNCH-TOWER entry and MacBook email
- [ ] Add fleet doc entry for each machine: hostname, role, email alias, status
- [ ] Document Cloudflare Email Routing as "not applicable" in architecture notes

### Future (after alias confirmation with Adam):
- [ ] Confirm MacBook Pro email alias (`macbook.paloma@verifesto.com`)
- [ ] Test cross-machine email by sending from lenovo → tower and verifying only tower handles it
- [ ] Add integration test or health-check that verifies `emailAlias` matches actual Gmail account

---

## 9. Open Questions for Adam

1. **MacBook email alias confirmed?** The code already references `macbook.paloma@verifesto.com` — is this the intended alias for the MacBook? Should it be `mbp.paloma@`? `adam-mbp.paloma@`?

2. **Google Workspace Admin access?** Does Adam have admin access to the Google Workspace console for verifesto.com? The alias setup requires admin access (not just Gmail settings).

3. **LYNCH-TOWER alias strategy?** Should the tower get a machine-specific alias (`tower.paloma@verifesto.com`) in addition to `paloma@verifesto.com`, or keep using the primary as its identity?

4. **Multi-machine coordination timing?** Is the Lenovo or MacBook online and testable now, or is this setup deferred until machines are ready?

---

## Summary

**The path forward is simpler than expected:**
- Cloudflare Email Routing is NOT the solution — it conflicts with Google Workspace
- The right tool is Google Workspace alias management (Admin Console)
- The code already has `emailAlias` in machine-profile.json — WU-1 Forge can focus on the 4 remaining code fixes
- The Gmail sender env var already works — Forge just needs to read emailAlias as the default
- Fleet discovery: `machine-fleet.md` is sufficient, no automation needed
- Machine-based naming (`{machine}.paloma@verifesto.com`) is already the established convention — confirmed, no change needed

**One blocker:** Adam needs Google Workspace Admin Console access to add the aliases before cross-machine email routing can work. The code fixes can be done first.
