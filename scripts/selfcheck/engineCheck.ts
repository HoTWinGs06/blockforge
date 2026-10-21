/**
 * Engine self-check: raycast and physics.
 *
 * Verifies the properties the renderer and the gameplay agent depend on:
 *   - a ray hits the block it is aimed at, with the right face normal;
 *   - the placement cell is the empty neighbour of the hit block;
 *   - a body falls under gravity and comes to rest on solid ground;
 *   - a body cannot walk through a wall.
 *
 * Build and run:
 *   npx tsc -p scripts/tsconfig.build.json
 *   node .build/scripts/selfcheck/engineCheck.js
 */

import { raycast, placementCell } from "../../src/core/raycast.js";
import {
  World,
  chunkIndex,
  createChunk,
  generateChunk,
  getBlock,
  setBlock,
  terrainHeight,
} from "../../src/core/world.js";
import { stepPhysics, bodyAabb, collides, solidWorldFromBlocks } from "../../src/core/physics.js";
import { fbm2, valueNoise2, valueNoise3 } from "../../src/core/noise.js";
import { createRng } from "../../src/core/rng.js";
import { BlockId, SOLID_BLOCKS } from "../../src/core/types.js";
import { CHUNK_SIZE_Y, blockIndex } from "../../src/core/constants.js";

let failures = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    process.stdout.write(`  ok   ${name}\n`);
  } else {
    failures++;
    process.stderr.write(`  FAIL ${name} ${detail}\n`);
  }
}

process.stdout.write("engine self-check\n");

// A tiny hand-built world: a floor at y=0 and a wall at x=2.
const solid = new Set([
  "0,0,0",
  "1,0,0",
  "2,0,0",
  "3,0,0",
  "2,1,0",
  "2,2,0",
]);
const world = {
  blockAt(x: number, y: number, z: number): BlockId {
    return solid.has(`${x},${y},${z}`) ? BlockId.Rubble : BlockId.Air;
  },
  isSolid(x: number, y: number, z: number): boolean {
    return solid.has(`${x},${y},${z}`);
  },
};

// 1. Raycast hits the block it is aimed at. The ray starts in air, above
// the floor, and travels along +X into the wall at x=2.
{
  const hit = raycast(
    { origin: { x: 0.5, y: 1.5, z: 0.5 }, direction: { x: 1, y: 0, z: 0 } },
    world,
    10,
    (b) => SOLID_BLOCKS.has(b),
  );
  check(
    "ray hits the block in front of it",
    hit !== null && hit.x === 2 && hit.y === 1 && hit.z === 0,
    JSON.stringify(hit),
  );
  check(
    "hit normal points back at the ray",
    hit !== null && hit.normal.x === -1 && hit.normal.y === 0 && hit.normal.z === 0,
  );
  const place = hit ? placementCell(hit) : null;
  check(
    "placement cell is the empty neighbour",
    place !== null && place.x === 1 && place.y === 1 && place.z === 0,
  );
}

// 2. A ray that misses hits nothing.
{
  const hit = raycast(
    { origin: { x: 0.5, y: 1.5, z: 0.5 }, direction: { x: 0, y: 1, z: 0 } },
    world,
    10,
    (b) => SOLID_BLOCKS.has(b),
  );
  check("a ray into empty space hits nothing", hit === null);
}

// 3. A body falls and lands on the floor.
{
  let position = { x: 0.5, y: 5, z: 0.5 };
  let velocity = { x: 0, y: 0, z: 0 };
  let onGround = false;
  for (let i = 0; i < 200 && !onGround; i++) {
    const step = stepPhysics(position, velocity, 1 / 60, world);
    position = step.position;
    velocity = step.velocity;
    onGround = step.onGround;
  }
  check("a falling body comes to rest on the ground", onGround);
  check(
    "the body rests on top of the floor block",
    Math.abs(position.y - 1) < 1e-6,
    `y=${position.y}`,
  );
}

// 4. A body cannot walk into a wall, and stops flush against it.
{
  let position = { x: 0.5, y: 1, z: 0.5 };
  let velocity = { x: 4, y: 0, z: 0 };
  for (let i = 0; i < 60; i++) {
    const step = stepPhysics(position, velocity, 1 / 60, world);
    position = step.position;
    velocity = step.velocity;
  }
  // The wall occupies x in [2, 3). A body of half-width 0.3 stops with its
  // front face exactly on the wall: x + 0.3 == 2, so x == 1.7.
  check(
    "a body is stopped flush against a wall",
    Math.abs(position.x - 1.7) < 1e-6,
    `x=${position.x}`,
  );
}

// 5. The collision box is where it should be.
{
  const box = bodyAabb({ x: 1, y: 2, z: 3 });
  check(
    "the collision box is centred on the feet",
    box.minX === 1 - 0.3 && box.maxX === 1 + 0.3,
  );
  check(
    "the collision box stands on the feet",
    box.minY === 2 && box.maxY === 2 + 1.8,
  );
  check("the body does not start inside a wall", !collides(box, world));
}

// 6. The world hash is seed-sensitive even before any chunk is loaded.
// A hash that ignored the seed would be the same constant for every seed.
{
  const emptyA = new World(1337).hash();
  const emptyB = new World(4242).hash();
  check("an empty world still hashes differently per seed", emptyA !== emptyB, `${emptyA} vs ${emptyB}`);

  const loadedA = new World(1337);
  const loadedB = new World(1337);
  for (const key of [{ cx: 0, cz: 0 }, { cx: 1, cz: 0 }]) {
    loadedA.getChunk(key);
    loadedB.getChunk(key);
  }
  check("the same seed and chunks hash the same", loadedA.hash() === loadedB.hash());
  check("loading a chunk changes the hash", loadedA.hash() !== emptyA);
}

// 7. fbm2 must not return NaN for a non-positive octave count (E1). A NaN
// height propagates into every block placement, so it must be impossible.
{
  const zero = fbm2(1234, 10.5, 20.5, 0);
  const negative = fbm2(1234, 10.5, 20.5, -3);
  check("fbm2 with zero octaves is not NaN", !Number.isNaN(zero), String(zero));
  check("fbm2 with negative octaves is not NaN", !Number.isNaN(negative), String(negative));
}

// 8. fork() must depend only on (seed, label), not on the parent's history
// (E2). Consuming the parent must not change what a child stream produces.
{
  const early = createRng(42);
  const childEarly = early.fork("terrain");
  early.nextUint32();
  const late = createRng(42);
  late.nextUint32();
  const childLate = late.fork("terrain");

  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) a.push(childEarly.nextUint32());
  for (let i = 0; i < 4; i++) b.push(childLate.nextUint32());
  check("a forked stream does not depend on the parent's history", a.join(",") === b.join(","));

  const parent = createRng(42);
  const first = parent.fork("terrain");
  const second = parent.fork("terrain");
  const c: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < 4; i++) c.push(first.nextUint32());
  for (let i = 0; i < 4; i++) d.push(second.nextUint32());
  check("two forks of the same label give the same stream", c.join(",") === d.join(","));
  check("fork does not advance the parent", parent.getState().state === 42);
}

// 9. A body moving fast must not tunnel through a one-block floor.
{
  const floor = solidWorldFromBlocks([
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
  ]);
  let landed = false;
  let y = 20;
  let velocity = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 500 && !landed; i++) {
    const step = stepPhysics({ x: 0.5, y, z: 0.5 }, velocity, 1, floor);
    y = step.position.y;
    velocity = step.velocity;
    landed = step.onGround;
  }
  check("a body falling with a huge dt lands on the floor", landed, `y=${y}`);
  check("the body did not fall through the floor", Math.abs(y - 1) < 1e-6, `y=${y}`);
}

// 10. chunkIndex() must not bypass the frozen blockIndex() guard (E3).
// An unchecked index aliases: chunkIndex(16,0,0) used to return 16, the
// storage slot of block (0,0,1), so an out-of-range x silently wrote into
// a different block's slot.
{
  const threwForX = (() => {
    try {
      chunkIndex(16, 0, 0);
      return false;
    } catch {
      return true;
    }
  })();
  check("chunkIndex throws for an out-of-range x", threwForX);

  const threwForY = (() => {
    try {
      chunkIndex(0, CHUNK_SIZE_Y, 0);
      return false;
    } catch {
      return true;
    }
  })();
  check("chunkIndex throws for an out-of-range y", threwForY);

  const threwForNegative = (() => {
    try {
      chunkIndex(-1, 0, 0);
      return false;
    } catch {
      return true;
    }
  })();
  check("chunkIndex throws for a negative coordinate", threwForNegative);

  const threwForFractional = (() => {
    try {
      chunkIndex(1.5, 0, 0);
      return false;
    } catch {
      return true;
    }
  })();
  check("chunkIndex throws for a fractional coordinate", threwForFractional);

  // The in-range answer is unchanged, and it is the frozen one.
  check(
    "chunkIndex still agrees with the frozen blockIndex",
    chunkIndex(1, 2, 3) === blockIndex(1, 2, 3),
  );

  // The tolerant surface is unchanged: out of range reads air, and an
  // out-of-range write changes nothing.
  const chunk = createChunk({ cx: 0, cz: 0 });
  check("getBlock reads air outside the chunk", getBlock(chunk, 16, 0, 0) === 0);
  setBlock(chunk, 16, 0, 0, BlockId.Rubble);
  check("setBlock outside the chunk writes nothing", getBlock(chunk, 0, 0, 1) === 0);
}

// 11. The noise hash must not alias coordinates or seeds past int32 (E4).
// The old hash truncated the lattice coordinate with `x | 0` and coerced the
// seed with `^`, so the terrain repeated with a period of 2^32 blocks and
// two world seeds 2^32 apart produced byte-identical terrain. A pure
// function that is silently periodic is the worst kind of bug for a
// determinism-driven project: it passes every hash test and is still wrong.
{
  const TWO_POW_32 = 4294967296;
  const base = valueNoise2(1234, 10.5, 20.5);

  // The verifier's original repro: the coordinate aliases past int32.
  check(
    "valueNoise2 does not alias x at +2^32",
    base !== valueNoise2(1234, 10.5 + TWO_POW_32, 20.5),
  );
  check(
    "valueNoise2 does not alias z at +2^32",
    base !== valueNoise2(1234, 10.5, 20.5 + TWO_POW_32),
  );
  check(
    "valueNoise2 does not alias +2^31 onto -2^31",
    valueNoise2(5, 2147483648, 0) !== valueNoise2(5, -2147483648, 0),
  );

  // The seed is an input too: the old `^` coerced it to int32, so seed 0
  // and seed 2^32 gave the same terrain.
  check(
    "valueNoise2 does not alias the seed at +2^32",
    valueNoise2(0, 10.5, 20.5) !== valueNoise2(TWO_POW_32, 10.5, 20.5),
  );
  check(
    "fbm2 does not alias the seed at +2^32",
    fbm2(0, 10.5, 20.5, 1) !== fbm2(TWO_POW_32, 10.5, 20.5, 1),
  );

  // The octave index is a separate hashed input, so a (seed, octave) pair
  // cannot collide with another one through an overflowing addition.
  check(
    "fbm2 does not alias a (seed, octave) pair",
    fbm2(0, 10.5, 20.5, 1) !== fbm2((2 * 0x9e3779b9) % TWO_POW_32, 10.5, 20.5, 1),
  );

  // The 3D hash had the same truncation on all three axes.
  check(
    "valueNoise3 does not alias x, y or z at +2^32",
    valueNoise3(1234, 10.5, 3.5, 20.5) !== valueNoise3(1234, 10.5 + TWO_POW_32, 3.5, 20.5) &&
      valueNoise3(1234, 10.5, 3.5, 20.5) !== valueNoise3(1234, 10.5, 3.5 + TWO_POW_32, 20.5) &&
      valueNoise3(1234, 10.5, 3.5, 20.5) !== valueNoise3(1234, 10.5, 3.5, 20.5 + TWO_POW_32),
  );

  // The terrain itself must not repeat at the horizon.
  const nearHeight = terrainHeight(1234, 0, 0);
  check(
    "the terrain height does not repeat at z + 2^32",
    nearHeight !== terrainHeight(1234, 0, TWO_POW_32),
    `${nearHeight} vs ${terrainHeight(1234, 0, TWO_POW_32)}`,
  );

  // Two world seeds 2^32 apart must not produce the same chunk.
  const chunkA = generateChunk(0, { cx: 0, cz: 0 });
  const chunkB = generateChunk(TWO_POW_32, { cx: 0, cz: 0 });
  let differing = 0;
  for (let i = 0; i < chunkA.blocks.length; i++) {
    if (chunkA.blocks[i] !== chunkB.blocks[i]) differing++;
  }
  check(
    "a chunk from seed 0 differs from a chunk from seed 2^32",
    differing > 0,
    `${differing} bytes differ`,
  );

  // The fix must not break the properties the noise is relied on for.
  let inRange = true;
  for (let i = 0; i < 2000; i++) {
    const v = valueNoise2(1234, i * 0.37, i * 0.71);
    const f = fbm2(1234, i * 0.37, i * 0.71, 4);
    if (!(v >= 0 && v < 1) || !(f >= 0 && f <= 1)) inRange = false;
  }
  check("noise still stays in [0, 1]", inRange);
  check(
    "noise is still deterministic",
    valueNoise2(1234, 10.5, 20.5) === valueNoise2(1234, 10.5, 20.5) &&
      fbm2(1234, 10.5, 20.5, 4) === fbm2(1234, 10.5, 20.5, 4),
  );
  check(
    "different seeds still give different noise",
    fbm2(1234, 10.5, 20.5, 4) !== fbm2(9999, 10.5, 20.5, 4),
  );

  // Neighbouring lattice points must not collapse onto each other, which
  // a hash that folds the coordinate badly could do.
  let collisions = 0;
  for (let i = 0; i < 500; i++) {
    if (valueNoise2(1234, i, 0) === valueNoise2(1234, i + 1, 0)) collisions++;
  }
  check("neighbouring lattice points still differ", collisions === 0, `${collisions} collisions`);
}

if (failures > 0) {
  process.stderr.write(`\nengine self-check FAILED: ${failures} check(s)\n`);
  process.exit(1);
}
process.stdout.write("\nengine self-check PASSED\n");
