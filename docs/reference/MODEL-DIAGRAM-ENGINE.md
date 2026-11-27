# Model-diagram engine: working notes

The 3D engine that draws any model written in the model-diagram format: a `<model>.model.yaml` spec, a `values/<input>.json` per input, and one `weights.json` per model. Started 2026-11-26. All paths below are under `frontend/` (`src/` for code). The engine is part of the public app; what reads a particular vault and places a drawing in a chapter lives with the extension that uses it.

## What exists

| File | Holds |
|---|---|
| `services/lego_blocks/units/modelDiagramFormatBlock.ts` | The format's parser and checker: refuses an unknown kind, a missing tensor, a shape that does not follow. |
| `services/lego_blocks/units/modelDiagramExportBlock.ts` | Packages a model as one self-contained HTML page. |
| `services/lego_blocks/integrations/modelDiagramEngineBundleBlock.ts`, `modelDiagramEnginePlugin.ts` | The engine as one script (the mount with three.js), built by the app's own Vite build as the module `virtual:model-diagram-engine`, behind a dynamic import. |
| `services/lego_blocks/units/modelDiagramLayoutBlock.ts` | Pure: a checked spec, optional values and the state (step in focus, row, column) go in; a 3D scene comes out as plain data. Every placement rule is here. |
| `services/lego_blocks/units/modelDiagramLabelsBlock.ts` | Pure: which labels stay put, which slide a line, which give way, in screen space. |
| `services/lego_blocks/units/modelDiagramTextsBlock.ts` | The standard words for each kind of part (chip, circle sign, explanation). |
| `services/lego_blocks/units/modelDiagramFontsBlock.ts` | IBM Plex as data URIs (generated). |
| `services/lego_blocks/units/modelDiagramStyleBlock.ts` | The stylesheet as one string, scoped under `.mdg`, light and dark tokens. |
| `services/lego_blocks/integrations/modelDiagramRendererBlock.ts` | three.js: draws a scene, flies, picks, places labels. Decides nothing about placement. |
| `services/lego_blocks/integrations/modelDiagramMountBlock.ts` | Framework-free `mountModelDiagram(el, props)`: strip, stage, buttons, cards. The export bundles this file. |
| `components/lego_blocks/integrations/ModelDiagramBlock.tsx` | Thin React shell; loads the mount on demand so three.js stays out of the startup bundle. |
| `tests/modelDiagramLayoutBlock.test.ts`, `tests/modelDiagramLabelsBlock.test.ts` | Unit tests. Fixture: `tests/fixtures/model-diagram-engine/` (a hand-written GPT-2 spec, values taken from the reference page). |
| `scripts/model-diagram-check.mjs` | Headless Chrome, no test framework: a screenshot of every step in light and dark, label overlaps, and the performance numbers. With `--ref` it shoots the reference page at the same steps. |
| `scripts/model-diagram-diff.py` | Image-by-image diff of those screenshots (needs Pillow). |

Public repo hook: `three@0.128.0` and `@types/three@0.128.0` in `frontend/package.json`, pinned.

## Decisions

- **The look is the reference page's.** A hand-built page, `gpt-with-sparse-network.html`, is the standard. The renderer keeps its camera, lights and materials, and three.js is pinned to r128, the version that page carries: newer three shades the same scene differently. The layout's constants (12 between bars, 30 between rows, where a branch sits above the stream) are that page's hand-placed numbers made into rules.
- **One op, several stops.** An `attention` op opens into Query, Key, Value, Similarity, Attention weights, Mix, Output layer; an `mlp` op into two. The component's `step` is the spec's step; the stop inside it is `part`.
- **Values by fixed names.** Inner tensors are looked up in `values.slices` as `<op>.q`, `.k`, `.v`, `.scores`, `.weights`, `.mixed`, `<mlp>.pre`, `.act`; weights as `<op>.<part>.weight` / `.bias` (`[out][in]`), a norm's as `<op>.weight` / `.bias`; a position table's picked rows as `<op>.rows`; the most likely tokens as `<unembed>.top`, `<output>.top`, `<unembed>.top.weight`. Optional extras read if present: `token_ids`, `labels`, `row_stats`. Without values the structure is drawn with flat tiles.
- **Columns drawn on a log scale**: every doubling of a row's true size adds four columns (768 draws 8, 3,072 draws 16), capped at 32. The true size is under every bar.
- **Labels.** What belongs to the step in focus always shows where the layout put it. Of the always-on labels, a step's title slides a line to find room and never hides; rulers and region names give way.
- **Batched drawing.** Every tile in the scene is one InstancedMesh; rods one per opacity; slab edges and thin lines one line set with per-vertex alpha. A frame is drawn only while something moves.
- **Values load after the first frame**, never before it.
- **Fonts.** IBM Plex Sans and Mono travel inside the engine as data URIs (`modelDiagramFontsBlock.ts`, generated from the @fontsource packages, OFL), so neither the app nor an exported page makes an outside request.

- **Towers are lanes.** An op that reads only an input (`patchify`, `embed`) starts a tower, laid out from its own origin to the right of the last one, so a vision-language model reads as regions: VISION TOWER, HAND-OVER (four or more steps after a tower's blocks, on a row of their own), LANGUAGE MODEL. A `join` of two towers gets an orange line from the other tower's last bar.
- **A row per branch.** A branch that is long, or is followed by another branch of the same block, hands the stream to a new row; every new block starts a row. A row whose branch is attention sits 44 below a row that is not, otherwise 30. Each kind of block is drawn once, its repeats as ghosts ("23 more running-memory blocks").
- **Memory** is one stop with its state drawn as a block of fixed size over the unit, with the state's true shape written on it.
- **Next-word passes.** With `prompt_tokens` and `top_by_pass` in the values, pass k draws the first prompt + k rows; the bar above the strip has Write the next word, Start over and Show what the new token touches.
- **Weights** come from the model's `weights.json`, merged into each input's values by the Textbooks side before the engine sees them (the check script does the same merge).
- **Rulers** are to one scale up to 3,072 and broken ("not to scale") above it, so no ruler is longer than 12.

## Not done

- Heads as a stack in depth with a head picker (the values carry all heads in `attention[op]`); attention drawn for head 1 only.
- A batch slider: the batch is drawn as slabs behind each bar, but only the first example's numbers are read.
- A click on a block opening its attention map or slice in a panel; the picture's tokens tinted among the words (`values.picture`); row names for chosen rows in square attention grids (`attention_row_ids`).
- The memory and the gated parts (`.gate`, `.write`, `.fade`, a gated MLP's `.up`) opened into their own stops.
- One label overlap is left in Qwen (step 31, a bar's name against the weights table's title).

## How to check

```
node scripts/model-diagram-check.mjs --ref "<path to>/gpt-with-sparse-network.html"
python3 scripts/model-diagram-diff.py
```
Screenshots and `report.json` land in `frontend/tests/.model-diagram-check/<name>/` (not committed).

## Second pass on Qwen (2026-11-26)

- Titles never overlap: a title moves whole lines, then half its width sideways, then shrinks to its number; a thin leader joins a moved title to its step. A model with more than 24 steps sets titles on one line (`scene.dense`).
- The legend comes from the model's axes (`scene.legend`); one tower keeps the reference's B, T, C lines.
- A memory op opens into six steps (read key, write key, what to write, fade then write, read scale and gate, output layer). Its state is a bank of small squares, one per head, the first 2 x 2 numbers of each from `<op>.state`.
- A gated MLP opens into four steps (gate layer, up layer, bend then multiply, layer down); gated attention gets a Gate step.
- Attention grids stand in a stack of heads; `state.head` picks the one in front (Previous head / Next head in the bar). A head with no saved map shows its last row from `attention_last_row`. A causal mask draws its stepped edge; an unmasked op draws none.
- Rows that are the picture's tokens (`values.picture.first_row..last_row`) are tinted orange and named "picture N".
- The engine reads `picture`, `attention_last_row`, `attention_last_row_every` and an op's `act` when present. The parser does not pass them on yet, so in the app those three show only after it does; the check script feeds the raw file.
- The check counts two labels as overlapping at more than 1 px each way (row names and table indices: 6 px down, as their line boxes touch on the reference too). `--steps`, `--themes`, `--quick` shorten a run.
- A click on a bar opens its saved numbers as a table under the drawing (`state.open`, `scene.open`); an attention grid opens as its map, tinted by weight. Close puts it away.
- When a values file holds a batch (a slice's `rows` is one block per example), a slider picks the example (`state.example`, `scene.examples`). No model's files hold one yet, so the slider has only been exercised by the unit test.
- Measured in the running app (Chrome, 120 Hz, 2x pixels, 2026-11-26): Qwen through all 55 steps, 8.7 ms average frame, 9.3 ms at the 95th percentile.
- **Full screen.** A "Full screen" button beside the zoom buttons lays the drawing over the whole window, as the app's own focus modes do (Escape leaves it). It does not use the display's full screen: that was tried and read as a different mode from the rest of the app. In full screen the strip is one scrolling line, the drawing takes the rest, and the words (the step's explanation, the weights, an opened table, the legend) wait in a side panel: a click on a block or a step's title brings it up, "Notes" toggles it, "Close" puts it away. The words live in one wrapper (`.side`) that is invisible to layout outside full screen.
- In dev, a change to an engine file drops the built single-file script, so an export after a page reload carries the new engine.
- **Labels keep off the drawing.** The renderer hands the placer the bars and circles as rectangles on screen (`walls`). A caption or title that can move finds a spot clear of labels and of the drawing; if there is none it settles for clear of labels. Fixed labels (a number beside its line) belong to the drawing and ignore the walls.
- **A step's numbers are spaced for the stage there is.** The mount passes the stage's size (`state.stage`, to 5 px) and lays the focused step out again when it changes; before, the spacing assumed a 785 px stage and the numbers ran into each other in a smaller window.
- **Row names thin out like axis ticks.** Row names and column numbers that cannot all fit are dropped in between (`thin`); the row in use always shows (`keep`).
- **The first step shows what goes in.** A tower that opens with a patch layer draws the picture's patches (the `pixels` slice) as a bar before it, and the step as the linear layer it is.
- The check takes `--size W,H` for a smaller window, and shoots the full-screen layouts.
- **The step in focus takes the room it needs.** Its numbers, table of weights and written-out sum can reach into where a neighbouring step's working part is drawn (Query over Key and Value). Inside that room (`focusBox`) a neighbour keeps its bar and gives up its circle, box, fan of lines and title.
