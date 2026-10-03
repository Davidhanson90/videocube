import type { SampledFrame } from "./sample-frames";

/** Long edge of the coarse grid used for frame-to-frame difference. */
export const MOTION_LONG_EDGE = 40;

export interface MotionField {
  cols: number;
  rows: number;
  /**
   * Absolute grayscale difference between frame i and i + 1.
   * Each layer is `cols * rows`, row-major, values in 0..1.
   */
  layers: Float32Array[];
  frameCount: number;
}

export function motionGridSize(
  width: number,
  height: number,
  longEdge = MOTION_LONG_EDGE
): { cols: number; rows: number } {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  if (w >= h) {
    return { cols: longEdge, rows: Math.max(8, Math.round((longEdge * h) / w)) };
  }
  return { cols: Math.max(8, Math.round((longEdge * w) / h)), rows: longEdge };
}

function grayGrid(
  source: HTMLCanvasElement,
  cols: number,
  rows: number,
  scratch: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D
): Float32Array {
  if (scratch.width !== cols) scratch.width = cols;
  if (scratch.height !== rows) scratch.height = rows;
  ctx.drawImage(source, 0, 0, cols, rows);
  const data = ctx.getImageData(0, 0, cols, rows).data;
  const out = new Float32Array(cols * rows);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!) / 255;
  }
  return out;
}

/**
 * Downsampled absolute difference between consecutive frames.
 * Cheap stand-in for a motion field: no optical flow, no ML.
 */
export function buildMotionField(frames: readonly SampledFrame[]): MotionField {
  if (frames.length < 2) {
    return { cols: 0, rows: 0, layers: [], frameCount: frames.length };
  }
  const { cols, rows } = motionGridSize(frames[0]!.canvas.width, frames[0]!.canvas.height);
  const scratch = document.createElement("canvas");
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return { cols: 0, rows: 0, layers: [], frameCount: frames.length };
  }
  ctx.imageSmoothingEnabled = true;
  const layers: Float32Array[] = [];
  let prev = grayGrid(frames[0]!.canvas, cols, rows, scratch, ctx);
  for (let i = 1; i < frames.length; i++) {
    const next = grayGrid(frames[i]!.canvas, cols, rows, scratch, ctx);
    const diff = new Float32Array(cols * rows);
    for (let k = 0; k < diff.length; k++) diff[k] = Math.abs(next[k]! - prev[k]!);
    layers.push(diff);
    prev = next;
  }
  return { cols, rows, layers, frameCount: frames.length };
}

/** Bilinear sample. Points outside the frame contribute no motion. */
export function sampleMotion(
  layer: ArrayLike<number>,
  cols: number,
  rows: number,
  u: number,
  v: number
): number {
  if (cols < 1 || rows < 1) return 0;
  if (u < 0 || v < 0 || u > 1 || v > 1) return 0;
  const x = u * (cols - 1);
  const y = v * (rows - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, cols - 1);
  const y1 = Math.min(y0 + 1, rows - 1);
  const tx = x - x0;
  const ty = y - y0;
  const i00 = layer[y0 * cols + x0] ?? 0;
  const i10 = layer[y0 * cols + x1] ?? 0;
  const i01 = layer[y1 * cols + x0] ?? 0;
  const i11 = layer[y1 * cols + x1] ?? 0;
  const a = i00 + (i10 - i00) * tx;
  const b = i01 + (i11 - i01) * tx;
  return a + (b - a) * ty;
}
