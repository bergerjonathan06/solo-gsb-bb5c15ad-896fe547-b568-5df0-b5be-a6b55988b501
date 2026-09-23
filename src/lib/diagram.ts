import type { PreparedTopology } from '../types.js';

export interface DiagramState {
  supplies: string[];
  leak?: string | null;
  /** 方案实施后可达的节点（供水侧），用于着色 */
  reachableAfter?: Set<string> | null;
  /** 推荐方案新增关闭的阀门 */
  proposedClosed?: Set<string>;
}

const W = 900;
const H = 560;

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** 确定性伪随机（LCG），保证每次布局一致 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function computeLayout(topo: PreparedTopology): Map<string, { x: number; y: number }> {
  const ids = [...topo.nodes.keys()];
  const pinned = new Map<string, { x: number; y: number }>();
  for (const [id, n] of topo.nodes) {
    if (n.x !== undefined && n.y !== undefined) pinned.set(id, { x: n.x, y: n.y });
  }
  // 全部预置坐标 → 直接使用
  if (pinned.size === ids.length) return new Map(ids.map((id) => [id, { ...pinned.get(id)! }]));

  const rng = makeRng(20260923);
  const pos = new Map<string, { x: number; y: number }>();
  let freeCount = 0;
  for (const id of ids) {
    const p = pinned.get(id);
    if (p) pos.set(id, { ...p });
    else {
      const angle = (freeCount / Math.max(1, ids.length)) * Math.PI * 2 + rng() * 0.4;
      const r = 150 + rng() * 80;
      pos.set(id, {
        x: W / 2 + Math.cos(angle) * r,
        y: H / 2 + Math.sin(angle) * r * 0.62,
      });
      freeCount++;
    }
  }

  // 简化的 Fruchterman-Reingold 力导向
  const iterations = 380;
  const k = Math.sqrt((W * H) / Math.max(1, ids.length)) * 0.85;
  const disp = new Map<string, { x: number; y: number }>();
  for (let iter = 0; iter < iterations; iter++) {
    const t = 1 - iter / iterations; // 线性降温
    for (const id of ids) disp.set(id, { x: 0, y: 0 });
    // 斥力
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos.get(ids[i])!;
        const b = pos.get(ids[j])!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) {
          dx = rng() - 0.5;
          dy = rng() - 0.5;
          d = 0.01;
        }
        const force = (k * k) / d;
        const ux = dx / d;
        const uy = dy / d;
        disp.get(ids[i])!.x += ux * force;
        disp.get(ids[i])!.y += uy * force;
        disp.get(ids[j])!.x -= ux * force;
        disp.get(ids[j])!.y -= uy * force;
      }
    }
    // 引力（沿管段）
    for (const pipe of topo.pipes) {
      const a = pos.get(pipe.from);
      const b = pos.get(pipe.to);
      if (!a || !b) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const force = (d * d) / k;
      const ux = dx / d;
      const uy = dy / d;
      disp.get(pipe.from)!.x -= ux * force;
      disp.get(pipe.from)!.y -= uy * force;
      disp.get(pipe.to)!.x += ux * force;
      disp.get(pipe.to)!.y += uy * force;
    }
    // 归中力 + 位移
    for (const id of ids) {
      if (pinned.has(id)) continue;
      const p = pos.get(id)!;
      const d = disp.get(id)!;
      d.x += (W / 2 - p.x) * 0.02;
      d.y += (H / 2 - p.y) * 0.02;
      const step = 26 * t + 2;
      const dd = Math.hypot(d.x, d.y) || 0.01;
      p.x += (d.x / dd) * Math.min(step, dd);
      p.y += (d.y / dd) * Math.min(step, dd);
      p.x = Math.max(40, Math.min(W - 40, p.x));
      p.y = Math.max(36, Math.min(H - 30, p.y));
    }
  }
  return pos;
}

/** 渲染拓扑图（每次完整重绘） */
export function renderDiagram(
  svg: SVGSVGElement,
  topo: PreparedTopology,
  state: DiagramState,
): void {
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const pos = computeLayout(topo);
  const reach = state.reachableAfter ?? null;
  const proposed = state.proposedClosed ?? new Set<string>();
  const supplySet = new Set(state.supplies);

  // 背景
  svg.appendChild(el('rect', { x: 0, y: 0, width: W, height: H, rx: 12, fill: '#0b1220' }));

  // —— 管段 ——
  for (const pipe of topo.pipes) {
    const a = pos.get(pipe.from);
    const b = pos.get(pipe.to);
    if (!a || !b) continue;
    const live =
      reach !== null && reach.has(pipe.from) && reach.has(pipe.to);
    const isProposed = pipe.valveId !== null && proposed.has(pipe.valveId);
    svg.appendChild(
      el('line', {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        stroke: isProposed ? '#f87171' : live ? '#38bdf8' : '#475569',
        'stroke-width': pipe.valveId === null ? 2.4 : 3.2,
        'stroke-dasharray': pipe.valveId === null ? 'none' : isProposed ? '7 5' : 'none',
        opacity: live || isProposed ? 1 : 0.75,
      }),
    );

    // 阀门符号：管段中点处的菱形
    if (pipe.valveId) {
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const valve = topo.valves.get(pipe.valveId);
      const originallyClosed = valve?.state === 'closed';
      const fill = isProposed ? '#ef4444' : originallyClosed ? '#1e293b' : '#0b1220';
      const stroke = isProposed
        ? '#fca5a5'
        : originallyClosed
          ? '#94a3b8'
          : '#7dd3fc';
      const r = 7;
      const angle = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 4;
      const pts = [0, 1, 2, 3]
        .map((i) => {
          const aa = angle + (i * Math.PI) / 2;
          return `${mx + Math.cos(aa) * r},${my + Math.sin(aa) * r}`;
        })
        .join(' ');
      svg.appendChild(
        el('polygon', { points: pts, fill, stroke, 'stroke-width': 2 }),
      );
      const label = el('text', {
        x: mx,
        y: my - 11,
        'text-anchor': 'middle',
        'font-size': 10,
        'font-weight': 700,
        fill: isProposed ? '#fca5a5' : originallyClosed ? '#94a3b8' : '#93c5fd',
      });
      label.textContent = pipe.valveId;
      svg.appendChild(label);
    }
  }

  // —— 节点 ——
  for (const [id, node] of topo.nodes) {
    const p = pos.get(id)!;
    const live = reach === null ? true : reach.has(id);
    const isLeak = state.leak === id;
    const isSupply = supplySet.has(id);

    if (isLeak) {
      const r = 13;
      const pts = [
        `${p.x},${p.y - r}`,
        `${p.x + r},${p.y}`,
        `${p.x},${p.y + r}`,
        `${p.x - r},${p.y}`,
      ].join(' ');
      svg.appendChild(el('polygon', { points: pts, fill: '#dc2626', stroke: '#fecaca', 'stroke-width': 2 }));
    } else if (isSupply) {
      svg.appendChild(el('circle', { cx: p.x, cy: p.y, r: 15, fill: '#0284c7', stroke: '#bae6fd', 'stroke-width': 2 }));
      const drop = el('text', { x: p.x, y: p.y + 5, 'text-anchor': 'middle', 'font-size': 15, fill: '#e0f2fe' });
      drop.textContent = '水';
      svg.appendChild(drop);
    } else if (topo.outletIds.has(id)) {
      svg.appendChild(
        el('rect', {
          x: p.x - 15,
          y: p.y - 10,
          width: 30,
          height: 20,
          rx: 5,
          fill: live ? '#0e7490' : '#334155',
          stroke: live ? '#67e8f9' : '#64748b',
          'stroke-width': 1.6,
        }),
      );
    } else {
      svg.appendChild(
        el('circle', {
          cx: p.x,
          cy: p.y,
          r: 7,
          fill: live ? '#64748b' : '#334155',
          stroke: live ? '#cbd5e1' : '#475569',
          'stroke-width': 1.4,
        }),
      );
    }

    const nameFill = isLeak ? '#fecaca' : isSupply ? '#bae6fd' : live ? '#e2e8f0' : '#94a3b8';
    const label = el('text', {
      x: p.x,
      y: p.y + 26,
      'text-anchor': 'middle',
      'font-size': 12,
      'font-weight': isLeak || isSupply ? 700 : 500,
      fill: nameFill,
    });
    label.textContent = node.name;
    if (node.name !== id) {
      const sub = el('text', {
        x: p.x,
        y: p.y + 39,
        'text-anchor': 'middle',
        'font-size': 9.5,
        fill: '#64748b',
      });
      sub.textContent = id;
      svg.appendChild(sub);
    }
  }

  // —— 图例 ——
  const legend = [
    { x: 14, color: '#0284c7', label: '供水点' },
    { x: 84, color: '#0e7490', label: '出口' },
    { x: 142, color: '#dc2626', label: '漏点' },
    { x: 200, color: '#0b1220', stroke: '#7dd3fc', label: '阀门(开)' },
    { x: 286, color: '#1e293b', stroke: '#94a3b8', label: '阀门(初始关闭)' },
    { x: 420, color: '#ef4444', stroke: '#fca5a5', label: '推荐关闭' },
  ];
  for (const item of legend) {
    svg.appendChild(el('rect', { x: item.x, y: 12, width: 11, height: 11, rx: 2, fill: item.color, stroke: item.stroke ?? 'none', 'stroke-width': 1.5 }));
    const t = el('text', { x: item.x + 15, y: 22, 'font-size': 11, fill: '#cbd5e1' });
    t.textContent = item.label;
    svg.appendChild(t);
  }
}
