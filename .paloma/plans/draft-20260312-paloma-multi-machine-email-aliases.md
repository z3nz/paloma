# Multi-Machine Email Aliases

**Status:** draft
**Created:** 2026-03-12
**Scope:** paloma / infrastructure

## Vision

Enable multiple machines (Adam's spare laptops) to each run their own authenticated Paloma instance with distinct email identities — all under the verifesto.com domain, all routing through the same Gmail account.

## Why

Right now, paloma@verifesto.com is the single identity with one set of OAuth tokens on one machine. Adam wants to spin up Paloma on any spare laptop for any project — each machine gets its own alias email so sessions stay separate, identifiable, and independently authenticated.

## Architecture

```
paloma@verifesto.com          ← Main identity (primary machine)
paloma-forge@verifesto.com    ← Spare laptop #1 (heavy build work)
paloma-studio@verifesto.com   ← Spare laptop #2 (Verifesto Studios projects)
paloma-fadden@verifesto.com   ← Spare laptop #3 (Fadden / client work)
paloma-{name}@verifesto.com   ← Any future machine / project
```

All aliases → Cloudflare Email Routing → Gmail inbox
All machines → same Gmail OAuth app → separate token sets per machine

## Key Decisions Needed (Chart Phase)

1. **Alias naming convention** — project-based (paloma-fadden@) vs machine-based (paloma-laptop2@) vs both?
2. **Cloudflare Email Routing** — catch-all rule (paloma-*@verifesto.com → Gmail) vs individual alias rules?
3. **OAuth tokens** — one OAuth app with separate token files per machine, or separate OAuth apps?
4. **Send-as configuration** — each machine sends FROM its own alias? Requires Gmail "Send as" or SMTP relay setup
5. **Config discovery** — how does each machine know which alias it is? Env var? Machine-specific config file?

## Rough Implementation Plan

### Phase 1: Cloudflare Email Routing
- Set up email routing rules for verifesto.com aliases
- Either catch-all or specific aliases → forward to Adam's Gmail
- Test: send email TO an alias, verify it arrives in Gmail

### Phase 2: Send-As Configuration
- Configure Gmail "Send mail as" for each alias (Settings → Accounts)
- OR set up Cloudflare/custom SMTP relay for outbound
- Update gmail.js to read SENDER_ADDRESS from machine-specific config

### Phase 3: Per-Machine Auth
- Each machine runs `node mcp-servers/gmail.js auth` independently
- Tokens stored in `~/.paloma/gmail-tokens.json` (already machine-local)
- Add machine identity config: `~/.paloma/machine.json` with `{ "alias": "paloma-forge@verifesto.com", "name": "forge-laptop" }`

### Phase 4: Identity-Aware Email
- gmail.js reads machine alias from config
- Emails sent FROM the machine's alias, not the global paloma@verifesto.com
- Reply-to still routes back through Gmail

## Dependencies

- Cloudflare DNS access (we have `mcp__paloma__cloudflare-dns__*` tools)
- Gmail admin access for Send-As configuration
- Physical access to each spare laptop for OAuth auth flow

## Notes

- The OAuth app itself can be shared — each machine just gets its own token refresh cycle
- This also opens the door for machine-specific memory namespaces (the memory MCP server already supports collections)
- Could eventually enable true multi-agent parallel work: different Paloma instances on different machines tackling different projects simultaneously
