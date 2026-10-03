import { sampleMotion, type MotionField } from "./motion-field";

/** How often the play button advances one generation. */
export const WALKER_TICK_MS = 120;

export type Rng = () => number;

/**
 * Genome: `[u0, v0, du1, dv1, …]` in image space (u left→right, v top→bottom).
 * Position at frame i is the start plus the sum of steps, so a small mutation
 * bends the route instead of teleporting a single frame.
 */
export interface WalkerOptions {
  populationSize: number;
  eliteCount: number;
  tournamentSize: number;
  /** Per-step chance to add gaussian noise to that step. */
  mutationRate: number;
  mutationSigma: number;
  /** Chance a child also gets a smooth bend across a short run of steps. */
  bendRate: number;
  bendSigma: number;
  /** Fraction of each generation replaced by fresh random walks. */
  immigrantFraction: number;
  /** Faint runners-up drawn besides the best path. */
  trailCount: number;
  /** Step length (in image space) that is free of the jitter penalty. */
  jitterFree: number;
  /** Multiplier on summed squared excess step length. */
  jitterWeight: number;
  /** Multiplier on total distance spent outside 0..1, per axis. */
  outsideWeight: number;
  initStepSigma: number;
  initFastSigma: number;
  startNudge: number;
  startNudgeRate: number;
}

export const DEFAULT_WALKER_OPTIONS: WalkerOptions = {
  populationSize: 64,
  eliteCount: 4,
  tournamentSize: 3,
  mutationRate: 0.22,
  mutationSigma: 0.028,
  bendRate: 0.45,
  bendSigma: 0.02,
  immigrantFraction: 0.08,
  trailCount: 4,
  jitterFree: 0.02,
  jitterWeight: 18,
  outsideWeight: 1.5,
  initStepSigma: 0.02,
  initFastSigma: 0.055,
  startNudge: 0.05,
  startNudgeRate: 0.2
};

export interface WalkerTrail {
  u: Float32Array;
  v: Float32Array;
  role: "best" | "other";
}

export interface WalkerSnapshot {
  generation: number;
  bestFitness: number;
  bestIndex: number;
  trails: WalkerTrail[];
}

export interface FitnessWeights {
  jitterFree: number;
  jitterWeight: number;
  outsideWeight: number;
}

/**
 * Higher is better.
 *   motion  = Σ bilinear |Δ gray| at the midpoint of each step (0..1 per step)
 *   jitter  = Σ max(0, stepLength − jitterFree)²
 *   outside = Σ distance outside the unit square, per axis
 *   fitness = motion − jitterWeight·jitter − outsideWeight·outside
 */
export function scoreWalker(
  u: ArrayLike<number>,
  v: ArrayLike<number>,
  field: MotionField,
  weights: FitnessWeights
): number {
  const n = Math.min(u.length, v.length);
  const steps = Math.min(n, field.layers.length + 1);
  if (steps < 1) return 0;
  let motion = 0;
  let jitter = 0;
  let outside = 0;
  for (let i = 0; i < steps; i++) {
    const uu = u[i] ?? 0;
    const vv = v[i] ?? 0;
    if (uu < 0) outside -= uu;
    else if (uu > 1) outside += uu - 1;
    if (vv < 0) outside -= vv;
    else if (vv > 1) outside += vv - 1;
    if (i === 0) continue;
    const pu = u[i - 1] ?? 0;
    const pv = v[i - 1] ?? 0;
    const du = uu - pu;
    const dv = vv - pv;
    const excess = Math.hypot(du, dv) - weights.jitterFree;
    if (excess > 0) jitter += excess * excess;
    const layer = field.layers[i - 1];
    if (!layer) continue;
    motion += sampleMotion(layer, field.cols, field.rows, (uu + pu) * 0.5, (vv + pv) * 0.5);
  }
  const fitness = motion - weights.jitterWeight * jitter - weights.outsideWeight * outside;
  return Number.isFinite(fitness) ? fitness : -1e9;
}

function gaussian(rng: Rng): number {
  let a = 0;
  let b = 0;
  while (a === 0) a = rng();
  while (b === 0) b = rng();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(Math.PI * 2 * b);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function rankIndices(fitnesses: readonly number[]): number[] {
  return fitnesses
    .map((_, i) => i)
    .sort((a, b) => (fitnesses[b] ?? 0) - (fitnesses[a] ?? 0) || a - b);
}

function tournamentSelect(fitnesses: readonly number[], k: number, rng: Rng): number {
  const n = fitnesses.length;
  let best = Math.floor(rng() * n);
  const draws = Math.max(1, Math.min(k, n));
  for (let i = 1; i < draws; i++) {
    const c = Math.floor(rng() * n);
    if ((fitnesses[c] ?? -Infinity) > (fitnesses[best] ?? -Infinity)) best = c;
  }
  return best;
}

/**
 * Population of paths through a sampled clip. Call {@link WalkerPopulation.step}
 * once per generation (a timer or a Step button). Generation 1 is the scored
 * initial population; later steps breed, then score.
 */
export class WalkerPopulation {
  readonly options: WalkerOptions;
  readonly frameCount: number;
  generation = 0;

  private readonly field: MotionField;
  private readonly rng: Rng;
  private readonly weights: FitnessWeights;
  private genomes: Float32Array[];
  private readonly pathsU: Float32Array[];
  private readonly pathsV: Float32Array[];
  private fitnesses: number[] = [];
  private bestIndex = 0;
  private bestFitness = 0;

  constructor(field: MotionField, options: Partial<WalkerOptions> = {}, rng: Rng = Math.random) {
    if (field.layers.length < 1) throw new Error("Need at least two frames.");
    this.field = field;
    this.options = { ...DEFAULT_WALKER_OPTIONS, ...options };
    this.rng = rng;
    this.frameCount = field.layers.length + 1;
    this.weights = {
      jitterFree: this.options.jitterFree,
      jitterWeight: this.options.jitterWeight,
      outsideWeight: this.options.outsideWeight
    };
    const pop = Math.max(2, this.options.populationSize);
    this.options.populationSize = pop;
    this.genomes = [];
    this.pathsU = [];
    this.pathsV = [];
    for (let i = 0; i < pop; i++) {
      this.genomes.push(this.randomGenome(i));
      this.pathsU.push(new Float32Array(this.frameCount));
      this.pathsV.push(new Float32Array(this.frameCount));
    }
    this.seedStraights();
  }

  /** Score the current population, breeding first once generation 1 exists. */
  step(): WalkerSnapshot {
    if (this.generation > 0 && this.fitnesses.length === this.genomes.length) {
      this.breed();
      this.generation += 1;
    } else {
      this.generation = 1;
    }
    this.evaluate();
    return this.snapshot();
  }

  private randomGenome(index: number): Float32Array {
    const n = this.frameCount;
    const g = new Float32Array(n * 2);
    const rng = this.rng;
    g[0] = rng();
    g[1] = rng();
    const fast = index < Math.ceil(this.options.populationSize * 0.25);
    const sigma = fast ? this.options.initFastSigma : this.options.initStepSigma;
    for (let i = 1; i < n; i++) {
      g[i * 2] = gaussian(rng) * sigma;
      g[i * 2 + 1] = gaussian(rng) * sigma;
    }
    return g;
  }

  /** A few constant-velocity paths so horizontal and diagonal motion is in the initial mix. */
  private seedStraights(): void {
    const n = this.frameCount;
    const headings = [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4];
    const travels = [0.35, 0.8];
    const speedDen = Math.max(1, n - 1);
    let slot = 0;
    for (const travel of travels) {
      const speed = travel / speedDen;
      for (const heading of headings) {
        if (slot >= this.genomes.length) return;
        const g = new Float32Array(n * 2);
        g[0] = 0.5 - Math.cos(heading) * travel * 0.5;
        g[1] = 0.5 - Math.sin(heading) * travel * 0.5;
        const du = Math.cos(heading) * speed;
        const dv = Math.sin(heading) * speed;
        for (let i = 1; i < n; i++) {
          g[i * 2] = du;
          g[i * 2 + 1] = dv;
        }
        this.genomes[slot] = g;
        slot += 1;
      }
    }
  }

  private decode(genome: Float32Array, u: Float32Array, v: Float32Array): void {
    const n = this.frameCount;
    let x = genome[0] ?? 0;
    let y = genome[1] ?? 0;
    u[0] = x;
    v[0] = y;
    for (let i = 1; i < n; i++) {
      x += genome[i * 2] ?? 0;
      y += genome[i * 2 + 1] ?? 0;
      u[i] = x;
      v[i] = y;
    }
  }

  private evaluate(): void {
    const n = this.genomes.length;
    this.fitnesses = new Array<number>(n);
    let best = -Infinity;
    let bestIndex = 0;
    for (let i = 0; i < n; i++) {
      const u = this.pathsU[i]!;
      const v = this.pathsV[i]!;
      this.decode(this.genomes[i]!, u, v);
      const fitness = scoreWalker(u, v, this.field, this.weights);
      this.fitnesses[i] = fitness;
      if (fitness > best) {
        best = fitness;
        bestIndex = i;
      }
    }
    this.bestFitness = Number.isFinite(best) ? best : 0;
    this.bestIndex = bestIndex;
  }

  private crossover(a: Float32Array, b: Float32Array): Float32Array {
    const points = this.frameCount;
    const cut = Math.floor(this.rng() * (points + 1));
    const child = new Float32Array(a.length);
    const genes = cut * 2;
    child.set(a.subarray(0, genes));
    child.set(b.subarray(genes), genes);
    return child;
  }

  private mutate(genome: Float32Array): void {
    const rng = this.rng;
    const n = this.frameCount;
    const opt = this.options;
    if (rng() < opt.startNudgeRate) {
      genome[0] = (genome[0] ?? 0) + gaussian(rng) * opt.startNudge;
      genome[1] = (genome[1] ?? 0) + gaussian(rng) * opt.startNudge;
    }
    for (let i = 1; i < n; i++) {
      if (rng() < opt.mutationRate) {
        genome[i * 2] = clamp((genome[i * 2] ?? 0) + gaussian(rng) * opt.mutationSigma, -0.6, 0.6);
        genome[i * 2 + 1] = clamp((genome[i * 2 + 1] ?? 0) + gaussian(rng) * opt.mutationSigma, -0.6, 0.6);
      }
    }
    if (n > 2 && rng() < opt.bendRate) {
      const center = 1 + Math.floor(rng() * (n - 1));
      const radius = 2 + Math.floor(rng() * 6);
      const du = gaussian(rng) * opt.bendSigma;
      const dv = gaussian(rng) * opt.bendSigma;
      for (let k = -radius; k <= radius; k++) {
        const i = center + k;
        if (i < 1 || i >= n) continue;
        const w = 1 - Math.abs(k) / (radius + 1);
        genome[i * 2] = clamp((genome[i * 2] ?? 0) + du * w, -0.6, 0.6);
        genome[i * 2 + 1] = clamp((genome[i * 2 + 1] ?? 0) + dv * w, -0.6, 0.6);
      }
    }
  }

  private breed(): void {
    const fitnesses = this.fitnesses;
    const order = rankIndices(fitnesses);
    const pop = this.genomes.length;
    const elite = Math.min(this.options.eliteCount, pop);
    const immigrants = Math.min(
      Math.max(0, pop - elite - 1),
      Math.max(0, Math.round(pop * this.options.immigrantFraction))
    );
    const next: Float32Array[] = [];
    for (let i = 0; i < elite; i++) next.push(this.genomes[order[i]!]!.slice());
    while (next.length < pop - immigrants) {
      const a = this.genomes[tournamentSelect(fitnesses, this.options.tournamentSize, this.rng)]!;
      const b = this.genomes[tournamentSelect(fitnesses, this.options.tournamentSize, this.rng)]!;
      const child = this.crossover(a, b);
      this.mutate(child);
      next.push(child);
    }
    let immigrant = 0;
    while (next.length < pop) {
      next.push(this.randomGenome(immigrant));
      immigrant += 1;
    }
    this.genomes = next;
  }

  private snapshot(): WalkerSnapshot {
    const order = rankIndices(this.fitnesses);
    const shown = Math.min(order.length, this.options.trailCount + 1);
    const trails: WalkerTrail[] = [];
    for (let r = 0; r < shown; r++) {
      const i = order[r]!;
      trails.push({
        u: this.pathsU[i]!.slice(),
        v: this.pathsV[i]!.slice(),
        role: r === 0 ? "best" : "other"
      });
    }
    return {
      generation: this.generation,
      bestFitness: this.bestFitness,
      bestIndex: this.bestIndex,
      trails
    };
  }
}
