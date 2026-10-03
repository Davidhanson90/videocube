import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import {
  BoxGeometry,
  CanvasTexture,
  DoubleSide,
  EdgesGeometry,
  Group,
  LinearFilter,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type Material
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { SampledFrame } from "./sample-frames";

interface Slice {
  mesh: Mesh;
  material: MeshBasicMaterial;
  time: number;
}

const GAP = 0.03;

@customElement("cube-view")
export class CubeView extends LitElement {
  static override styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 280px;
      touch-action: none;
    }
    .stage {
      width: 100%;
      height: 100%;
      touch-action: none;
    }
    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
  `;

  private booted = false;
  private renderer: WebGLRenderer | null = null;
  private camera: PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private readonly stack = new Group();
  private slices: Slice[] = [];
  private geometry: PlaneGeometry | null = null;
  private bounds: LineSegments | null = null;
  private raf = 0;
  private resizeObserver: ResizeObserver | null = null;
  private highlight = 0;
  private cutoff = Number.POSITIVE_INFINITY;
  private sigma = 1;

  protected override shouldUpdate(): boolean {
    return !this.booted;
  }

  override render() {
    return html`<div class="stage"></div>`;
  }

  override firstUpdated(): void {
    this.booted = true;
    const stage = this.renderRoot.querySelector(".stage");
    if (!(stage instanceof HTMLDivElement)) return;

    const renderer = new WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setClearColor(0x0e1116, 1);
    stage.append(renderer.domElement);

    const scene = new Scene();
    scene.add(this.stack);
    const camera = new PerspectiveCamera(45, 1, 0.05, 100);
    camera.position.set(2.2, 1.2, 3.4);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);

    this.renderer = renderer;
    this.camera = camera;
    this.controls = controls;

    const resize = () => this.resize();
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(stage);
    this.resize();

    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.disposeStack();
    this.controls?.dispose();
    this.renderer?.dispose();
    this.renderer = null;
  }

  clear(): void {
    this.disposeStack();
  }

  setFrames(frames: SampledFrame[]): void {
    this.disposeStack();
    if (frames.length === 0 || !this.camera || !this.controls) return;

    const aspect = frames[0].canvas.width / frames[0].canvas.height;
    const longEdge = 2.2;
    const planeW = aspect >= 1 ? longEdge : longEdge * aspect;
    const planeH = aspect >= 1 ? longEdge / aspect : longEdge;
    const n = frames.length;
    const depth = (n - 1) * GAP;

    this.geometry = new PlaneGeometry(planeW, planeH);
    frames.forEach((frame, i) => {
      const texture = new CanvasTexture(frame.canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      texture.generateMipmaps = false;
      const material = new MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.26,
        side: DoubleSide,
        depthWrite: false
      });
      const mesh = new Mesh(this.geometry!, material);
      mesh.position.z = depth / 2 - i * GAP;
      mesh.renderOrder = n - i;
      this.stack.add(mesh);
      this.slices.push({ mesh, material, time: frame.time });
    });

    const box = new BoxGeometry(planeW, planeH, Math.max(depth, 0.02));
    const edges = new EdgesGeometry(box);
    box.dispose();
    this.bounds = new LineSegments(
      edges,
      new LineBasicMaterial({ color: 0x9bb0c6, transparent: true, opacity: 0.45 })
    );
    this.stack.add(this.bounds);

    const span = Math.max(planeW, planeH, depth + 0.4);
    const dist = span * 1.2 + 0.6;
    this.camera.position.set(dist * 0.62, dist * 0.36, dist * 0.95);
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    const spacing = n > 1 ? Math.abs(frames[1].time - frames[0].time) : 1;
    this.sigma = Math.max(0.55, spacing * 1.15);
    this.applyLook();
  }

  setHighlight(time: number): void {
    this.highlight = time;
    this.applyLook();
  }

  setCutoff(time: number): void {
    this.cutoff = time;
    this.applyLook();
  }

  private resize(): void {
    const stage = this.renderRoot.querySelector(".stage");
    if (!(stage instanceof HTMLDivElement) || !this.renderer || !this.camera) return;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (width < 2 || height < 2) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private applyLook(): void {
    const peak = 1;
    const base = 0.26;
    const denom = 2 * this.sigma * this.sigma;
    for (const slice of this.slices) {
      const hidden = slice.time > this.cutoff + 1e-3;
      slice.mesh.visible = !hidden;
      if (hidden) continue;
      const d = slice.time - this.highlight;
      const weight = Math.exp(-(d * d) / denom);
      slice.material.opacity = base + (peak - base) * weight;
    }
  }

  private disposeStack(): void {
    for (const slice of this.slices) {
      slice.material.map?.dispose();
      slice.material.dispose();
      this.stack.remove(slice.mesh);
    }
    this.slices = [];
    this.geometry?.dispose();
    this.geometry = null;
    if (this.bounds) {
      this.bounds.geometry.dispose();
      const material = this.bounds.material;
      if (!Array.isArray(material)) (material as Material).dispose();
      this.stack.remove(this.bounds);
      this.bounds = null;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cube-view": CubeView;
  }
}
