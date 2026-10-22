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
import {
  stepPhysics,
  bodyAabb,
  collides,
  solidWorldFromBlocks,
  moveWithCollisions,
  createJumpState,
  stepJumpAssist,
  COYOTE_TICKS,
  JUMP_BUFFER_TICKS,
} from "../../src/core/physics.js";
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

// 9b. T93: a falling body must not end up ABOVE the surface it fell past.
//
// Two defects, one root cause each.
//
// (a) THE FLOAT. The vertical axis was resolved BEFORE the horizontal one,
// so a body that slid off a ledge kept the height it had landed on and
// hovered above the ground it had just walked past. The landing must be
// decided at the body's FINAL horizontal position.
//
// (b) THE LIFT. The landing took the top of the highest block the body
// OVERLAPPED, so a block at head height could lift the body onto its top.
// A falling body must land only on a surface at or below where its feet
// started.
//
// Both are checked here, in the engine's own self-check because tests/ is
// the TEST AUTHOR's file.
{
  // (a) A body that walks off the end of a ledge must FALL, not hover at
  // the ledge's height. The world is a one-block-deep ledge along z, and
  // the body walks off its end in +Z.
  //
  // The frame is the GAME's frame: an X move, then a Z move, then the
  // gravity move - which is what src/main.ts does every tick.
  const ledge = solidWorldFromBlocks([[0, 0, 0]]);
  let position = { x: 0.5, y: 1, z: 0.5 };
  let velocity = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 30; i++) {
    const step = stepPhysics(position, velocity, 1 / 60, ledge);
    position = step.position;
    velocity = step.velocity;
    if (step.onGround) break;
  }
  check("a body comes to rest on top of the ledge", Math.abs(position.y - 1) < 1e-6, `y=${position.y}`);

  let hovered = false;
  for (let tick = 0; tick < 60 && !hovered; tick++) {
    const x = moveWithCollisions(position, velocity, { x: 0, y: 0, z: 0 }, ledge);
    position = x.position;
    velocity = { ...x.velocity, z: 1 };
    const z = moveWithCollisions(
      position,
      { ...velocity, x: 0 },
      { x: 0, y: 0, z: 1 / 60 },
      ledge,
    );
    position = z.position;
    velocity = { ...z.velocity, z: 1 };
    const g = stepPhysics(position, velocity, 1 / 60, ledge);
    position = g.position;
    velocity = g.velocity;
    // The body says it is on the ground: is there ground under its feet?
    if (g.onGround) {
      const layer = Math.floor(position.y - 1e-6);
      let under = false;
      for (
        let bx = Math.floor(position.x - 0.3);
        bx <= Math.floor(position.x + 0.3 - 1e-9) && !under;
        bx++
      ) {
        for (
          let bz = Math.floor(position.z - 0.3);
          bz <= Math.floor(position.z + 0.3 - 1e-9) && !under;
          bz++
        ) {
          if (ledge.isSolid(bx, layer, bz)) under = true;
        }
      }
      if (!under) hovered = true;
    }
  }
  check(
    "a body that walks off a ledge does not hover at the ledge's height",
    !hovered,
    `y=${position.y}`,
  );

  // (b) A falling body must not land on top of a block it fell PAST.
  //
  // The floor's top is y=1. The wall block at x=1 spans y=2..3, so its top
  // is y=3. The body is 0.6 wide, so at x=0.95 its right shoulder overlaps
  // the wall column as it descends past it, and it starts BELOW the wall's
  // top - so the wall is a block it fell PAST.
  const wall = solidWorldFromBlocks([
    [0, 0, 0],
    [1, 2, 0],
  ]);
  let falling = { x: 0.95, y: 1.5, z: 0.0 };
  let fallVelocity = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 60; i++) {
    const step = stepPhysics(falling, fallVelocity, 1 / 60, wall);
    falling = step.position;
    fallVelocity = step.velocity;
    if (step.onGround) break;
  }
  check(
    "a falling body does not land on top of a block it fell past",
    Math.abs(falling.y - 1) < 1e-6,
    `y=${falling.y} (expected 1, the floor's top; 3 would be the wall's top)`,
  );
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

// 12. THE JUMP ASSIST (T90). Coyote time and jump buffering.
//
// The operator reported "the jump does not work in all areas". The two
// causes are a press that is a fraction of a second too late (the body has
// already left the ground) and a press that is a fraction of a second too
// early (the body has not landed yet). The assist forgives both, and it
// forgives them in TICKS so the behaviour does not depend on the frame
// rate.
{
  // A press on the ground jumps at once.
  {
    const r = stepJumpAssist(createJumpState(), { jumpHeld: true, onGround: true });
    check("a press on the ground jumps at once", r.jumped);
  }

  // A HELD key is not a new press: only the rising edge counts, so
  // holding the key does not bounce the player.
  {
    let state = createJumpState();
    state = stepJumpAssist(state, { jumpHeld: true, onGround: true }).state;
    const second = stepJumpAssist(state, { jumpHeld: true, onGround: true });
    check("holding the key does not jump again", !second.jumped);
  }

  // COYOTE TIME: a press just after the body left the ground still jumps.
  {
    let state = createJumpState();
    state = stepJumpAssist(state, { jumpHeld: false, onGround: true }).state;
    const r = stepJumpAssist(state, { jumpHeld: true, onGround: false });
    check("a press just after leaving the ground still jumps", r.jumped);
  }

  // The coyote window is exactly COYOTE_TICKS long, and it does expire.
  {
    const jumpsAfter = (ticks: number): boolean => {
      let state = createJumpState();
      state = stepJumpAssist(state, { jumpHeld: false, onGround: true }).state;
      for (let i = 0; i < ticks; i++) {
        state = stepJumpAssist(state, { jumpHeld: false, onGround: false }).state;
      }
      return stepJumpAssist(state, { jumpHeld: true, onGround: false }).jumped;
    };
    let lastGrace = -1;
    for (let i = 0; i < COYOTE_TICKS + 3; i++) {
      if (jumpsAfter(i)) lastGrace = i;
    }
    check(
      `the coyote window is exactly ${COYOTE_TICKS} ticks`,
      lastGrace === COYOTE_TICKS - 1,
      `last grace tick ${lastGrace}`,
    );
    check("a press long after leaving the ground does not jump", !jumpsAfter(COYOTE_TICKS + 2));
  }

  // JUMP BUFFERING: a press too early is remembered and fires on landing.
  {
    let state = createJumpState();
    state = stepJumpAssist(state, { jumpHeld: false, onGround: true }).state;
    for (let i = 0; i < COYOTE_TICKS + 2; i++) {
      state = stepJumpAssist(state, { jumpHeld: false, onGround: false }).state;
    }
    const early = stepJumpAssist(state, { jumpHeld: true, onGround: false });
    check("a press too early does not jump immediately", !early.jumped);
    const landed = stepJumpAssist(early.state, { jumpHeld: false, onGround: true });
    check("the remembered press fires on the landing", landed.jumped);
  }

  // The buffer expires: a press long before the landing is forgotten.
  {
    let state = createJumpState();
    state = stepJumpAssist(state, { jumpHeld: false, onGround: true }).state;
    for (let i = 0; i < COYOTE_TICKS + 2; i++) {
      state = stepJumpAssist(state, { jumpHeld: false, onGround: false }).state;
    }
    state = stepJumpAssist(state, { jumpHeld: true, onGround: false }).state;
    for (let i = 0; i < JUMP_BUFFER_TICKS + 2; i++) {
      state = stepJumpAssist(state, { jumpHeld: false, onGround: false }).state;
    }
    const landed = stepJumpAssist(state, { jumpHeld: false, onGround: true });
    check("a press long before the landing is forgotten", !landed.jumped);
  }

  // A ground jump spends the grace, so it cannot be followed by a second
  // jump out of the same landing.
  {
    const state = createJumpState();
    const first = stepJumpAssist(state, { jumpHeld: true, onGround: true });
    check("the ground jump fires", first.jumped);
    const airborne = stepJumpAssist(first.state, { jumpHeld: false, onGround: false }).state;
    const again = stepJumpAssist(airborne, { jumpHeld: true, onGround: false });
    check("a ground jump does not leave grace behind it", !again.jumped);
  }

  // The assist is PURE: the same input history always gives the same jump.
  {
    const run = (): string => {
      let state = createJumpState();
      const out: string[] = [];
      for (let i = 0; i < 40; i++) {
        const r = stepJumpAssist(state, { jumpHeld: i === 3 || i === 20, onGround: i % 7 === 0 });
        state = r.state;
        out.push(r.jumped ? "1" : "0");
      }
      return out.join("");
    };
    check("the same input history gives the same jump", run() === run());
  }
}

// 13. THE HARDENED STEP-UP (T90). The step-up must walk a ledge up, and
// must NOT be a way to climb a wall.
{
  // A REAL one-block ledge: the ground's top is y=1 and the step's top y=2.
  const ledge = solidWorldFromBlocks([
    [0, 0, 0],
    [1, 1, 0],
  ]);
  {
    const r = moveWithCollisions(
      { x: 0.5, y: 1, z: 0.5 },
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
      ledge,
    );
    check("a one-block ledge is walked up", Math.abs(r.position.y - 2) < 1e-9, `y=${r.position.y}`);
  }

  // A RISING body does not step up. Without this a jump into a wall is a
  // wall climb, which is the one rule the step-up must not break.
  {
    const r = moveWithCollisions(
      { x: 0.5, y: 1, z: 0.5 },
      { x: 3, y: 8, z: 0 },
      { x: 0.5, y: 0, z: 0 },
      ledge,
    );
    check("a rising body does not step up", Math.abs(r.position.y - 1) < 1e-9, `y=${r.position.y}`);
  }

  // ONE move raises the body at most STEP_HEIGHT, however many axes step
  // up: a diagonal staircase must not be climbed two blocks at a time.
  {
    const stair: Array<[number, number, number]> = [];
    for (let i = 0; i < 4; i++) {
      stair.push([i, i, 0]);
      stair.push([i, i, 1]);
    }
    const r = moveWithCollisions(
      { x: 0.5, y: 1, z: 0.5 },
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0.5 },
      solidWorldFromBlocks(stair),
    );
    check(
      "one move never raises the body by more than STEP_HEIGHT",
      r.position.y - 1 <= 1 + 1e-9,
      `rise=${r.position.y - 1}`,
    );
  }

  // The ground probe is a thin slab under the feet, not the whole body:
  // a body whose HEAD is inside a block is not standing on that block, so
  // it cannot step up off it.
  {
    const world = solidWorldFromBlocks([
      [0, 0, 0],
      [0, 3, 0],
      [1, 1, 0],
    ]);
    const r = moveWithCollisions(
      { x: 0.5, y: 1.2, z: 0.5 },
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
      world,
    );
    check(
      "a body whose head is in a block does not step up off it",
      Math.abs(r.position.y - 1.2) < 1e-9,
      `y=${r.position.y}`,
    );
  }

  // A body in mid-air with nothing under it still does not step up.
  {
    const r = moveWithCollisions(
      { x: 0.5, y: 1.2, z: 0.5 },
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
      solidWorldFromBlocks([[1, 1, 0]]),
    );
    check("a body in mid-air does not step up", Math.abs(r.position.y - 1.2) < 1e-9, `y=${r.position.y}`);
  }
}

if (failures > 0) {
  process.stderr.write(`\nengine self-check FAILED: ${failures} check(s)\n`);
  process.exit(1);
}
process.stdout.write("\nengine self-check PASSED\n");
