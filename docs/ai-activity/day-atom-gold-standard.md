# AI-Activity day-atom + range-summary gold standard

Purpose: capture hand-written "gold" outputs for the day-atom contract and any
downstream range summaries, so we can iterate the prompt (especially for the
local Qwen model) against real examples instead of vibes.

## Sample set

Nine days, three projects, spread across low/medium/high chain counts so the
prompt has to handle both "1 focused chain" and "sprawling multi-thread" days.

| Project              | Date       | Chains | Sample file |
|----------------------|------------|-------:|-------------|
| Thinking-Space       | 2026-06-26 |      1 | [samples/Thinking-Space/2026-06-26.md](samples/Thinking-Space/2026-06-26.md) |
| Thinking-Space       | 2026-07-02 |      4 | [samples/Thinking-Space/2026-07-02.md](samples/Thinking-Space/2026-07-02.md) |
| Thinking-Space       | 2026-06-19 |      7 | [samples/Thinking-Space/2026-06-19.md](samples/Thinking-Space/2026-06-19.md) |
| F9                   | 2026-06-11 |      2 | [samples/F9/2026-06-11.md](samples/F9/2026-06-11.md) |
| F9                   | 2026-06-28 |      2 | [samples/F9/2026-06-28.md](samples/F9/2026-06-28.md) |
| F9                   | 2026-06-24 |      3 | [samples/F9/2026-06-24.md](samples/F9/2026-06-24.md) |
| Understanding_Myself | 2026-06-11 |      1 | [samples/Understanding_Myself/2026-06-11.md](samples/Understanding_Myself/2026-06-11.md) |
| Understanding_Myself | 2026-07-02 |      1 | [samples/Understanding_Myself/2026-07-02.md](samples/Understanding_Myself/2026-07-02.md) |
| Understanding_Myself | 2026-07-03 |      4 | [samples/Understanding_Myself/2026-07-03.md](samples/Understanding_Myself/2026-07-03.md) |

Each sample file contains:
1. **Inputs** — the raw chain-digest markdown for that project+day, exactly as
   the day-atom contract will see them.
2. **Gold-standard day atom** — hand-write `HEADLINE` and `WHY IT MATTERS`
   you'd want the model to produce given those inputs. This is the target.
3. **Model output** — paste actual outputs after runs, so drift is visible in
   diffs.

## Iteration loop

1. Fill in the gold answers (all 9 samples).
2. Freeze v1 of the prompt (current `dayAtomContract`) and run it on all 9
   inputs — paste outputs.
3. Read the diffs; note failure modes (wrong headline scope, generic why,
   missing key theme, hallucinated detail).
4. Revise `dayAtomContract.systemPrompt` / `userPrompt` to address the biggest
   miss, bump `promptVersion`, re-run.
5. Repeat until the gold vs. model diff is stylistic-only.

## Notes on gold-writing (for future me)

- **HEADLINE** should be one short line — same tone as a chain-digest title,
  but for the whole day. If the day was one thing, it's basically the chain
  title; if the day was many things, name the theme, not a list.
- **WHY IT MATTERS** answers "why should I care about this day two weeks from
  now?" — the *significance*, not a bullet summary. Cite the concrete thing
  that changed only if it changes what future-you would decide.
- If the day is genuinely noise (one 5-min drive-by chain), the gold answer
  should say so plainly — that's a signal the atom should be de-emphasized in
  the UI, not that the prompt failed.

## Range summaries (later)

Once day atoms are solid, compose them into week/month atoms with the same
gold-standard scaffold — pick a couple of weeks that span the sample days
above so gold answers can chain from day-level to week-level.
