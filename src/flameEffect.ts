interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  type: 'debris' | 'spark' | 'core';
  player: 'black' | 'white';
}

interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
}

interface Explosion {
  x: number;
  y: number;
  player: 'black' | 'white';
  frame: number;
  particles: Particle[];
  shockwave: Shockwave;
}

interface TrailPoint {
  x: number;
  y: number;
}

interface SwapPiece {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  player: 'black' | 'white';
  trail: TrailPoint[];
}

interface SwapAnim {
  pieceA: SwapPiece;
  pieceB: SwapPiece;
  frame: number;
}

const EXPLOSION_DURATION = 36;
const SWAP_DURATION = 36;       // frames: 24 anim + 12 trail fade (~600ms)
const TRAIL_MAX = 16;

function swapEase(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t;
}

class EffectCanvas {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private explosions: Explosion[] = [];
  private swapAnims: SwapAnim[] = [];
  private rafId: number | null = null;
  private dpr = 1;
  private boardW = 0;
  private boardH = 0;

  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  syncSize(boardEl: HTMLElement) {
    if (!this.canvas) return;
    const rect = boardEl.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.boardW = rect.width;
    this.boardH = rect.height;
    this.canvas.style.width = `${this.boardW}px`;
    this.canvas.style.height = `${this.boardH}px`;
    this.canvas.width = this.boardW * this.dpr;
    this.canvas.height = this.boardH * this.dpr;
    if (this.ctx) {
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
  }

  // ---- Explosion ----
  emit(cx: number, cy: number, player: 'black' | 'white') {
    const particles: Particle[] = [];
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 2;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 8 + Math.random() * 6, maxLife: 14,
        size: 8 + Math.random() * 6, type: 'core', player,
      });
    }
    for (let i = 0; i < 16; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 6;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 10 + Math.random() * 10, maxLife: 20,
        size: 1.5 + Math.random() * 2.5, type: 'spark', player,
      });
    }
    for (let i = 0; i < 55; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 5;
      particles.push({
        x: cx + (Math.random() - 0.5) * 4, y: cy + (Math.random() - 0.5) * 4,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.85,
        life: 15 + Math.random() * 25, maxLife: 20 + Math.random() * 20,
        size: 2.5 + Math.random() * 7, type: 'debris', player,
      });
    }
    const shockwave: Shockwave = {
      x: cx, y: cy, radius: 6,
      maxRadius: 80 + Math.random() * 20, alpha: 1,
    };
    this.explosions.push({ x: cx, y: cy, player, frame: 0, particles, shockwave });
    if (!this.rafId) this.startLoop();
  }

  // ---- Swap animation ----
  animateSwap(
    x1: number, y1: number, x2: number, y2: number,
    player1: 'black' | 'white', player2: 'black' | 'white',
  ) {
    const pieceA: SwapPiece = {
      startX: x1, startY: y1, endX: x2, endY: y2,
      player: player1, trail: [],
    };
    const pieceB: SwapPiece = {
      startX: x2, startY: y2, endX: x1, endY: y1,
      player: player2, trail: [],
    };
    this.swapAnims.push({ pieceA, pieceB, frame: 0 });
    if (!this.rafId) this.startLoop();
  }

  // ---- Loop ----
  private startLoop() {
    const tick = () => {
      this.update();
      this.draw();
      if (this.explosions.length > 0 || this.swapAnims.length > 0) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.rafId = null;
        this.clearCanvas();
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private clearCanvas() {
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.boardW, this.boardH);
    }
  }

  // ---- Update ----
  private update() {
    // --- Explosions ---
    for (let ei = this.explosions.length - 1; ei >= 0; ei--) {
      const ex = this.explosions[ei];
      ex.frame++;
      for (let i = ex.particles.length - 1; i >= 0; i--) {
        const p = ex.particles[i];
        p.x += p.vx; p.y += p.vy;
        const drag = p.type === 'spark' ? 0.94 : p.type === 'core' ? 0.92 : 0.955;
        p.vx *= drag; p.vy *= drag;
        p.size *= p.type === 'spark' ? 0.98 : 0.97;
        p.life--;
        if (p.life <= 0 || p.size < 0.3) ex.particles.splice(i, 1);
      }
      const sw = ex.shockwave;
      const t = ex.frame / EXPLOSION_DURATION;
      sw.radius = 6 + (sw.maxRadius - 6) * Math.pow(t, 0.7);
      sw.alpha = 1 - Math.pow(t, 1.5);
      if (ex.frame >= EXPLOSION_DURATION && ex.particles.length === 0) {
        this.explosions.splice(ei, 1);
      }
    }

    // --- Swap anims ---
    for (let si = this.swapAnims.length - 1; si >= 0; si--) {
      const sa = this.swapAnims[si];
      sa.frame++;
      const rawT = Math.min(sa.frame / 24, 1);
      const easedT = swapEase(rawT);

      for (const piece of [sa.pieceA, sa.pieceB]) {
        const cx = piece.startX + (piece.endX - piece.startX) * easedT;
        const cy = piece.startY + (piece.endY - piece.startY) * easedT;
        piece.trail.push({ x: cx, y: cy });
        if (piece.trail.length > TRAIL_MAX) piece.trail.shift();
      }

      if (sa.frame >= SWAP_DURATION) {
        this.swapAnims.splice(si, 1);
      }
    }

  }

  // ---- Draw ----
  private draw() {
    const ctx = this.ctx!;
    ctx.clearRect(0, 0, this.boardW, this.boardH);

    // --- Draw swap anims (under explosions) ---
    for (const sa of this.swapAnims) {
      for (const piece of [sa.pieceA, sa.pieceB]) {
        if (piece.trail.length < 2) continue;
        const isBlack = piece.player === 'black';

        // Draw trail: fading circles from old → recent
        for (let i = 0; i < piece.trail.length - 1; i++) {
          const tp = piece.trail[i];
          const alpha = (i / piece.trail.length) * 0.5;
          const size = 12.75 * (i / piece.trail.length);
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle = isBlack ? '#444' : '#ddd';
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, size, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // Draw main piece (last trail point)
        const head = piece.trail[piece.trail.length - 1];
        const stoneR = 12.75;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.25)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = isBlack ? '#212121' : '#FAFAFA';
        ctx.beginPath();
        ctx.arc(head.x, head.y, stoneR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.fillStyle = isBlack ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.arc(head.x - 3, head.y - 3, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // --- Draw explosions ---
    for (const ex of this.explosions) {
      const isBlack = ex.player === 'black';

      // Shockwave
      const sw = ex.shockwave;
      if (sw.alpha > 0.01) {
        ctx.save();
        ctx.globalAlpha = sw.alpha;
        ctx.strokeStyle = isBlack ? '#aaa' : '#fff';
        ctx.lineWidth = 4 * (1 - ex.frame / EXPLOSION_DURATION);
        ctx.shadowColor = isBlack ? 'rgba(180,180,180,0.6)' : 'rgba(255,255,255,0.7)';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      for (const p of ex.particles) {
        const t = p.life / p.maxLife;
        let r: number, g: number, b: number, alpha: number;
        let shadowR: number, shadowG: number, shadowB: number, shadowA: number;

        if (isBlack) {
          if (p.type === 'core') {
            if (t > 0.5) { r = 240; g = 240; b = 240; alpha = 1; }
            else { const s = t * 2; const v = Math.floor(160 * s); r = v; g = v; b = v; alpha = s; }
            shadowR = 200; shadowG = 200; shadowB = 200; shadowA = 0.7;
          } else if (p.type === 'spark') {
            if (t > 0.6) { r = 255; g = 255; b = 255; alpha = 1; }
            else if (t > 0.3) { const s = (t - 0.3) / 0.3; const v = Math.floor(180 + s * 75); r = v; g = v; b = v; alpha = 0.9; }
            else { const v = Math.floor(120 * t / 0.3); r = v; g = v; b = v; alpha = t / 0.3; }
            shadowR = 220; shadowG = 220; shadowB = 220; shadowA = 0.7;
          } else {
            if (t > 0.7) { const s = (t - 0.7) / 0.3; const v = Math.floor(180 + s * 75); r = v; g = v; b = v; alpha = 1; }
            else if (t > 0.4) { const s = (t - 0.4) / 0.3; const v = Math.floor(100 + s * 80); r = v; g = v; b = v; alpha = 0.85; }
            else if (t > 0.15) { const s = (t - 0.15) / 0.25; const v = Math.floor(30 + s * 70); r = v; g = v; b = v; alpha = 0.5 + s * 0.35; }
            else { const s = t / 0.15; const v = Math.floor(20 * s); r = v; g = v; b = v; alpha = s * 0.5; }
            shadowR = 100; shadowG = 100; shadowB = 100; shadowA = 0.4;
          }
        } else {
          if (p.type === 'core') {
            if (t > 0.5) { r = 255; g = 250; b = 235; alpha = 1; }
            else { const s = t * 2; r = 255; g = Math.floor(220 * s); b = Math.floor(180 * s); alpha = s; }
            shadowR = 255; shadowG = 240; shadowB = 200; shadowA = 0.7;
          } else if (p.type === 'spark') {
            if (t > 0.6) { r = 255; g = 255; b = 245; alpha = 1; }
            else if (t > 0.3) { const s = (t - 0.3) / 0.3; r = 255; g = Math.floor(220 + s * 35); b = Math.floor(180 + s * 65); alpha = 0.9; }
            else { r = Math.floor(200 * t / 0.3); g = Math.floor(180 * t / 0.3); b = Math.floor(150 * t / 0.3); alpha = t / 0.3; }
            shadowR = 255; shadowG = 240; shadowB = 200; shadowA = 0.7;
          } else {
            if (t > 0.7) { const s = (t - 0.7) / 0.3; r = 255; g = Math.floor(230 + s * 25); b = Math.floor(200 + s * 55); alpha = 1; }
            else if (t > 0.4) { const s = (t - 0.4) / 0.3; r = 240; g = Math.floor(200 + s * 40); b = Math.floor(160 + s * 40); alpha = 0.85; }
            else if (t > 0.15) { const s = (t - 0.15) / 0.25; r = Math.floor(180 + s * 60); g = Math.floor(150 + s * 50); b = Math.floor(120 + s * 40); alpha = 0.5 + s * 0.35; }
            else { const s = t / 0.15; r = Math.floor(140 * s); g = Math.floor(120 * s); b = Math.floor(100 * s); alpha = s * 0.5; }
            shadowR = 200; shadowG = 180; shadowB = 150; shadowA = 0.4;
          }
        }

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        if (p.type === 'spark') {
          ctx.shadowColor = `rgba(${shadowR},${shadowG},${shadowB},${shadowA + 0.1})`;
          ctx.shadowBlur = p.size * 2;
        } else if (p.type === 'core') {
          ctx.shadowColor = `rgba(${shadowR},${shadowG},${shadowB},${shadowA})`;
          ctx.shadowBlur = p.size * 4;
        } else {
          ctx.shadowColor = `rgba(${shadowR},${shadowG},${shadowB},${shadowA})`;
          ctx.shadowBlur = p.size * 2;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }
}

export const flameCanvas = new EffectCanvas();
