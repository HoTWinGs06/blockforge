# Gameplay handoff

## T81 — M3/GAMEPLAY: crafting

**Branch:** `feature/gameplay/m1` · **Commit:** see the board note for T81
(the SHA is the one to merge downstream).

### What landed

A pure, deterministic crafting engine in `src/core/crafting/`, and the
gameplay-layer session on top of it in `src/gameplay/crafting.ts`.

```
src/core/crafting/tags.ts     ingredient tags ("#rock" accepts slate or rubble)
src/core/crafting/grid.ts     the 2x2 and 3x3 grids, and cell operations
src/core/crafting/recipes.ts  the recipe table (16 tools derived, 4 building blocks)
src/core/crafting/match.ts    shaped + shapeless matching, recipe book queries
src/core/crafting/index.ts    the module's public surface
src/gameplay/crafting.ts      the session: what the player can make, and making it
scripts/selfcheck/craftingCheck.ts  51 assertions, run by `npm run gate:selfcheck`
```

### The API the screen needs (RENDER/UI, task T84)

Everything the crafting screen needs is in `src/core/crafting/index.ts`, and
the screen-facing wrapper is `src/gameplay/crafting.ts`:

| Call | Answers |
|---|---|
| `recipeBook(stacks)` | which recipes the player can make from what they carry, in table order |
| `preview(grid)` | what this grid would make, and which cells it would use |
| `craft(grid)` | make it: the ingredients leave the grid, the result comes out |
| `recipePattern(recipe)` | the recipe's shape as a 3x3 grid of tokens (or null) for the recipe book |
| `gridSize(hasCraftbench)` | 2 in the inventory, 3 at a craftbench |

A `CraftingGrid` is `{ width: 2 \| 3, cells: (ItemStack \| null)[] }` with the
cells in row-major order. `createGrid(width)`, `gridAt`, `gridWith` and
`gridWithout` build and edit them. Nothing mutates in place — every function
returns a new grid.

The ingredient tokens in a recipe are either an exact item id (`"timber"`) or
a tag (`"#plank"`, `"#rock"`, `"#soil"`, `"#wood"`). A tag accepts a family
of items, which is how a recipe asks for "any rock" instead of one exact
block. The tag vocabulary is in `src/core/crafting/tags.ts`.

### How matching works

* **Shaped** — the recipe's pattern may sit anywhere in the grid, but every
  cell the pattern does *not* cover must be empty. A 2x2 pattern in a 3x3
  grid therefore has to be in a corner.
* **Shapeless** — the items may sit anywhere; only the multiset matters.
* A 3x3 recipe does not match a 2x2 grid. That single rule is what makes a
  craftbench worth finding.
* The tokens of a recipe are matched to the items with a real augmenting-path
  matching, not a greedy pass: a recipe needing `["#rock", "slate"]` against
  a grid holding slate and rubble must give `#rock` the rubble and `slate`
  the slate, and greedy would take the slate first and fail.

### Determinism

Crafting is pure. The same grid and the same table always give the same
recipe and always consume the same cells; the recipe table is searched in a
fixed order, so a grid that satisfies two recipes always gives the same one.
No ingredient is ever consumed at random. The frozen `Recipe` has no chance
field, so there is no chance-based output to roll — and if one is ever added
to the contract, its roll must come from the seeded PRNG in
`src/core/rng.ts`, never `Math.random()`.

### The recipes

The four building blocks are written out; the sixteen tool recipes are
**derived** from the contract's `TOOL_SPECS`, so a tool added to the
contract gets a recipe automatically and the recipe can never disagree with
the tool it makes. Each tool recipe carries the tool's own durability.

| Recipe | Shape | Makes |
|---|---|---|
| `millplank_from_timber` | shapeless, 1 | 4 millplank |
| `craftbench` | 2x2 of any plank | 1 craftbench |
| `masonry` | 2x2 of any rock | 1 masonry |
| `smeltforge` | 3x3 ring of any rock | 1 smeltforge |
| the 16 tools | per kind, per tier | 1 tool, with its durability |

The tool shapes are per KIND (mattock, billhook, trowel, maul — the sabre
has no spec and so no recipe) and the head material is per TIER: timber is
millplank, slate is `#rock` (so rubble will do), ironveil is ironveil,
lumencrystal is lumencrystal. The handle is always any plank.

### How it was verified

* `npm run typecheck` — exit 0.
* `npm run lint` — exit 0 (the 7 warnings are pre-existing, in `verify.mjs`).
* `npx vitest run` — 224 passed, 16 files, exit 0. The purity scanner walks
  `src/core/` recursively, so it scanned the four new core files and found
  nothing.
* `npm run build` — exit 0.
* `npm run gate:selfcheck` — the new `craftingCheck.js` runs **51 assertions,
  all passing**, exit 0. It covers: a shaped recipe matching only where its
  pattern is; a stray item blocking a 2x2 pattern in a 3x3; a shapeless
  recipe matching wherever the item sits; a tag accepting both slate and
  rubble; a 3x3 recipe refusing a 2x2 grid; all sixteen frozen tools having
  a recipe with the contract's durability; the same grid always matching
  the same cells; and the grid helpers not mutating their input.

### What it blocks, and what it needs

* **The TEST AUTHOR needs to cover `src/core/crafting/`.** The vitest
  coverage config counts every file under `src/core/`, so the four new
  untested files drop the global figure from 92.74% to 76.41% and the 85%
  floor (gate G1) fails. This is the same situation as T55 (the engine's
  core landed without tests and the floor correctly failed). A TEST AUTHOR
  task was filed for it. The 51 assertions in `craftingCheck.ts` are a
  self-check, not a substitute: they run in `gate:selfcheck`, not in the
  coverage gate.
* **RENDER/UI (T84)** builds the screen against the API table above. The
  grid is 2x2 in the inventory and 3x3 at a craftbench; the recipe book
  needs `recipePattern` to draw the shape and `recipeBook` to list what is
  affordable.
* **T82 (tools)** — the tool recipes are already here, so that task is about
  mining with a tool, the durability decrement, and the tool going in the
  hotbar, not about writing the recipes.
* **T80 (drops and inventory)** is still `doing` and not merged. Nothing in
  this task depends on it, but the crafting screen will need the inventory
  to have items in it before a player can craft anything.

### For the ARCHITECT

One line in `src/core/index.ts` (owned by the ARCHITECT) would put the
crafting surface in the main core barrel with the rest of the core API:

```ts
export * from "./crafting/index.js";
```

Until then, import it as `../core/crafting/index.js`. The note is at the top
of `src/core/crafting/index.ts` too.

### A pre-existing failure, not mine

`npm run gate:selfcheck` (and `gate:bench`, `gate:determinism`) fail at the
`tsc` step with:

```
scripts/tsconfig.build.json(3,3): error TS5096: Option 'allowImportingTsExtensions'
can only be used when either 'noEmit' or 'emitDeclarationOnly' is set.
```

This is reproducible with my changes stashed — it is on the branch already.
`scripts/tsconfig.build.json` extends the root `tsconfig.json`, which sets
`allowImportingTsExtensions: true`, and the script config sets `noEmit:
false` to emit the JS. The two conflict. The fix belongs to whoever owns
`scripts/tsconfig.build.json`; it is not in my area, so I did not touch it.
The self-check still runs because `tsc` emits the JS before it reports the
error, so `node .../craftingCheck.js` works and passes 51 assertions.
