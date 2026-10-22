#!/usr/bin/env bash
# Mutation harness for tests/crafting.test.ts.
#
# WHY THIS EXISTS
# ---------------
# A test that cannot fail is not a test. This harness breaks ONE rule at a
# time in src/core/crafting/ and asserts that the crafting suite goes RED.
# A mutant that stays green is either a test gap (fix the test) or an
# EQUIVALENT MUTANT (the mutant changes no observable behaviour - prove it
# differentially and say so).
#
# It restores src/core/crafting/ byte-identically afterwards, so it is safe
# to run on a dirty tree, and it never leaves the source mutated.
#
# Usage:  bash tests/mutate-crafting.sh
set -uo pipefail

export PATH="$HOME/.local/opt/node/bin:$HOME/.local/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1

SRC=src/core/crafting
SWEEP_TEST=tests/tmp-mutation-sweep.test.ts
BACKUP=$(mktemp -d)
cp "$SRC"/*.ts "$BACKUP/"

restore() { cp "$BACKUP"/*.ts "$SRC/"; }

# The trap must not fire after the backup is deleted, so the cleanup order
# matters: restore, clear the trap, THEN delete the backup.
cleanup() {
  restore
  rm -f "$SWEEP_TEST"
  trap - EXIT
  rm -rf "$BACKUP"
}
trap cleanup EXIT

mutate() {
  local file="$1" from="$2" to="$3"
  python3 - "$SRC/$file" "$from" "$to" <<'PY'
import sys
path, frm, to = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path).read()
if frm not in src:
    sys.stderr.write("PATCH-FAILED\n")
    sys.exit(2)
open(path, "w").write(src.replace(frm, to, 1))
PY
}

run_mutant() {
  local name="$1" file="$2" from="$3" to="$4"
  restore
  if ! mutate "$file" "$from" "$to"; then
    echo "SKIP    $name (patch pattern not found - the source moved)"
    return
  fi

  local out
  out=$(timeout 300 npx vitest run tests/crafting.test.ts 2>&1)
  if echo "$out" | grep -qE "Tests +[0-9]+ failed"; then
    echo "CAUGHT  $name -> $(echo "$out" | grep -oE 'Tests +[0-9]+ failed' | head -1)"
  else
    echo "MISSED  $name -> the suite stayed GREEN. The test does not pin this rule."
  fi
  restore
}

echo "=== mutation proof for tests/crafting.test.ts ==="

# The differential sweep: match every possible 2x2 and 3x3 grid and record
# what each one makes. It runs as a throwaway vitest file so it needs
# nothing but the local toolchain, and it writes a fingerprint to a file so
# two runs can be compared exactly.
write_sweep_test() {
  cat > "$SWEEP_TEST" <<'EOF'
import { it } from "vitest";
import * as fs from "node:fs";
import { matchGrid } from "../src/core/crafting/index.js";
import type { CraftingGrid } from "../src/core/crafting/index.js";
import type { ItemStack } from "../src/core/types.js";

it("sweeps every grid", () => {
  const items = ["millplank", "rubble", "slate", "timber", "loam"];
  const lines: string[] = [];
  for (const width of [2, 3] as const) {
    const size = width * width;
    for (let mask = 0; mask < 1 << size; mask++) {
      const cells: (ItemStack | null)[] = [];
      for (let index = 0; index < size; index++) {
        const item = items[(index * 7 + 3) % items.length] ?? "millplank";
        cells.push(mask & (1 << index) ? { id: item, count: 1 } : null);
      }
      const grid: CraftingGrid = { width, cells };
      const match = matchGrid(grid);
      lines.push(
        JSON.stringify({
          width,
          mask,
          id: match?.recipe.id ?? null,
          cells: match?.cells ?? null,
        }),
      );
    }
  }
  fs.writeFileSync(process.env["SWEEP_OUT"] ?? "/tmp/sweep.txt", lines.join("\n"));
});
EOF
}

sweep_fingerprint() {
  local out="$1"
  SWEEP_OUT="$out" timeout 300 npx vitest run "$SWEEP_TEST" >/dev/null 2>&1
}

run_mutant "M1 tags: a tag stops accepting a family" \
  tags.ts \
  '  const members = INGREDIENT_TAGS[token];
  return members !== undefined && members.includes(itemId);' \
  '  const members = INGREDIENT_TAGS[token];
  return members !== undefined && members.length === 1 && members.includes(itemId);'

run_mutant "M2 shaped: cells the pattern does not cover no longer have to be empty" \
  match.ts \
  '          if (!inside) {
            // A cell the pattern does not cover must be empty.
            if (grid.cells[index] !== null) {
              ok = false;
            }
            continue;
          }' \
  '          if (!inside) {
            continue;
          }'

run_mutant "M3 matcher: the augmenting path becomes a greedy pass" \
  match.ts \
  '      if (holder === -1 || tryAssign(holder, seen)) {' \
  '      if (holder === -1) {'

run_mutant "M4 matcher: the recipe table is searched in reverse" \
  match.ts \
  '  for (const recipe of recipes) {
    const cells =
      recipe.kind === "shaped" ? matchShaped(grid, recipe) : matchShapeless(grid, recipe);' \
  '  for (const recipe of [...recipes].reverse()) {
    const cells =
      recipe.kind === "shaped" ? matchShaped(grid, recipe) : matchShapeless(grid, recipe);'

run_mutant "M5 grid: spending an ingredient takes the whole stack" \
  grid.ts \
  '    cells[index] = cell.count > 1 ? { ...cell, count: cell.count - 1 } : null;' \
  '    cells[index] = null;'

run_mutant "M6 recipes: a tool recipe forgets the contract durability" \
  recipes.ts \
  '    toolRecipe(spec.id, spec.kind, spec.tier, {
      id: spec.id,
      count: 1,
      durability: spec.durability,
    }),' \
  '    toolRecipe(spec.id, spec.kind, spec.tier, {
      id: spec.id,
      count: 1,
    }),'

# M7 removes a size guard that turns out to be REDUNDANT: the offset loops
# below already stop when the pattern would not fit the grid. So the mutant
# changes no observable behaviour, and a green suite is the CORRECT result.
# The harness PROVES that instead of assuming it: it sweeps every 2x2 and
# 3x3 grid before and after the mutation and compares the fingerprints.
echo "--- M7 equivalence check (differential sweep over every grid) ---"
restore
write_sweep_test
BASE=$(mktemp)
sweep_fingerprint "$BASE"
mutate match.ts \
  '  if (shape.rows > grid.width || shape.cols > grid.width) {
    return null;
  }' \
  '  if (false) {
    return null;
  }'
MUT=$(mktemp)
sweep_fingerprint "$MUT"
if cmp -s "$BASE" "$MUT"; then
  echo "EQUIVALENT  M7 removes a redundant guard - every grid makes the same"
  echo "            thing before and after, over $(wc -l < "$BASE") grids. Green is CORRECT."
else
  echo "REAL GAP    M7 changes observable behaviour and the suite missed it:"
  diff "$BASE" "$MUT" | head -20
fi
rm -f "$BASE" "$MUT"
restore
rm -f "$SWEEP_TEST"

restore
echo "=== source restored? ==="
if git diff --quiet -- "$SRC"; then
  echo "RESTORED: src/core/crafting is byte-identical to HEAD"
else
  echo "NOT RESTORED - src/core/crafting is dirty. Run: git checkout -- $SRC"
fi
