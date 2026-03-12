# MCP Server Restructuring — Self-Contained Project

**Status:** completed
**Created:** 2026-03-11
**Scope:** paloma

## Goal

Move ALL MCP servers into the Paloma project repo. No more dependencies on home directory installs, `npx -y` runtime downloads, or external repos like `~/paloma-memory/`.

## Completed

- [x] Installed all external MCP servers as npm dependencies:
  - `@modelcontextprotocol/server-brave-search`
  - `@modelcontextprotocol/server-filesystem`
  - `@mseep/git-mcp-server`
  - `@kevinwatt/shell-mcp`
  - `@thelord/mcp-cloudflare`
- [x] Updated `scripts/setup-mcp.sh` — all `npx -y` replaced with `node node_modules/...` paths
- [x] Memory server now uses in-project `mcp-servers/memory.js` instead of `~/paloma-memory/`
- [x] Removed `~/paloma-memory/` clone from setup script
- [x] Regenerated `~/.paloma/mcp-settings.json` with local paths
- [x] Verified all entry points exist
- [x] Voice TTS working on macOS (tested successfully)

## Remaining

- [ ] Restart bridge and verify all MCP servers connect with new paths
- [ ] Test each MCP server works end-to-end
- [ ] Commit changes
- [ ] Update `instructions.md` to document the new structure

## Architecture Note

`~/.paloma/mcp-settings.json` still lives in the home dir (not repo) because it contains API keys (Brave, Cloudflare). The setup script generates it from a template with project-local paths. This keeps secrets out of git while making the server locations fully project-relative.
