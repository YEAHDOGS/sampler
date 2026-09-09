# Sampler branch consolidation — inventory & merge plan

**Snapshot:** 2026-09-09 (worker sweep). Master is still the 1-commit "Initial Commit"; no production merge has happened yet.

## The short version

A prior sweep already did the consolidation. Everything the founder asked about — `jack/sampler-sweep2`, `jack/sampler-cache`, `jack/sampler-analysis`, `swarm/org-audit-sampler` — is **fully merged into `jack/sampler-consolidated`** (zero leftover commits on any of them). Two newer additions sit on top, and one old branch is superseded.

## Branch inventory

| Branch | Commits vs master | What it adds | Test status | Verdict |
|---|---|---|---|---|
| `jack/sampler-sweep2` | 20 | Search service, Freesound edge-case tests, Internet Archive query escaping, page_size clamp, start scripts, README quickstart, MIT LICENSE | green (merged) | **Folded** — 0 commits not in `consolidated` |
| `jack/sampler-cache` | 22 | `sweep2` + filter/sort lib, SearchView UI, sample formatting, offline fallback fixtures, device-local search cache | green (merged) | **Folded** — 0 commits not in `consolidated` |
| `jack/sampler-analysis` | 38 | `cache` + client-side BPM/key detection, slice-point detection, "Find similar" ranking, JSON/CSV export (CLI + UI), tempo-sweep regression tests | green (merged) | **Folded** — 0 commits not in `consolidated` |
| `swarm/org-audit-sampler` | 6 | Early audit fixes (i18n, webmanifest, component tweaks) | green (merged) | **Folded** — 0 commits not in `consolidated` |
| `jack/sampler-consolidated` | 45 | Everything above, unified: 44 files, +5743/−46, full suite green | **145/145 tests pass** (`test:smoke` runs both node:test suites) | Ready for PR |
| `jack/sampler-suggest-next` | 48 | `consolidated` + suggestNext ranking lib (tempo/key reason codes), "Suggest next" button + top-3 panel, lowlevel timbre ranking (roadmap slice 5), en/es strings | green — smoke shows **fail 0** | Tip is the **recommended PR source** |
| `jack/sampler-dvh-tests` | — | 4 early commits (dvh CSS fix, LanguageSelector a11y, BOM strip, zero-dep smoke suite) | green when current | **Superseded** — equivalent changes already live in `consolidated` (verified: `h-dvh` in App.svelte, `onclick` LanguageSelector, 145-test suite) |

## Genealogy (verified via `git rev-list`)

```
sweep2 ⊂ cache ⊂ analysis ⊂ consolidated ⊂ suggest-next
swarm/org-audit-sampler ⊂ consolidated
jack/sampler-dvh-tests — divergent ancestor, content duplicated in consolidated
```

## Conflict analysis (verified via `git merge-tree`)

- Merging `jack/sampler-suggest-next` into `jack/sampler-consolidated`: **0 conflicts** (expected — consolidated is its ancestor).
- Every branch named above merges cleanly; there is no competing-line work to resolve.

## Secret scan (2026-09-09)

Grep over `src test tests bin docs README.md .env.example` for token/private-key patterns (`ghp_*`, `sk-*`, `AKIA`, `-----BEGIN ... PRIVATE KEY`, hard `VITE_*` assignments) against all branch diffs: **clean**. Keys ship via `.env.example` placeholders only.

## Recommended merge order

1. **One PR:** `jack/sampler-suggest-next` → `master` (48 commits, 48 files, +6766/−46, 145/145 tests green). The tip contains all consolidated work, so a single PR carries everything.
2. After approval, optionally delete the dead branches: `jack/sampler-sweep2`, `jack/sampler-cache`, `jack/sampler-analysis`, `swarm/org-audit-sampler`, `jack/sampler-dvh-tests` (all content preserved in the merged tip; nothing lost).
3. Do not push `master` directly — production requires PR + Brandon's approval (unchanged).

## ❓ Yes/no question for Brandon

> Approve a single PR from `jack/sampler-suggest-next` (tip `0044029`) to `master` — 48 commits, +6766/−46, all 145 smoke tests green — and then delete the five dead feature branches? **Yes / No.**
