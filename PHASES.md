# Paloma Workflow Phases

> The complete Paloma development workflow

---

## The Workflow

```
Flow → Research → Plan → Forge → Review → Commit
  ↑_____________________________________________↓
```

---

## Phase Descriptions

### 🌊 Flow
**Purpose:** Freeform discovery and collaborative exploration

**When to use:**
- Starting a new session
- Brainstorming ideas
- Exploring "what if?" scenarios
- Debugging interactively
- Discussing architecture
- Reflecting after completing work

**Characteristics:**
- No rigid structure
- Organic idea emergence
- Equal partnership
- Can spawn focused sessions (Research/Plan/Forge)
- Return here after Commit to reflect

**Mindset:** Flow state, exploration, discovery

---

### 🔍 Research
**Purpose:** Focused investigation of specific topics

**When to use:**
- Understanding existing code
- Investigating libraries/APIs
- Exploring best practices
- Analyzing performance issues
- Gathering requirements

**Characteristics:**
- Systematic exploration
- Reading files autonomously
- Asking clarifying questions
- Building comprehensive understanding
- No assumptions or guessing

**Output:** Findings, questions, recommendations for planning

**Mindset:** Curiosity, thoroughness, clarity

---

### 📋 Plan
**Purpose:** Structured design and planning

**When to use:**
- After Research phase
- Designing new features
- Planning refactors
- Architecting solutions

**Characteristics:**
- High-level approach first
- Detailed implementation plan second
- Created in `.paloma/plans/active/`
- User reviews and approves plan
- Plan auto-loaded into context for Forge phase

**Output:** Markdown plan document with clear steps

**Mindset:** Strategic thinking, foresight, organization

---

### ⚒️ Forge
**Purpose:** Shape the solution with power and precision

**When to use:**
- After Plan is approved
- Executing the implementation
- Building features
- Refactoring code
- Fixing bugs

**Characteristics:**
- Reference active plan
- Write code with SEARCH/REPLACE or full files
- Changes appear in Changes Panel
- User reviews diffs before applying
- Multiple iterations possible
- Use cheaper models when appropriate

**Output:** Code changes ready for review

**Mindset:** Craftsmanship, precision, power

**Why "Forge":**
- Implies strength and durability
- Hot, active, transformative energy
- Combines craft and force
- Forging steel = making something unbreakable

---

### 👁️ Review
**Purpose:** Quality assurance and verification

**When to use:**
- After Forge phase
- Before committing changes
- Checking for edge cases
- Verifying security
- Ensuring style consistency

**Characteristics:**
- Check correctness
- Verify against plan
- Look for edge cases
- Security review
- Performance review
- Code style verification

**Output:** Approval to commit or issues to fix

**Mindset:** Critical eye, attention to detail

---

### ✅ Commit
**Purpose:** Finalize and document changes

**When to use:**
- After Review approval
- Only when user manually confirms

**Characteristics:**
- Detailed commit message
- Conventional commit format
- `##` sections for searchability
- Move plan to `.paloma/plans/completed/`
- Archive artifacts

**Output:** Git commit with full context

**Mindset:** Completeness, documentation, closure

---

## Phase Transitions

### Natural Flow
```
Start → Flow (explore the problem)
     ↓
     Research (understand deeply)
     ↓
     Plan (design solution)
     ↓
     Forge (build it)
     ↓
     Review (verify quality)
     ↓
     Commit (finalize)
     ↓
     Flow (reflect and discover next thing)
```

### Can Skip Phases
- Simple fixes might skip Research/Plan
- Bug fixes might go: Flow → Forge → Commit
- Experiments might stay in Flow

### Can Iterate
- Forge → Review → Forge (fix issues) → Review → Commit
- Plan → Forge → back to Plan (if approach changes)

### Can Return to Flow
- After any phase if discussion/exploration needed
- When stuck or uncertain
- To brainstorm alternatives

---

## Phase-Specific Agent Behavior

Each phase has different instructions in `src/prompts/phases.js`:

**Flow:**
- Conversational and exploratory
- Equal partnership emphasis
- Can suggest moving to other phases
- Encourages questions and ideas

**Research:**
- Uses tools proactively
- Asks clarifying questions
- Never assumes or guesses
- Summarizes findings clearly

**Plan:**
- Creates structured plan documents
- Seeks user approval before proceeding
- References project patterns
- Considers edge cases

**Forge:**
- References active plan
- Uses SEARCH/REPLACE for precision
- Shows work in Changes Panel
- Iterates based on feedback
- Explains reasoning

**Review:**
- Critical and thorough
- Points out potential issues
- Suggests improvements
- Verifies against requirements

**Commit:**
- Waits for explicit approval
- Writes detailed commit messages
- Archives plan documents
- Suggests next steps

---

## Why This Workflow Works

1. **Flow provides flexibility** - Not every task needs rigid structure
2. **Structured phases when needed** - Research/Plan/Forge for complex work
3. **User always in control** - Explicit transitions, approval gates
4. **Natural iteration** - Can revisit phases as needed
5. **Documentation built-in** - Plans and commits create searchable history
6. **Partnership mindset** - Flow emphasizes collaboration, not just execution

---

## Evolution

This workflow emerged organically:
- Started with 5 rigid phases (Research/Plan/Implement/Review/Commit)
- Discovered need for freeform collaboration
- Added Flow phase for discovery
- Renamed Implement → Forge for power and intention

The workflow itself follows the pattern it describes:
- Flow (discovered the need)
- Research (understood the problem)
- Plan (designed the solution)
- Forge (built it)
- Commit (documented it)

**The workflow is alive and evolving, just like Paloma.**

---

*Last Updated: [Current Date]*  
*This document will evolve as we discover better patterns.*
