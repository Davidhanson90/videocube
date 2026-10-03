export const MAX_EDGE = 512;
export const MAX_FRAMES = 180;

export interface SampledFrame {
  time: number;
  canvas: HTMLCanvasElement;
}

export interface SampledVideo {
  frames: SampledFrame[];
  duration: number;
  width: number;
  height: number;
  capped: boolean;
}

export class SampleCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "SampleCancelled";
  }
}

export function frameSampleTimes(
  duration: number,
  maxFrames = MAX_FRAMES
): { times: number[]; capped: boolean } {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("This video has no duration.");
  }
  const last = Math.max(0, duration - 0.001);
  const onePerSecond = Math.max(1, Math.floor(duration));
  if (onePerSecond <= maxFrames) {
    const times = Array.from({ length: onePerSecond }, (_, i) => Math.min(i, last));
    return { times, capped: false };
  }
  const times = Array.from({ length: maxFrames }, (_, i) =>
    maxFrames === 1 ? 0 : (i / (maxFrames - 1)) * last
  );
  return { times, capped: true };
}

export function fitEdge(
  srcW: number,
  srcH: number,
  maxEdge = MAX_EDGE
): { width: number; height: number } {
  if (srcW < 1 || srcH < 1) {
    throw new Error("This video has no picture.");
  }
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  return {
    width: Math.max(1, Math.round(srcW * scale)),
    height: Math.max(1, Math.round(srcH * scale))
  };
}

function waitFor(target: EventTarget, event: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      target.removeEventListener(event, onOk);
      target.removeEventListener("error", onErr);
      window.clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const onOk = () => finish();
    const onErr = () => finish(new Error("Could not decode that video."));
    const timer = window.setTimeout(() => finish(new Error("Timed out reading that video.")), ms);
    target.addEventListener(event, onOk);
    target.addEventListener("error", onErr);
  });
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  const last = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.04) : 0;
  const target = Math.min(Math.max(time, 0), last);
  if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) {
    return Promise.resolve();
  }
  const pending = waitFor(video, "seeked", 12000);
  try {
    video.currentTime = target;
  } catch {
    return Promise.reject(new Error("Could not seek in that video."));
  }
  return pending;
}

export async function sampleVideo(
  file: File,
  video: HTMLVideoElement,
  stillCurrent: () => boolean,
  onProgress: (done: number, total: number) => void
): Promise<SampledVideo> {
  if (!stillCurrent()) throw new SampleCancelled();
  if (file.size === 0) throw new Error("That file is empty.");
  if (
    file.type &&
    !file.type.startsWith("video/") &&
    file.type !== "application/octet-stream"
  ) {
    throw new Error("Choose a video file.");
  }

  const url = URL.createObjectURL(file);
  try {
    video.pause();
    video.src = url;
    video.load();
    await waitFor(video, "loadedmetadata", 15000);
    if (!stillCurrent()) throw new SampleCancelled();
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitFor(video, "loadeddata", 15000);
    }
    if (!stillCurrent()) throw new SampleCancelled();

    const duration = video.duration;
    const { times, capped } = frameSampleTimes(duration);
    const { width, height } = fitEdge(video.videoWidth, video.videoHeight);
    const frames: SampledFrame[] = [];

    for (let i = 0; i < times.length; i++) {
      if (!stillCurrent()) throw new SampleCancelled();
      await seekTo(video, times[i]);
      if (!stillCurrent()) throw new SampleCancelled();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not draw a frame.");
      ctx.drawImage(video, 0, 0, width, height);
      frames.push({ time: times[i], canvas });
      onProgress(i + 1, times.length);
    }

    return { frames, duration, width, height, capped };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}
