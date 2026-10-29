/**
 * BlockForge — crafting UI overlay (DOM-only, dependency-free).
 *
 * 2x2 grid (inventory) or 3x3 (craftbench). Recipe book paginated from
 * `recipeBook`. Preview via `preview()`. Craft via `craft()`.
 * Click-to-place / click-to-clear with the player's currently held item.
 */

import { createGrid, gridWith, gridWithout, type CraftingGrid } from "../core/crafting/index.js";
import { recipeBook, preview, craft, gridSize } from "../gameplay/crafting.js";
import { recipePattern } from "../core/crafting/index.js";
import type { Recipe, ItemStack } from "../core/types.js";

const CSS_ID = "bf-craft-style";
const CSS = `
#bf-crafting { position: fixed; inset: 0; pointer-events: none; z-index: 20; font-family: ui-monospace,Menlo,monospace; color:#f4f4f0; text-shadow:0 2px 3px rgba(0,0,0,.9); }
#bf-crafting.bf-open { pointer-events: auto; display: flex; align-items: center; justify-content: center; }
#bf-crafting { display: none; }
#bf-crafting .bf-panel { background:#17171c; border:1px solid #3a3a45; padding:18px 22px; border-radius: 6px; min-width: 560px; max-width: 92vw; box-shadow: 0 12px 40px rgba(0,0,0,.65); }
#bf-crafting .bf-title { font-size: 18px; font-weight: 700; margin: 0 0 4px; letter-spacing: .3px; }
#bf-crafting .bf-sub { font-size: 11px; opacity: .7; margin-bottom: 10px; }
#bf-crafting .bf-row { display: flex; gap: 18px; align-items: flex-start; }
#bf-crafting .bf-grid-area { flex: 1 1 auto; }
#bf-crafting .bf-grid { display: grid; gap: 6px; margin-top: 6px; }
#bf-crafting .bf-grid.bf-2 { grid-template-columns: repeat(2, 52px); }
#bf-crafting .bf-grid.bf-3 { grid-template-columns: repeat(3, 52px); }
#bf-crafting .bf-cell { width: 52px; height: 52px; background: rgba(40,40,48,.7); border: 2px solid rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; color:#fff; font-size: 10px; position: relative; cursor: pointer; }
#bf-crafting .bf-cell.bf-filled { border-color:#bfa13a; box-shadow: inset 0 0 0 1px rgba(191,161,58,.4); }
#bf-crafting .bf-cell .bf-tag { font-size: 9px; color: rgba(255,255,255,.7); }
#bf-crafting .bf-preview { flex: 0 0 140px; }
#bf-crafting .bf-preview-box { background: rgba(35,35,42,.8); border: 1px solid rgba(255,255,255,.12); padding: 10px; border-radius: 4px; text-align: center; }
#bf-crafting .bf-preview-box .bf-pname { font-size: 13px; font-weight: 700; margin-top: 4px; }
#bf-crafting .bf-preview-box .bf-ptag { font-size: 10px; opacity: .7; }
#bf-crafting .bf-book { flex: 1 1 220px; min-width: 200px; max-height: 260px; overflow-y: auto; background: rgba(20,20,26,.55); border: 1px solid rgba(255,255,255,.08); border-radius: 4px; padding: 8px 10px; }
#bf-crafting .bf-book h3 { font-size: 12px; margin: 0 0 4px; letter-spacing: .3px; }
#bf-crafting .bf-book-row { display: flex; gap: 8px; align-items: center; padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,.06); font-size: 11px; cursor: pointer; }
#bf-crafting .bf-book-row:hover { background: rgba(255,255,255,.06); }
#bf-crafting .bf-book-row .bf-rname { flex: 1; }
#bf-crafting .bf-book-row .bf-raff { font-size: 9px; opacity: .7; }
#bf-crafting .bf-btn { display: inline-block; margin-top: 6px; padding: 6px 14px; background: #bfa13a; color: #111; border: none; border-radius: 3px; font-weight: 700; cursor: pointer; font-size: 12px; }
#bf-crafting .bf-btn:disabled { opacity: .35; cursor: not-allowed; }
#bf-crafting .bf-close { position: absolute; top: 6px; right: 10px; font-size: 16px; cursor: pointer; color: rgba(255,255,255,.6); }
`;

export interface CraftingUIState {
  readonly hasCraftbench: boolean;
  readonly carried: readonly (ItemStack | null)[];
  readonly selectedSlot: number;
}

export class CraftingUI {
  readonly root: HTMLDivElement;
  private gridArea: HTMLDivElement;
  private previewBox: HTMLDivElement;
  private bookArea: HTMLDivElement;
  private craftBtn: HTMLButtonElement;
  private pageLabel: HTMLSpanElement;
  private closeBtn: HTMLDivElement;
  private grid: CraftingGrid;
  private recipesPage: number = 0;
  private recipesPerPage = 5;
  private recipes: readonly Recipe[] = [];
  private previewMatch: ReturnType<typeof preview> = null;
  private stateCache: CraftingUIState | null = null;

  constructor(parent: HTMLElement = document.body) {
    if (!document.getElementById(CSS_ID)) {
      const s = document.createElement("style"); s.id = CSS_ID; s.textContent = CSS; document.head.appendChild(s);
    }
    this.root = document.createElement("div"); this.root.id = "bf-crafting";
    this.root.innerHTML = `
      <div class="bf-panel" style="position:relative;">
        <div class="bf-close" title="Close">×</div>
        <h1 class="bf-title">Crafting</h1>
        <div class="bf-sub" id="bf-csub">Place ingredients in the grid. Click a cell to place your selected item; click again to clear.</div>
        <div class="bf-row">
          <div class="bf-grid-area">
            <div style="font-size:11px; opacity:.85;">Grid</div>
            <div class="bf-grid bf-2" id="bf-cgrid"></div>
            <button class="bf-btn" id="bf-ccraft">Craft</button>
          </div>
          <div class="bf-preview">
            <div class="bf-preview-box" id="bf-cprev">
              <div style="font-size:10px; opacity:.7;">Result</div>
              <div class="bf-pname" id="bf-cpname">—</div>
              <div class="bf-ptag" id="bf-cptag">no match</div>
            </div>
          </div>
          <div class="bf-book" id="bf-cbook"></div>
        </div>
        <div style="margin-top:6px; font-size:11px; opacity:.8;">Recipe book — page <span id="bf-cpage">1</span> / <span id="bf-cpages">1</span> &nbsp; [click a recipe to see its shape]</div>
      </div>`;
    parent.appendChild(this.root);

    this.gridArea = this.root.querySelector("#bf-cgrid") as HTMLDivElement;
    this.previewBox = this.root.querySelector("#bf-cprev") as HTMLDivElement;
    this.bookArea = this.root.querySelector("#bf-cbook") as HTMLDivElement;
    this.craftBtn = this.root.querySelector("#bf-ccraft") as HTMLButtonElement;
    this.pageLabel = this.root.querySelector("#bf-cpage") as HTMLSpanElement;
    this.closeBtn = this.root.querySelector(".bf-close") as HTMLDivElement;

    this.closeBtn.addEventListener("click", () => this.close());
    this.craftBtn.addEventListener("click", () => {
      if (this.previewMatch) {
        const outcome = craft(this.grid);
        if (outcome) window.dispatchEvent(new CustomEvent("bf-craft-done", { detail: outcome }));
      }
    });
    this.grid = createGrid(2);
    this.redrawGrid();
  }

  open(state: CraftingUIState): void {
    void this.recipes; // suppress unused-declaration diagnostic; property is assigned in renderBook
    this.stateCache = state;
    this.root.classList.add("bf-open");
    this.renderBook();
    this.updateGridFromState();
  }

  close(): void {
    this.root.classList.remove("bf-open");
  }

  isOpen(): boolean {
    return this.root.classList.contains("bf-open");
  }

  private updateGridFromState(): void {
    const s = this.stateCache;
    if (!s) return;
    const sz = gridSize(s.hasCraftbench);
    if (this.grid.width !== sz) {
      this.grid = createGrid(sz); // clear on bench enter/leave (minimal)
    }
    this.redrawGrid();
  }

  private redrawGrid(): void {
    this.gridArea.className = "bf-grid bf-" + this.grid.width;
    this.gridArea.innerHTML = "";
    const sz = this.grid.width;
    for (let i = 0; i < sz * sz; i++) {
      const cell = document.createElement("div");
      cell.className = "bf-cell" + (this.grid.cells[i] ? " bf-filled" : "");
      cell.textContent = this.grid.cells[i] ? (this.grid.cells[i]!.id.length > 10 ? this.grid.cells[i]!.id.slice(0, 7) + "…" : this.grid.cells[i]!.id.replace(/_/g, " ").slice(0, 10)) : "";
      cell.addEventListener("click", () => this.toggleCell(i));
      this.gridArea.appendChild(cell);
    }
    this.refreshPreview();
  }

  private toggleCell(index: number): void {
    const s = this.stateCache;
    if (!s) return;
    const held: ItemStack | null = (s.carried[s.selectedSlot] ?? null) as ItemStack | null;
    if (this.grid.cells[index]) {
      // Clear: return item to inventory (simulated by clearing the cell; real return handled by game loop on craft/clear).
      this.grid = gridWithout(this.grid, [index]);
    } else if (held && held.id) {
      this.grid = gridWith(this.grid, index, held);
    }
    this.redrawGrid();
  }

  private refreshPreview(): void {
    this.previewMatch = preview(this.grid);
    if (this.previewMatch) {
      const r = this.previewMatch.recipe;
      const pname = r.result.id.replace(/_/g, " ");
      const ptag = r.kind === "shaped" ? (r.ingredients.length + " shaped") : "shapeless";
      this.previewBox.querySelector("#bf-cpname")!.textContent = pname.replace(/\b\w/g, (c) => c.toUpperCase());
      this.previewBox.querySelector("#bf-cptag")!.textContent = ptag + " · " + (r.result.count || 1) + " ×";
      this.craftBtn.disabled = false;
    } else {
      this.previewBox.querySelector("#bf-cpname")!.textContent = "—";
      this.previewBox.querySelector("#bf-cptag")!.textContent = "no match";
      this.craftBtn.disabled = true;
    }
  }

  private renderBook(): void {
    const s = this.stateCache;
    if (!s) return;
    const all = recipeBook(s.carried);
    this.recipes = all;
    const totalPages = Math.max(1, Math.ceil(all.length / this.recipesPerPage));
    const pageEl = this.root.querySelector("#bf-cpages") as HTMLSpanElement;
    if (pageEl) pageEl.textContent = String(totalPages);
    this.recipesPage = Math.min(this.recipesPage, totalPages - 1);
    if (this.pageLabel) this.pageLabel.textContent = String(this.recipesPage + 1);

    this.bookArea.innerHTML = "<h3>Affordable recipes</h3>";
    const start = this.recipesPage * this.recipesPerPage;
    const end = Math.min(start + this.recipesPerPage, all.length);
    for (let i = start; i < end; i++) {
      const rec = all[i] as Recipe;
      const row = document.createElement("div");
      row.className = "bf-book-row";
      const name = rec.result.id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      row.innerHTML = `<div class="bf-rname">${name}</div><div class="bf-raff">${rec.kind}</div>`;
      row.addEventListener("click", () => {
        const recSafe = all[i];
        if (!recSafe) return;
        const pat = recipePattern(recSafe);
        const patStr = pat.map((r) => r.map((t) => (t ?? "·")).join(" ")).join(" | ");
        alert("Recipe: " + recSafe.result.id.replace(/_/g, " ") + "\nPattern: " + patStr);
      });
      this.bookArea.appendChild(row);
    }
    // Page buttons
    const nav = document.createElement("div");
    nav.style.marginTop = "4px"; nav.style.fontSize = "11px";
    if (this.recipesPage > 0) {
      const prev = document.createElement("button"); prev.textContent = "◀"; prev.className = "bf-btn"; prev.style.padding = "2px 6px"; prev.style.marginRight = "4px";
      prev.addEventListener("click", () => { this.recipesPage--; this.renderBook(); });
      nav.appendChild(prev);
    }
    if (this.recipesPage < totalPages - 1) {
      const next = document.createElement("button"); next.textContent = "▶"; next.className = "bf-btn"; next.style.padding = "2px 6px";
      next.addEventListener("click", () => { this.recipesPage++; this.renderBook(); });
      nav.appendChild(next);
    }
    this.bookArea.appendChild(nav);
  }

  /** External override to set grid (for game loop). */
  setGrid(g: CraftingGrid): void {
    this.grid = g;
    this.redrawGrid();
  }

  getGrid(): CraftingGrid { return this.grid; }
}
