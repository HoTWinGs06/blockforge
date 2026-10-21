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
  return BLOCK_LABELS[id] ?? id;
}

const STYLE_ID = "blockforge-hud-style";

const CSS = `
#blockforge-hud, #blockforge-hud * { box-sizing: border-box; }
#blockforge-hud {
  position: fixed; inset: 0; pointer-events: none;
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  color: #f2f2f0; text-shadow: 0 1px 2px rgba(0,0,0,.85);
  z-index: 10;
}
#blockforge-hud .bf-crosshair {
  position: absolute; left: 50%; top: 50%;
  width: 18px; height: 18px; margin: -9px 0 0 -9px;
}
#blockforge-hud .bf-crosshair::before, #blockforge-hud .bf-crosshair::after {
  content: ""; position: absolute; background: rgba(255,255,255,.85);
  mix-blend-mode: difference;
}
#blockforge-hud .bf-crosshair::before { left: 8px; top: 0; width: 2px; height: 18px; }
#blockforge-hud .bf-crosshair::after { top: 8px; left: 0; height: 2px; width: 18px; }
#blockforge-hud .bf-target {
  position: absolute; left: 50%; top: calc(50% + 26px);
  transform: translateX(-50%); font-size: 13px; letter-spacing: .3px;
  white-space: nowrap;
}
#blockforge-hud .bf-hotbar {
  position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
  display: flex; gap: 4px;
}
#blockforge-hud .bf-slot {
  width: 46px; height: 46px; border: 2px solid rgba(0,0,0,.6);
  background: rgba(20,20,24,.72); display: flex; align-items: center;
  justify-content: center; font-size: 10px; text-align: center;
  line-height: 1.1; padding: 2px; position: relative;
}
#blockforge-hud .bf-slot.bf-selected { border-color: #f0f0e8; }
#blockforge-hud .bf-slot .bf-count {
  position: absolute; right: 2px; bottom: 0; font-size: 10px; color: #ffe9a8;
}
#blockforge-hud .bf-stats {
  position: absolute; left: 14px; bottom: 18px; font-size: 12px; line-height: 1.5;
}
#blockforge-hud .bf-bar { width: 120px; height: 7px; border: 1px solid rgba(0,0,0,.6); background: rgba(0,0,0,.45); }
#blockforge-hud .bf-bar > i { display: block; height: 100%; }
#blockforge-hud .bf-bar.bf-health > i { background: #c0453c; }
#blockforge-hud .bf-bar.bf-hunger > i { background: #b5823c; }
#blockforge-hud .bf-message {
  position: absolute; left: 50%; top: 18px; transform: translateX(-50%);
  font-size: 13px; background: rgba(0,0,0,.55); padding: 4px 10px;
}
#blockforge-hud .bf-menu {
  position: absolute; inset: 0; background: rgba(8,8,12,.72);
  display: none; align-items: center; justify-content: center;
}
#blockforge-hud .bf-menu.bf-open { display: flex; }
#blockforge-hud .bf-menu-panel {
  background: #17171c; border: 1px solid #34343d; padding: 22px 28px; min-width: 320px;
}
#blockforge-hud .bf-menu-panel h1 { margin: 0 0 14px; font-size: 18px; font-weight: 600; }
#blockforge-hud .bf-menu-panel label { display: block; font-size: 12px; margin: 10px 0 4px; }
#blockforge-hud .bf-menu-panel input[type=range] { width: 100%; }
`;

/** The HUD. Owns one root element and updates it in place. */
export class Hud {
  readonly root: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly target: HTMLDivElement;
  private readonly hotbar: HTMLDivElement;
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

    this.hotbar = document.createElement("div");
    this.hotbar.className = "bf-hotbar";
    this.root.appendChild(this.hotbar);

    this.stats = document.createElement("div");
    this.stats.className = "bf-stats";
    this.root.appendChild(this.stats);

    this.message = document.createElement("div");
    this.message.className = "bf-message";
    this.message.style.display = "none";
    this.root.appendChild(this.message);

    this.menu = document.createElement("div");
    this.menu.className = "bf-menu";
    this.menu.innerHTML = `
      <div class="bf-menu-panel">
        <h1>BlockForge</h1>
        <div>an original, unofficial Minecraft-inspired voxel sandbox</div>
        <label for="bf-sensitivity">Look sensitivity</label>
        <input id="bf-sensitivity" type="range" min="20" max="400" value="120" />
        <label for="bf-fov">Field of view</label>
        <input id="bf-fov" type="range" min="50" max="110" value="75" />
        <div style="margin-top:18px;font-size:11px;opacity:.7">
          ESC to resume &middot; 1-9 select hotbar slot &middot; WASD move &middot; Space jump
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
        el.textContent = slot.id ? blockLabel(slot.id as BlockId) : "";
        if (slot.count > 1) {
          const count = document.createElement("span");
          count.className = "bf-count";
          count.textContent = String(slot.count);
          el.appendChild(count);
        }
        return el;
      }),
    );

    this.stats.replaceChildren(
      this.statRow("health", state.health),
      this.statRow("hunger", state.hunger),
    );

    if (state.message) {
      this.message.textContent = state.message;
      this.message.style.display = "";
    } else {
      this.message.style.display = "none";
    }
  }

  private statRow(kind: "health" | "hunger", value: number): HTMLElement {
    const row = document.createElement("div");
    const bar = document.createElement("div");
    bar.className = `bf-bar bf-${kind}`;
    const fill = document.createElement("i");
    const pct = Math.max(0, Math.min(100, value));
    fill.style.width = `${pct}%`;
    bar.appendChild(fill);
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
