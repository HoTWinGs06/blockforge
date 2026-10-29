/**
 * BlockForge — HUD.
 *
 * DOM-only overlay: crosshair, targeted-block readout, hotbar shell and the
 * pause/settings menu shell. Deliberately dependency-free so it works in a
 * headless browser (the G2 gate drives it).
 *
 * The hotbar is a SHELL in M1: the slot grid, the selection ring and the
 * item labels exist, but the items themselves are M3 (GAMEPLAY) content. The
 * seam is deliberate - GAMEPLAY fills the slots, the HUD just renders them.
 */

import { BlockId } from "../core/types.js";
import { isToolId, getToolIcon, toolSpec } from "./toolIcons.js";

export interface HudHotbarSlot {
  readonly id: string;
  readonly count: number;
  readonly durability?: number;
}

export interface HudState {
  readonly targetedBlock: BlockId | null;
  readonly targetedPosition: { x: number; y: number; z: number } | null;
  readonly hotbar: readonly HudHotbarSlot[];
  readonly selectedSlot: number;
  readonly health: number;
  readonly hunger: number;
  readonly message: string | null;
  /**
   * How far through breaking the targeted block the player is, from 0 to 1.
   *
   * Null when nothing is being broken. The break TIMES are frozen in the core
   * contract (BREAK_TIME_SECONDS / breakSeconds) - this is only the progress
   * readout for them.
   */
  readonly breakProgress: number | null;
  /** The block kind currently being broken, for the label. */
  readonly breakingBlock: BlockId | null;
}

const BLOCK_LABELS: Readonly<Record<string, string>> = {
  [BlockId.Voidstone]: "Voidstone",
  [BlockId.Slate]: "Slate",
  [BlockId.Rubble]: "Rubble",
  [BlockId.Regolith]: "Regolith",
  [BlockId.Loam]: "Loam",
  [BlockId.Sand]: "Sand",
  [BlockId.Gravel]: "Gravel",
  [BlockId.Clay]: "Clay",
  [BlockId.Timber]: "Timber",
  [BlockId.Foliage]: "Foliage",
  [BlockId.Tidewater]: "Tidewater",
  [BlockId.Emberflow]: "Emberflow",
  [BlockId.Crystpane]: "Crystpane",
  [BlockId.Masonry]: "Masonry",
  [BlockId.Anthracite]: "Anthracite",
  [BlockId.Ironveil]: "Ironveil",
  [BlockId.Gildenseam]: "Gildenseam",
  [BlockId.Lumencrystal]: "Lumencrystal",
  [BlockId.Emberlamp]: "Emberlamp",
  [BlockId.Smeltforge]: "Smeltforge",
  [BlockId.Craftbench]: "Craftbench",
  [BlockId.Millplank]: "Millplank",
};

/** Human label for a block kind (BlockForge's own names). */
export function blockLabel(id: BlockId | null): string {
  if (!id) {
    return "-";
  }
  const label = BLOCK_LABELS[id];
  if (label) {
    return label;
  }
  // Not a block: it is a TOOL, whose id is the contract's own
  // (mattock_timber). Show it as words rather than as a raw id.
  return id
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const STYLE_ID = "blockforge-hud-style";

/**
 * The HUD styles.
 *
 * The operator reported "no health bar, hunger bar inventory bar" - the bars
 * and slots EXISTED but were two 7-pixel slivers and nine empty 46x46 boxes
 * in the corner. They read as nothing. So the sizes here are deliberately
 * chunky, the empty slots are visibly slots, and the bars have labels.
 */
const CSS = `
#blockforge-hud, #blockforge-hud * { box-sizing: border-box; }
#blockforge-hud {
  position: fixed; inset: 0; pointer-events: none;
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  color: #f4f4f0; text-shadow: 0 2px 3px rgba(0,0,0,.9);
  z-index: 10;
  user-select: none;
}
#blockforge-hud .bf-crosshair {
  position: absolute; left: 50%; top: 50%;
  width: 22px; height: 22px; margin: -11px 0 0 -11px;
}
#blockforge-hud .bf-crosshair::before, #blockforge-hud .bf-crosshair::after {
  content: ""; position: absolute; background: rgba(255,255,255,.92);
  mix-blend-mode: difference;
}
#blockforge-hud .bf-crosshair::before { left: 10px; top: 0; width: 2px; height: 22px; }
#blockforge-hud .bf-crosshair::after { top: 10px; left: 0; height: 2px; width: 22px; }
#blockforge-hud .bf-target {
  position: absolute; left: 50%; top: calc(50% + 30px);
  transform: translateX(-50%); font-size: 15px; letter-spacing: .4px;
  white-space: nowrap; font-weight: 600;
  background: rgba(0,0,0,.45); padding: 3px 10px; border-radius: 3px;
}

/* Health and hunger: chunky, labelled, always visible. */
#blockforge-hud .bf-stats {
  position: absolute; left: 16px; bottom: 20px;
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px; background: rgba(10,10,14,.55);
  border: 1px solid rgba(0,0,0,.55); border-radius: 4px;
}
#blockforge-hud .bf-stat { display: flex; align-items: center; gap: 8px; }
#blockforge-hud .bf-stat-label {
  font-size: 11px; letter-spacing: .6px; width: 46px; opacity: .9;
}
#blockforge-hud .bf-bar {
  width: 150px; height: 14px; border: 2px solid rgba(0,0,0,.75);
  background: rgba(0,0,0,.55); position: relative;
}
#blockforge-hud .bf-bar > i {
  display: block; height: 100%;
}
#blockforge-hud .bf-bar.bf-health > i { background: linear-gradient(#d9534a, #a8322a); }
#blockforge-hud .bf-bar.bf-hunger > i { background: linear-gradient(#c99a4a, #9a6f2c); }
#blockforge-hud .bf-bar .bf-bar-value {
  position: absolute; right: 4px; top: -1px; font-size: 10px;
  color: #fff; text-shadow: 0 1px 2px #000;
}

/* Hotbar: a row of slots that read as slots even when empty. */
#blockforge-hud .bf-hotbar {
  position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%);
  display: flex; gap: 5px; padding: 5px;
  background: rgba(10,10,14,.5); border: 1px solid rgba(0,0,0,.5);
  border-radius: 5px;
}
#blockforge-hud .bf-slot {
  width: 52px; height: 52px;
  border: 2px solid rgba(0,0,0,.65);
  background: rgba(40,40,48,.72);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.06);
  display: flex; align-items: center; justify-content: center;
  font-size: 9px; text-align: center; line-height: 1.15; padding: 3px;
  position: relative; color: rgba(255,255,255,.55);
}
#blockforge-hud .bf-slot.bf-selected {
  border-color: #f6f6ec;
  box-shadow: inset 0 0 0 2px rgba(255,255,255,.28), 0 0 8px rgba(255,255,255,.3);
  color: #fff;
}
#blockforge-hud .bf-slot .bf-count {
  position: absolute; right: 3px; bottom: 1px; font-size: 11px;
  color: #ffe9a8; font-weight: 700;
}
#blockforge-hud .bf-slot .bf-key {
  position: absolute; left: 3px; top: 1px; font-size: 9px;
  color: rgba(255,255,255,.35);
}
#blockforge-hud .bf-slot .bf-icon {
  width: 26px; height: 26px; image-rendering: pixelated; display: block;
}
#blockforge-hud .bf-slot .bf-label {
  position: absolute; bottom: 3px; left: 0; width: 100%; text-align: center;
  font-size: 7px; color: rgba(255,255,255,.75); letter-spacing: .2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#blockforge-hud .bf-slot .bf-dur {
  position: absolute; bottom: 0; left: 3px; right: 3px; height: 3px;
  background: rgba(0,0,0,.55); border-radius: 1px; overflow: hidden;
}
#blockforge-hud .bf-slot .bf-dur > i { display: block; height: 100%; border-radius: 1px; }
#blockforge-hud .bf-hotbar-label {
  position: absolute; left: 50%; bottom: 78px; transform: translateX(-50%);
  font-size: 12px; opacity: .8; white-space: nowrap;
}

/* Break progress: a bar under the targeted-block readout. */
#blockforge-hud .bf-break {
  position: absolute; left: 50%; top: calc(50% + 54px);
  transform: translateX(-50%);
  width: 190px; height: 8px;
  border: 1px solid rgba(0,0,0,.7); background: rgba(0,0,0,.55);
  display: none;
}
#blockforge-hud .bf-break.bf-active { display: block; }
#blockforge-hud .bf-break > i {
  display: block; height: 100%; background: linear-gradient(#e8d79a, #c9a94e);
}
#blockforge-hud .bf-break-label {
  position: absolute; left: 50%; top: calc(50% + 66px);
  transform: translateX(-50%); font-size: 11px; opacity: .85;
  white-space: nowrap; display: none;
}
#blockforge-hud .bf-break-label.bf-active { display: block; }

#blockforge-hud .bf-message {
  position: absolute; left: 50%; top: 22px; transform: translateX(-50%);
  font-size: 14px; background: rgba(0,0,0,.6); padding: 6px 14px;
  border-radius: 4px; border: 1px solid rgba(255,255,255,.12);
}
#blockforge-hud .bf-menu {
  position: absolute; inset: 0; background: rgba(8,8,12,.78);
  display: none; align-items: center; justify-content: center;
}
#blockforge-hud .bf-menu.bf-open { display: flex; }
#blockforge-hud .bf-menu-panel {
  background: #17171c; border: 1px solid #3a3a45; padding: 26px 32px;
  min-width: 360px; box-shadow: 0 12px 40px rgba(0,0,0,.6);
}
#blockforge-hud .bf-menu-panel h1 { margin: 0 0 4px; font-size: 22px; font-weight: 700; }
#blockforge-hud .bf-menu-panel .bf-sub { font-size: 12px; opacity: .7; margin-bottom: 18px; }
#blockforge-hud .bf-menu-panel label {
  display: block; font-size: 12px; margin: 12px 0 5px;
}
#blockforge-hud .bf-menu-panel input[type=range] { width: 100%; }
#blockforge-hud .bf-menu-panel .bf-hint {
  margin-top: 20px; font-size: 11px; opacity: .7; line-height: 1.7;
}
`;

/** The HUD. Owns one root element and updates it in place. */
export class Hud {
  readonly root: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly target: HTMLDivElement;
  private readonly hotbar: HTMLDivElement;
  private readonly hotbarLabel: HTMLDivElement;
  private readonly breakBar: HTMLDivElement;
  private readonly breakFill: HTMLElement;
  private readonly breakLabel: HTMLDivElement;
  private readonly stats: HTMLDivElement;
  private readonly message: HTMLDivElement;
  private readonly menu: HTMLDivElement;

  constructor(parent: HTMLElement = document.body) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    this.root = document.createElement("div");
    this.root.id = "blockforge-hud";

    this.crosshair = document.createElement("div");
    this.crosshair.className = "bf-crosshair";
    this.root.appendChild(this.crosshair);

    this.target = document.createElement("div");
    this.target.className = "bf-target";
    this.root.appendChild(this.target);

    this.stats = document.createElement("div");
    this.stats.className = "bf-stats";
    this.root.appendChild(this.stats);

    this.hotbarLabel = document.createElement("div");
    this.hotbarLabel.className = "bf-hotbar-label";
    this.root.appendChild(this.hotbarLabel);

    // The break-progress bar. Hidden until the player is actually breaking
    // something, so it does not sit on screen doing nothing.
    this.breakBar = document.createElement("div");
    this.breakBar.className = "bf-break";
    this.breakFill = document.createElement("i");
    this.breakBar.appendChild(this.breakFill);
    this.root.appendChild(this.breakBar);

    this.breakLabel = document.createElement("div");
    this.breakLabel.className = "bf-break-label";
    this.root.appendChild(this.breakLabel);

    this.hotbar = document.createElement("div");
    this.hotbar.className = "bf-hotbar";
    this.root.appendChild(this.hotbar);

    this.message = document.createElement("div");
    this.message.className = "bf-message";
    this.message.style.display = "none";
    this.root.appendChild(this.message);

    this.menu = document.createElement("div");
    this.menu.className = "bf-menu";
    this.menu.innerHTML = `
      <div class="bf-menu-panel">
        <h1>BlockForge</h1>
        <div class="bf-sub">an original, unofficial Minecraft-inspired voxel sandbox</div>
        <label for="bf-sensitivity">Look sensitivity</label>
        <input id="bf-sensitivity" type="range" min="20" max="400" value="120" />
        <label for="bf-fov">Field of view</label>
        <input id="bf-fov" type="range" min="50" max="110" value="75" />
        <div class="bf-hint">
          ESC to resume &middot; 1-9 select a hotbar slot &middot; WASD move &middot; Space jump<br />
          Left click break &middot; Right click place &middot; F break &middot; R place
        </div>
      </div>`;
    this.root.appendChild(this.menu);

    parent.appendChild(this.root);
  }

  /** Apply a state snapshot. */
  update(state: HudState): void {
    this.target.textContent = state.targetedBlock
      ? `${blockLabel(state.targetedBlock)}${
          state.targetedPosition
            ? `  ${state.targetedPosition.x}, ${state.targetedPosition.y}, ${state.targetedPosition.z}`
            : ""
        }`
      : "";

    this.hotbar.replaceChildren(
      ...state.hotbar.map((slot, index) => {
        const el = document.createElement("div");
        el.className = "bf-slot" + (index === state.selectedSlot ? " bf-selected" : "");
        el.dataset["slot"] = String(index);

        const isTool = slot.id ? isToolId(slot.id) : false;

        // Icon for tools; plain label for blocks.
        if (isTool && slot.id) {
          const icon = document.createElement("img");
          icon.className = "bf-icon";
          icon.alt = "";
          const cv = getToolIcon(slot.id);
          icon.src = cv.toDataURL();
          el.appendChild(icon);
          const lbl = document.createElement("span");
          lbl.className = "bf-label";
          lbl.textContent = blockLabel(slot.id as BlockId);
          el.appendChild(lbl);
        } else {
          el.textContent = slot.id ? blockLabel(slot.id as BlockId) : "";
        }

        const key = document.createElement("span");
        key.className = "bf-key";
        key.textContent = String(index + 1);
        el.appendChild(key);

        if (slot.count > 1) {
          const count = document.createElement("span");
          count.className = "bf-count";
          count.textContent = String(slot.count);
          el.appendChild(count);
        }

        // Durability bar when the item carries a durability number (tools only, now).
        if (slot.durability !== undefined && slot.durability !== null) {
          const durWrap = document.createElement("div");
          durWrap.className = "bf-dur";
          const maxDur = toolSpec(slot.id)?.durability ?? 130;
          const pct = Math.max(0, Math.min(100, (slot.durability / maxDur) * 100));
          const bar = document.createElement("i");
          bar.style.width = `${pct}%`;
          if (pct < 20) bar.style.background = "#d9534a"; // critical: red
          else if (pct < 50) bar.style.background = "#c99a4a"; // warning: amber
          else bar.style.background = "#5cb85c"; // fine: green
          durWrap.appendChild(bar);
          el.appendChild(durWrap);
        }

        return el;
      }),
    );

    if (state.breakProgress !== null && state.breakProgress > 0) {
      this.breakBar.classList.add("bf-active");
      this.breakFill.style.width = `${Math.round(state.breakProgress * 100)}%`;
      this.breakLabel.classList.add("bf-active");
      this.breakLabel.textContent = state.breakingBlock
        ? `Breaking ${blockLabel(state.breakingBlock)}`
        : "Breaking";
    } else {
      this.breakBar.classList.remove("bf-active");
      this.breakLabel.classList.remove("bf-active");
    }

    const selected = state.hotbar[state.selectedSlot];
    this.hotbarLabel.textContent = selected?.id
      ? blockLabel(selected.id as BlockId)
      : "";

    this.stats.replaceChildren(
      this.statRow("health", "HEALTH", state.health),
      this.statRow("hunger", "HUNGER", state.hunger),
    );

    if (state.message) {
      this.message.textContent = state.message;
      this.message.style.display = "";
    } else {
      this.message.style.display = "none";
    }
  }

  private statRow(
    kind: "health" | "hunger",
    label: string,
    value: number,
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "bf-stat";

    const name = document.createElement("span");
    name.className = "bf-stat-label";
    name.textContent = label;
    row.appendChild(name);

    const bar = document.createElement("div");
    bar.className = `bf-bar bf-${kind}`;
    const fill = document.createElement("i");
    // The values are on a 0..20 scale (health and hunger in a Minecraft-style
    // game), so the fill is the fraction of the maximum - not the raw value.
    // Treating 20 as a percentage left the bar a fifth full, which reads as
    // "the player is nearly dead" when they are perfectly healthy.
    const max = 20;
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);

    const readout = document.createElement("span");
    readout.className = "bf-bar-value";
    readout.textContent = String(Math.round(value));
    bar.appendChild(readout);

    row.appendChild(bar);
    return row;
  }

  /** Open or close the pause / settings menu. */
  setMenuOpen(open: boolean): void {
    this.menu.classList.toggle("bf-open", open);
  }

  /** True when the menu is showing. */
  get menuOpen(): boolean {
    return this.menu.classList.contains("bf-open");
  }

  /** The sensitivity slider value (0.02 - 4.0). */
  get sensitivity(): number {
    const input = this.menu.querySelector<HTMLInputElement>("#bf-sensitivity");
    return input ? Number(input.value) / 100 : 1.2;
  }

  /** The field-of-view slider value. */
  get fieldOfView(): number {
    const input = this.menu.querySelector<HTMLInputElement>("#bf-fov");
    return input ? Number(input.value) : 75;
  }
}
