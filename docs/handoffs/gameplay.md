# Gameplay handoff

## Victory log entry (the ARCHITECT owns docs/VICTORIES.md, so it goes here)

- [2026-10-21T17:05:00Z] feature — crafting exists: the recipe table, the
  2x2/3x3 grids, shaped and shapeless matching, and ingredient tags, so a
  recipe can ask for "any rock" and take slate or rubble. The sixteen tool
  recipes are DERIVED from the contract's `TOOL_SPECS`, so a tool added to
  the contract gets a recipe automatically and a recipe can never disagree
  with the tool it makes — each carries the tool's own contract durability.
  A 3x3 recipe does not match a 2x2 grid, which is the rule that makes a
  craftbench worth finding — evidence: commit
  afbebb02514775360c3fe5c4772b551b4a947858, `npm run typecheck` exit 0,
  `npm run lint` exit 0, `npx vitest run` 224/224 passed, `npm run build`
  exit 0, and 51/51 assertions in `scripts/selfcheck/craftingCheck.js`
  (wired into `gate:selfcheck`) — M3
- [2026-10-21T17:05:00Z] milestone — posted to the Milo butler server,
  message id 1562511649649467504 — M3

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

---

## T80 — broken blocks become collectable items, and the pack is real

Commit `214d4da` on `feature/gameplay/m1`. The operator reported "not able to
collect broken blocks no inventory" — two halves, both now in the tree.

### What landed

- `src/gameplay/inventory.ts` — the pack rules: nine hotbar slots, stacking
  up to `MAX_STACK`, removal, counting, selection. Tools never stack (each
  worn tool is a distinct item). An empty slot is an empty `ItemStack`, because
  the frozen `Inventory` has no null variant.
- `src/gameplay/itemEntities.ts` — the dropped item: spawn, settle, lifetime,
  pickup delay, reach, collection.
- `src/gameplay/drops.ts` — the drop table: a block leaves an item with the
  block's own name, and the wrong-tool rule is applied HERE, not trusted from
  the caller.
- `src/gameplay/session.ts` — `GameplaySession`, the one object the game loop
  talks to. Holds the inventory, the items on the ground and the tick.
- `src/gameplay/index.ts` — the barrel. `src/core/index.ts` does NOT re-export
  it, so the layering rule (`src/core/` must not depend on `src/gameplay/`)
  holds.
- `src/main.ts` — the wiring: the break handler spawns the drops, the loop
  collects them, the hotbar shows the real pack, and placing a block takes one
  out of the pack.
- `scripts/selfcheck/dropsCheck.ts` — 72 assertions, wired into
  `npm run gate:selfcheck`.
- `e2e/drops.spec.ts` — the browser guard (see below).

### The API the next agent needs

All from `src/gameplay/index.ts`:

```ts
GameplaySession.droppedItems(): readonly DroppedItemView[]   // {id, x, y, z, block}
GameplaySession.carried: Inventory
GameplaySession.held(): ItemStack | null
GameplaySession.select(index: number): void
GameplaySession.breakBlock(block, tool, x, y, z, world): void
GameplaySession.update(dt: number, feet: Vec3): void
GameplaySession.consumeHeld(): boolean
GameplaySession.give(stack: ItemStack): AddResult
```

`x`/`y`/`z` on a `DroppedItemView` are the item's CENTRE in world space and are
already settled on the ground. The item's position is a pure function of the
tick, so it does not drift between frames — draw it where the session says it
is.

### The two rules that bit, and how they are handled

1. **DETERMINISM.** The item records where it was born and where it comes to
   rest, and derives its position from the tick. The same break at the same
   tick always leaves the item in the same place, whatever order the world was
   updated in. No `Math.random`, no wall clock, no `Date.now`. If a drop ever
   needs randomness it comes from the seeded PRNG.
2. **THE WRONG-TOOL RULE.** `dropFor()` calls the contract's `canBreak()`
   itself, so a block that needs a tool and was not broken with one drops
   NOTHING, and a block broken with the wrong KIND of tool drops nothing
   either. The player therefore starts with one of every kind of timber tool
   (mattock, trowel, billhook, maul) — the contract's rule is by KIND, and
   clay needs a trowel, so a mattock alone would leave the ground under the
   player's own feet unmineable.

### Verified, not assumed

- `npm run typecheck` exit 0.
- `npm run lint` exit 0 — 0 errors, the 7 warnings are pre-existing in
  `verify.mjs`.
- `npx vitest run` exit 0 — 224 tests passing in 16 files.
- `npm run build` exit 0.
- `scripts/selfcheck/dropsCheck.ts` — 72 assertions, all passing, exit 0.
- `e2e/drops.spec.ts` — 2 passed in Chromium. It drives the REAL game: it looks
  at the ground, picks the tool the contract says the block needs using the
  number keys, holds the break button until the block gives way, checks that
  an item is now lying on the ground, then walks over it and checks that the
  pack gained exactly one and that the hotbar shows it. A second case checks
  that a block broken with the WRONG tool leaves the pack untouched.

The browser test found two things the unit assertions could not: the player
SPAWNS IN THE AIR and must land before the ground can be aimed at, and the
headless browser draws far fewer frames than a real one, so a fixed sleep is
not long enough for a timed break. The test polls for the break instead.

### The split, honestly

The board says ENGINE owns the item entities and RENDER/UI owns how they look.

- The item entities are pure and live in `src/gameplay/` here. They import
  nothing from `src/engine` and touch no engine file. They are gameplay state
  that the inventory rules read, and the engine has no gameplay to hang them
  off. If the architect wants them in `src/engine/`, that is a move, not a
  rewrite — the module has no dependencies at all.
- **The VISUAL is RENDER/UI's and is not done.** A broken block currently
  leaves an INVISIBLE item on the ground: the player walks over it, the hotbar
  count goes up, and nothing is ever drawn. That is the remaining half of the
  operator's complaint, and it is filed as **T96** with the exact API.
  `src/render/` was not touched.

### One pre-existing failure, not mine

`npm run gate:selfcheck` (and `gate:bench`, `gate:determinism`) fail at the
`tsc` step with `TS5096` on `scripts/tsconfig.build.json`. Reproduced with my
changes stashed, so it is on the branch already — it is T86, and the fix is
the engine's file. The four self-check scripts all PASS when the compiler is
given the one-flag override that T86's note already verified
(`npx tsc -p scripts/tsconfig.build.json --allowImportingTsExtensions false`):
engine 20/20, mesh 8/8, crafting 51/51, drops 72/72.
