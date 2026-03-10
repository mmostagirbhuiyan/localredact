# Sprint Execution (Roadmap-Driven)

Read CLAUDE.md Session State only.

## Sprint Reference

$ARGUMENTS

## CRITICAL: ONE TASK AT A TIME

**DO NOT batch tasks. Execute ONE task fully, verify it, then ask before proceeding.**

The workflow is:
1. **Step 0: Read ROADMAP.md and identify current phase/task**
2. Pick the next unchecked `- [ ]` item
3. Implement it completely
4. Run verification (TypeScript, build, tests)
5. Present results with test instructions
6. **WAIT for user approval** before moving to next task
7. Only after approval: check off item, commit, move on

## Task Source

**Primary:** `ROADMAP.md` — the single source of truth for all work.

Tasks are organized by phase:
- Phase 1: Detection Engine Upgrade (Piiranha, WebGPU, multi-pass)
- Phase 2: True PDF Redaction (render-to-image pipeline)
- Phase 3: Vision Model Fallback (SmolVLM, SmolDocling)
- Phase 4: UX Polish (review interface, batch processing, export)

Each task is a checkbox: `- [ ]` (todo) or `- [x]` (done).

## Arguments

- No args: pick next unchecked task in current phase
- `Phase N` or `N`: work on Phase N specifically
- `N.M`: work on specific sub-phase (e.g., `1.2` = Phase 1, WebGPU Acceleration)
- `--status`: show progress summary across all phases
- `--next`: show what's next without starting work

## Workflow Per Task

### Step 0: Status Check (ALWAYS FIRST)

1. Read `ROADMAP.md`
2. Count checked vs unchecked items per phase
3. Identify the current phase (first phase with unchecked items)
4. If `--status` flag, output summary and stop:

```
## LocalRedact v2 Progress

| Phase | Description | Done | Total | % |
|-------|-------------|------|-------|---|
| 1 | Detection Engine Upgrade | 2 | 7 | 29% |
| 2 | True PDF Redaction | 0 | 5 | 0% |
| 3 | Vision Model Fallback | 0 | 5 | 0% |
| 4 | UX Polish | 0 | 8 | 0% |

**Current Phase:** 1 — Detection Engine Upgrade
**Next Task:** Replace `Xenova/bert-base-NER` with Piiranha v1
```

### Step 1: Select Task

Pick the next unchecked `- [ ]` item. If user specified a phase/sub-phase, pick from there.

Present:
```
## Next Task: Phase [N].[M] — [Task Description]

Phase: [Phase Name]
Section: [Sub-phase Name]
Task: [Exact checkbox text from ROADMAP.md]

Proceed? (y/n)
```

### Step 2: Discovery

Before ANY code:
1. Use subagent to search codebase for existing implementations and related files
2. Check if similar patterns exist
3. Read all relevant files
4. Check Dead Approaches in CLAUDE.md and ROADMAP.md — don't repeat mistakes

Output:
```
### Discovery
- Files to modify: [list]
- Files to create: [list, if any]
- What exists: [brief]
- Approach: [1-2 sentences]
- Estimated changes: [small/medium/large]
- Dependencies: [any npm packages to install]
```

### Step 3: Implementation

Implement the task:
- Match existing code patterns (check similar files first)
- Keep changes minimal and focused
- No scope creep — only what the checkbox says

### Step 4: Verification (MANDATORY)

After implementation, run ALL of:

1. **TypeScript Check**
```bash
npx tsc --noEmit
```

2. **Build Check**
```bash
npm run build
```

3. **Test Check** (if tests exist for modified code)
```bash
npm run test
```

4. **Manual Check**
- List specific steps to test in the browser
- Note expected behavior

### Step 5: Present Results

```
## Task Complete: Phase [N].[M] — [Task Description]

### Changes Made
- [file1]: [what changed]
- [file2]: [what changed]

### Verification
- TypeScript: PASS/FAIL
- Build: PASS/FAIL
- Tests: PASS/FAIL (if applicable)

### Test This
1. Run `npm run dev`
2. [Step-by-step manual test instructions]
3. Expected: [what should happen]

### Edge Cases Considered
- [edge case 1]: [how handled]

**Ready to commit and mark done?**
Reply "approved" to proceed, or describe issues to fix.
```

### Step 6: Finalize (Only After Approval)

After user says "approved" (or equivalent):

1. **Update ROADMAP.md** — check off the completed item:
   - Change `- [ ]` to `- [x]` for the completed task

2. **Commit changes:**
```bash
git add [files]
git commit -m "[type]: [description]

[body — what was done and why]

ROADMAP: Phase [N].[M] — [task description]

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

3. **Update CLAUDE.md Session State** with current progress

4. **Present:**
```
## Task Checked Off

Committed: [hash]
ROADMAP: Phase [N].[M] ✓

### Progress: Phase [N]
[X/Y] tasks complete ([Z]%)

Proceed to next task? (y/n)
```

## Model Delegation

Use subagents strategically:
- **Explore agent**: Discovery phase — find files, patterns, existing code
- **Haiku subagent**: Trivial changes (copy, CSS, config tweaks)
- **Sonnet subagent**: Moderate changes (component mods, hook updates)
- **Main context (Opus)**: Architecture decisions, multi-file refactors, complex logic

## Rules

1. **ONE TASK AT A TIME** — Never batch. Never assume approval.
2. **VERIFY BEFORE PRESENTING** — TypeScript + build must pass. No "should work" assumptions.
3. **WAIT FOR APPROVAL** — Do not commit or check off items without explicit user approval.
4. **CHECK DEAD APPROACHES** — Read CLAUDE.md and ROADMAP.md Dead Approaches before implementing. Don't repeat known failures.
5. **NO SCOPE CREEP** — Only do what the checkbox says. Nothing extra.
6. **BLOCKED = STOP** — If task is unclear or blocked, ask user. Don't guess.
7. **ROADMAP IS TRUTH** — All progress tracked via checkboxes in ROADMAP.md.
8. **UPDATE SESSION STATE** — Keep CLAUDE.md current after each task.

## Example Session

```
User: /sprint

Claude: ## LocalRedact v2 Progress

| Phase | Description | Done | Total | % |
|-------|-------------|------|-------|---|
| 1 | Detection Engine Upgrade | 0 | 7 | 0% |
| 2 | True PDF Redaction | 0 | 5 | 0% |
| 3 | Vision Model Fallback | 0 | 5 | 0% |
| 4 | UX Polish | 0 | 8 | 0% |

**Current Phase:** 1 — Detection Engine Upgrade

## Next Task: Phase 1.1 — Piiranha v1 Integration

Phase: Detection Engine Upgrade
Section: Piiranha v1 Integration
Task: Replace `Xenova/bert-base-NER` with `onnx-community/piiranha-v1-detect-personal-information-ONNX`

Proceed? (y/n)

User: y

Claude: ### Discovery
- Files to modify: src/hooks/useNERModel.ts, src/lib/entity-types.ts
- What exists: bert-base-NER pipeline with BIO tag merging
- Approach: Swap model ID, update label mapping for Piiranha's 17 PII types
- Estimated changes: medium
- Dependencies: none (same @huggingface/transformers)

[implements...]

## Task Complete: Phase 1.1 — Piiranha v1 Integration

### Changes Made
- src/hooks/useNERModel.ts: Swapped model, updated label mapping
- src/lib/entity-types.ts: Added MEDICAL, FINANCIAL categories

### Verification
- TypeScript: PASS
- Build: PASS

### Test This
1. Run `npm run dev`
2. Paste text with names, SSNs, medical terms
3. Expected: 17 PII types detected with high confidence

**Ready to commit and mark done?**

User: approved

Claude: ## Task Checked Off

Committed: a1b2c3d
ROADMAP: Phase 1.1 — Replace bert-base-NER with Piiranha v1 ✓

### Progress: Phase 1
[1/7] tasks complete (14%)

Proceed to next task? (y/n)
```
