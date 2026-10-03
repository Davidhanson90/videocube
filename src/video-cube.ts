import { LitElement, css, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import "./cube-view";
import type { CubeView } from "./cube-view";
import { SampleCancelled, sampleVideo, type SampledVideo } from "./sample-frames";

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds + 1e-6);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

@customElement("video-cube")
export class VideoCube extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      grid-template-rows: auto minmax(280px, 1fr);
      position: relative;
      height: 100%;
      min-height: 100%;
      overflow: hidden;
      background: #0e1116;
      color: #e7edf4;
      font: 15px/1.45 ui-sans-serif, system-ui, sans-serif;
    }
    video {
      position: absolute;
      width: 2px;
      height: 2px;
      opacity: 0;
      pointer-events: none;
    }
    .panel {
      padding: 16px 20px 14px;
      border-bottom: 1px solid #1c2430;
      display: grid;
      gap: 10px;
    }
    .panel.over {
      background: #141a24;
    }
    h1 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 650;
      letter-spacing: -0.02em;
    }
    .hint,
    .meta,
    .status {
      margin: 0;
      color: #9aa8b8;
      font-size: 0.92rem;
    }
    .status.error {
      color: #ffb4a8;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 16px;
      align-items: center;
    }
    label.file {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #1a2330;
      border: 1px solid #2c3a4d;
      border-radius: 8px;
      padding: 6px 12px;
      cursor: pointer;
    }
    label.file input {
      max-width: 220px;
    }
    .sliders {
      display: grid;
      gap: 6px;
    }
    .sliders label {
      display: grid;
      grid-template-columns: 92px 1fr auto;
      gap: 10px;
      align-items: center;
      font-size: 0.88rem;
      color: #c5d0dc;
    }
    input[type="range"] {
      width: 100%;
      accent-color: #8eb4ff;
    }
    .clock {
      min-width: 3.2rem;
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: #9aa8b8;
    }
    cube-view {
      min-height: 0;
    }
    @media (max-width: 640px) {
      .sliders label {
        grid-template-columns: 72px 1fr auto;
      }
    }
  `;

  @state() private filename = "";
  @state() private duration = 0;
  @state() private frameCount = 0;
  @state() private capped = false;
  @state() private highlight = 0;
  @state() private cutoff = 0;
  @state() private ready = false;
  @state() private sampling = false;
  @state() private status = "";
  @state() private error = "";
  @state() private dragOver = false;

  @query("cube-view") private view?: CubeView;
  @query("video") private video?: HTMLVideoElement;

  private generation = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("dragover", this.onDragOver);
    this.addEventListener("dragleave", this.onDragLeave);
    this.addEventListener("drop", this.onDrop);
  }

  override disconnectedCallback(): void {
    this.removeEventListener("dragover", this.onDragOver);
    this.removeEventListener("dragleave", this.onDragLeave);
    this.removeEventListener("drop", this.onDrop);
    this.generation += 1;
    super.disconnectedCallback();
  }

  override render() {
    const max = this.ready ? Math.max(this.duration, 0.001) : 1;
    const frameNote = this.ready
      ? this.capped
        ? `showing ${this.frameCount} frames, sampled evenly (cap 180)`
        : `showing ${this.frameCount} frames`
      : "";
    return html`
      <div class="panel ${this.dragOver ? "over" : ""}">
        <div>
          <h1>videocube</h1>
          <p class="hint">Drop a video, drag to orbit, slider to slice time.</p>
        </div>
        <div class="row">
          <label class="file">
            <input
              type="file"
              accept="video/*"
              @change=${this.onFile}
              ?disabled=${this.sampling}
            />
          </label>
          <p class="meta">
            ${this.filename ? this.filename : "No video yet"}
            ${this.ready ? html` · ${formatClock(this.duration)} · ${frameNote}` : ""}
          </p>
        </div>
        <div class="sliders">
          <label>
            Slice
            <input
              type="range"
              min="0"
              max=${max}
              step="0.01"
              .value=${String(this.highlight)}
              @input=${this.onSlice}
              ?disabled=${!this.ready}
            />
            <span class="clock">${formatClock(this.highlight)}</span>
          </label>
          <label>
            Show up to
            <input
              type="range"
              min="0"
              max=${max}
              step="0.01"
              .value=${String(this.cutoff)}
              @input=${this.onCutoff}
              ?disabled=${!this.ready}
            />
            <span class="clock">${formatClock(this.cutoff)}</span>
          </label>
        </div>
        ${this.error
          ? html`<p class="status error">${this.error}</p>`
          : this.status
            ? html`<p class="status">${this.status}</p>`
            : ""}
      </div>
      <cube-view></cube-view>
      <video playsinline muted preload="auto"></video>
    `;
  }

  private onDragOver = (event: DragEvent) => {
    event.preventDefault();
    this.dragOver = true;
  };

  private onDragLeave = () => {
    this.dragOver = false;
  };

  private onDrop = (event: DragEvent) => {
    event.preventDefault();
    this.dragOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) void this.loadFile(file);
  };

  private onFile(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    input.value = "";
    if (file) void this.loadFile(file);
  }

  private onSlice(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    this.highlight = Number(input.value);
    this.view?.setHighlight(this.highlight);
  }

  private onCutoff(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    this.cutoff = Number(input.value);
    this.view?.setCutoff(this.cutoff);
  }

  private async loadFile(file: File): Promise<void> {
    const id = ++this.generation;
    this.error = "";
    this.status = "Reading video…";
    this.sampling = true;
    this.ready = false;
    this.filename = file.name;
    this.frameCount = 0;
    this.capped = false;
    await this.updateComplete;
    this.view?.clear();
    const video = this.video;
    if (!video) {
      this.fail(id, "Could not decode that video.");
      return;
    }
    try {
      const sampled = await sampleVideo(
        file,
        video,
        () => id === this.generation,
        (done, total) => {
          if (id !== this.generation) return;
          this.status = `Sampling ${done} / ${total}`;
        }
      );
      if (id !== this.generation) return;
      this.applySample(sampled);
    } catch (err) {
      if (id !== this.generation || err instanceof SampleCancelled) return;
      const message = err instanceof Error && err.message ? err.message : "Could not decode that video.";
      this.fail(id, message);
    }
  }

  private applySample(sampled: SampledVideo): void {
    const last = sampled.frames[sampled.frames.length - 1]?.time ?? 0;
    this.duration = sampled.duration;
    this.frameCount = sampled.frames.length;
    this.capped = sampled.capped;
    this.highlight =
      sampled.frames.length > 1
        ? sampled.frames[Math.floor(sampled.frames.length / 2)].time
        : 0;
    this.cutoff = sampled.duration;
    this.view?.setFrames(sampled.frames);
    this.view?.setHighlight(this.highlight);
    this.view?.setCutoff(Math.max(this.cutoff, last));
    this.ready = true;
    this.sampling = false;
    this.status = "";
    this.error = "";
  }

  private fail(id: number, message: string): void {
    if (id !== this.generation) return;
    this.sampling = false;
    this.ready = false;
    this.status = "";
    this.error = message;
    this.view?.clear();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "video-cube": VideoCube;
  }
}
