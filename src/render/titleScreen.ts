/**
 * BlockForge — title screen.
 *
 * The operator reported "no main menu screen". The game also dropped you
 * straight in with the mouse NOT captured, which is why mouse-look can feel
 * broken on first use - the player clicks, nothing seems to happen, and the
 * game is waiting for a pointer lock that never comes.
 *
 * So the title screen does three things:
 *   1. It gives the game a front door.
 *   2. Its "click to play" button is what captures the pointer, so the first
 *      click the player makes does something visible.
 *   3. It carries the disclaimer, so it is visible in the game and not only
 *      in the README.
 */

const STYLE_ID = "blockforge-title-style";

const CSS = `
#blockforge-title {
  position: fixed; inset: 0; z-index: 20;
  display: flex; align-items: center; justify-content: center;
  background:
    radial-gradient(ellipse at 50% 35%, rgba(120,170,220,.35), rgba(8,10,16,.92) 70%),
    linear-gradient(#0d1622, #060910);
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  color: #f0f2f6; pointer-events: auto;
}
#blockforge-title.bf-hidden { display: none; }
#blockforge-title .bf-title-panel {
  text-align: center; max-width: 640px; padding: 20px;
}
#blockforge-title h1 {
  margin: 0; font-size: 58px; letter-spacing: 7px; font-weight: 800;
  color: #f6f7fb;
  text-shadow: 0 4px 18px rgba(0,0,0,.85), 0 0 44px rgba(130,180,240,.32);
}
#blockforge-title .bf-tagline {
  margin: 10px 0 4px; font-size: 14px; letter-spacing: 2px; opacity: .78;
}
#blockforge-title .bf-disclaimer {
  margin: 26px auto 0; font-size: 11px; line-height: 1.7; opacity: .6;
  max-width: 520px;
}
#blockforge-title .bf-play {
  margin-top: 30px; display: inline-block;
  padding: 13px 40px; font-size: 16px; letter-spacing: 3px;
  border: 2px solid rgba(240,245,255,.85); border-radius: 3px;
  background: rgba(240,245,255,.06); color: #f6f7fb;
  cursor: pointer; font-family: inherit; font-weight: 700;
  transition: background .12s ease, transform .12s ease;
}
#blockforge-title .bf-play:hover {
  background: rgba(240,245,255,.2); transform: translateY(-1px);
}
#blockforge-title .bf-controls {
  margin-top: 30px; font-size: 12px; line-height: 1.9; opacity: .62;
}
#blockforge-title .bf-controls b { color: #fff; font-weight: 700; }
#blockforge-title .bf-world {
  margin-top: 18px; font-size: 11px; opacity: .45;
}
`;

/** The title screen. */
export class TitleScreen {
  readonly root: HTMLDivElement;
  private readonly playButton: HTMLButtonElement | null;
  private hidden = false;

  constructor(parent: HTMLElement = document.body) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    this.root = document.createElement("div");
    this.root.id = "blockforge-title";
    this.root.innerHTML = `
      <div class="bf-title-panel">
        <h1>BLOCKFORGE</h1>
        <div class="bf-tagline">an original, unofficial Minecraft-inspired voxel sandbox</div>
        <button class="bf-play" type="button">CLICK TO PLAY</button>
        <div class="bf-controls">
          <b>WASD</b> move &nbsp;&middot;&nbsp; <b>Space</b> jump &nbsp;&middot;&nbsp;
          <b>Shift</b> run &nbsp;&middot;&nbsp; <b>Mouse</b> look<br />
          <b>Left click</b> break a block &nbsp;&middot;&nbsp; <b>Right click</b> place a block
          &nbsp;&middot;&nbsp; <b>Esc</b> pause
        </div>
        <div class="bf-world">Generating world&hellip;</div>
        <div class="bf-disclaimer">
          BlockForge is an original, unofficial Minecraft-inspired voxel sandbox.
          Not affiliated with, endorsed by, or sponsored by Mojang or Microsoft.
          Minecraft is a trademark of Mojang AB / Microsoft.
        </div>
      </div>`;

    this.playButton = this.root.querySelector<HTMLButtonElement>(".bf-play");
    if (this.playButton) {
      this.playButton.addEventListener("click", () => {
        this.hide();
      });
    }

    parent.appendChild(this.root);
  }

  /** Called when the world is ready and the player can start. */
  setReady(worldInfo: string): void {
    const el = this.root.querySelector(".bf-world");
    if (el) {
      el.textContent = worldInfo;
    }
    if (this.playButton) {
      this.playButton.disabled = false;
      this.playButton.textContent = "CLICK TO PLAY";
    }
  }

  /** Hide the title screen. */
  hide(): void {
    this.hidden = true;
    this.root.classList.add("bf-hidden");
  }

  /** True when the title screen is showing. */
  get isVisible(): boolean {
    return !this.hidden;
  }

  /** True when the player has pressed play. */
  get hasStarted(): boolean {
    return this.hidden;
  }
}
