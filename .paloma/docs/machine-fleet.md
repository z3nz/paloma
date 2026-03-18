# Paloma Machine Fleet

All machines running Paloma instances. They can communicate with each other via email for parallel work coordination.

## Machines

### 1. MacBook Pro (Primary)
- **Role:** Adam's primary dev machine, home Paloma instance
- **Path:** `/Users/adam/projects/paloma`
- **Email:** TBD
- **Status:** Active

### 2. Lenovo
- **Role:** Secondary dev machine for parallel work
- **Email:** `lenovo.paloma@verifesto.com`
- **Status:** Off (Adam will power on when needed)

### 3. Third Machine
- **Role:** TBD
- **Email:** TBD
- **Status:** Not yet identified — Adam mentioned "three machines so far"

## How Machines Coordinate

- Each machine runs its own Paloma instance (bridge + AI sessions)
- **Email is the inter-machine communication channel** — Paloma instances email each other for status updates, blocker notifications, and completion signals
- For sprint work, each machine gets a **file-disjoint work stream** on its own git feature branch
- Merges back to main when each stream completes

## Rules

- Every machine should read this file to know about its siblings
- When a new machine comes online, update this file
- Each machine's Paloma instance should have its email configured for sending/receiving
- Coordinate via email before touching shared files (constants, styles, etc.)
