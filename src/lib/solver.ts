import type { PreparedTopology, SearchResult, Solution, OutletStatus } from '../types.js';

/**
 * 多源 BFS：从所有供水点出发，按当前阀门状态 + 额外关闭集合判断可达节点。
 * 仅读取拓扑与阀门状态，不修改任何输入。
 */
function reachableFromSupplies(
  topo: PreparedTopology,
  supplies: string[],
  extraClosed: Set<string>,
): Set<string> {
  const { adjacency, pipeValve, valves } = topo;
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const s of supplies) {
    if (adjacency.has(s) && !seen.has(s)) {
      seen.add(s);
      queue.push(s);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    const edges = adjacency.get(cur);
    if (!edges) continue;
    for (const { to, pipeIndex } of edges) {
      if (seen.has(to)) continue;
      const valveId = pipeValve[pipeIndex];
      if (valveId !== null) {
        const v = valves.get(valveId);
        // 原本关闭，或被本方案关闭 → 管段不通
        if (!v || v.state === 'closed' || extraClosed.has(valveId)) continue;
      }
      seen.add(to);
      queue.push(to);
    }
  }
  return seen;
}

/** 从单个节点反向 BFS，找出可到达的供水点（用于标记出口由哪些水源供水） */
function feedingSupplies(
  topo: PreparedTopology,
  nodeId: string,
  supplies: Set<string>,
  extraClosed: Set<string>,
): string[] {
  const { adjacency, pipeValve, valves } = topo;
  const seen = new Set<string>([nodeId]);
  const queue = [nodeId];
  const fed: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    if (supplies.has(cur)) fed.push(cur);
    for (const { to, pipeIndex } of adjacency.get(cur) ?? []) {
      if (seen.has(to)) continue;
      const valveId = pipeValve[pipeIndex];
      if (valveId !== null) {
        const v = valves.get(valveId);
        if (!v || v.state === 'closed' || extraClosed.has(valveId)) continue;
      }
      seen.add(to);
      queue.push(to);
    }
  }
  return fed.sort();
}

/** 字典序比较两个已排序的编号列表（< 0 表示 a 在前） */
function compareIdLists(a: string[], b: string[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

/** 按索引升序枚举 n 个元素中取 k 个的所有组合（候选数组已按编号排序 → 组合天然字典序） */
function* indexCombinations(n: number, k: number): Generator<number[]> {
  if (k === 0) {
    yield [];
    return;
  }
  if (k > n) return;
  const combo = Array.from({ length: k }, (_, i) => i);
  yield combo.slice();
  for (;;) {
    let i = k - 1;
    while (i >= 0 && combo[i] === n - k + i) i--;
    if (i < 0) return;
    combo[i]++;
    for (let j = i + 1; j < k; j++) combo[j] = combo[j - 1] + 1;
    yield combo.slice();
  }
}

function buildSolution(
  topo: PreparedTopology,
  supplies: string[],
  protectedSet: Set<string>,
  baselineReachable: Set<string>,
  closeValveIds: string[],
  outletIds: string[],
): Solution {
  const extraClosed = new Set(closeValveIds);
  const reachableAfter = reachableFromSupplies(topo, supplies, extraClosed);
  const supplySet = new Set(supplies);
  const outletStatuses: OutletStatus[] = outletIds.map((id) => {
    const node = topo.nodes.get(id)!;
    return {
      outletId: id,
      name: node.name,
      protected: protectedSet.has(id),
      connectedBefore: baselineReachable.has(id),
      connectedAfter: reachableAfter.has(id),
      fedByAfter: reachableAfter.has(id)
        ? feedingSupplies(topo, id, supplySet, extraClosed)
        : [],
    };
  });
  return {
    closeValveIds,
    leakReachable: false,
    outletStatuses,
    reachableAfter,
  };
}

/**
 * 无阀连通分量：把所有“不带阀门的管段”收缩成一个分量。
 * 注意：只看管段是否带阀，不看阀门当前开关状态——该结构用于判断
 * “是否存在任何关阀都无法改变的连通关系”。
 */
function valvelessComponents(topo: PreparedTopology): Map<string, number> {
  const comp = new Map<string, number>();
  let next = 0;
  for (const startId of topo.nodes.keys()) {
    if (comp.has(startId)) continue;
    const cid = next++;
    comp.set(startId, cid);
    const queue = [startId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const { to, pipeIndex } of topo.adjacency.get(cur) ?? []) {
        if (comp.has(to)) continue;
        if (topo.pipeValve[pipeIndex] !== null) continue; // 阀门边不收缩
        comp.set(to, cid);
        queue.push(to);
      }
    }
  }
  return comp;
}

export interface SearchOptions {
  supplies: string[];
  leak: string;
  protectedOutlets: string[];
}

/** 主入口：搜索最少关阀隔离方案 */
export function searchIsolation(
  topo: PreparedTopology,
  opts: SearchOptions,
): SearchResult {
  const supplies = [...new Set(opts.supplies)].sort();
  const protectedOutlets = [...new Set(opts.protectedOutlets)].sort();
  const protectedSet = new Set(protectedOutlets);
  const leak = opts.leak;

  const base: SearchResult = {
    ok: false,
    supplies,
    leak,
    protectedOutlets,
    openValves: [],
    closedValves: [],
    leakReachableBefore: false,
    tiedAlternatives: [],
    stats: [],
    diagnostics: [],
    totalCombinations: 0,
  };

  // —— 选择校验 ——
  if (supplies.length === 0) return { ...base, error: '请至少指定一个供水点' };
  if (!leak) return { ...base, error: '请指定漏点' };
  for (const id of [...supplies, leak, ...protectedOutlets]) {
    if (!topo.nodes.has(id)) return { ...base, error: `节点 ${id} 不在拓扑中` };
  }
  if (supplies.includes(leak)) {
    return { ...base, error: `漏点 ${leak} 同时被选为供水点，无法隔离` };
  }
  if (protectedSet.has(leak)) {
    return { ...base, error: `漏点 ${leak} 同时被列为保供出口，要求自相矛盾` };
  }
  for (const s of supplies) {
    if (protectedSet.has(s)) {
      return { ...base, error: `供水点 ${s} 不能同时作为保供出口` };
    }
  }

  // —— 当前开启阀门（唯一允许关闭的候选）——
  const openValves = [...topo.valves.values()]
    .filter((v) => v.state === 'open')
    .map((v) => v.id)
    .sort();
  const closedValves = [...topo.valves.values()]
    .filter((v) => v.state === 'closed')
    .map((v) => v.id)
    .sort();
  base.openValves = openValves;
  base.closedValves = closedValves;

  if (openValves.length > 12) {
    return {
      ...base,
      limitError: `当前共有 ${openValves.length} 个开启的阀门，超过搜索上限 12 个。请在输入 JSON 中用 state:"closed" 标注确定无需操作的阀门，或缩小拓扑范围。`,
    };
  }
  base.totalCombinations = 2 ** openValves.length - 1;

  const outletIds = [...topo.outletIds].sort();

  // —— 初始状态（不新增关阀）——
  const baseline = reachableFromSupplies(topo, supplies, new Set());
  base.leakReachableBefore = baseline.has(leak);

  // —— 结构性诊断（无阀分量收缩）——
  const diagnostics: string[] = [];
  const comp = valvelessComponents(topo);
  const leakComp = comp.get(leak);
  const supplyComps = new Set(supplies.map((s) => comp.get(s)));
  if (supplyComps.has(leakComp)) {
    const hit = supplies.find((s) => comp.get(s) === leakComp);
    diagnostics.push(
      `漏点 ${topo.nodes.get(leak)?.name} 与供水点 ${hit} 之间存在完全不经过阀门的管段路径，关任何阀门都无法隔离，无解。`,
    );
  }
  for (const p of protectedOutlets) {
    if (comp.get(p) === leakComp) {
      diagnostics.push(
        `保供出口 ${topo.nodes.get(p)?.name} 与漏点之间没有任何阀门（同属一段无阀管网），隔离漏点必然断其供水，无解。`,
      );
    }
  }
  // 即使把所有阀门都视为开启仍不通 → 纯结构断连
  const fullOpen = reachableFromSupplies(
    { ...topo, valves: cloneAllOpen(topo) },
    supplies,
    new Set(),
  );
  for (const p of protectedOutlets) {
    if (!fullOpen.has(p)) {
      diagnostics.push(
        `保供出口 ${topo.nodes.get(p)?.name} 与所有供水点之间没有任何管段路径，拓扑上本就不通水，无解。`,
      );
    } else if (!baseline.has(p)) {
      diagnostics.push(
        `保供出口 ${topo.nodes.get(p)?.name} 在当前初始阀门状态下已经断水（被输入中 state:"closed" 的阀门隔断）；关阀无法恢复其供水，请先核对初始阀门状态。`,
      );
    }
  }

  // —— 已天然隔离（一个阀都不用关）——
  if (!baseline.has(leak)) {
    const brokenProtected = protectedOutlets.filter((p) => !baseline.has(p));
    if (brokenProtected.length === 0) {
      const solution = buildSolution(
        topo,
        supplies,
        protectedSet,
        baseline,
        [],
        outletIds,
      );
      solution.leakReachable = false;
      return {
        ...base,
        ok: true,
        solution,
        tiedAlternatives: [],
        stats: [{ k: 0, tested: 1, valid: 1 }],
        diagnostics: [],
      };
    }
    diagnostics.push(
      `漏点当前已与供水点断开，但保供出口 ${brokenProtected
        .map((id) => topo.nodes.get(id)?.name)
        .join('、')} 当前也处于断水状态，且关阀不能恢复供水。`,
    );
    return { ...base, diagnostics, stats: [{ k: 0, tested: 1, valid: 0 }] };
  }

  // —— 枚举：关阀数从少到多 ——
  const stats: SearchResult['stats'] = [];
  for (let k = 0; k <= openValves.length; k++) {
    let tested = 0;
    const valid: number[][] = [];
    for (const indices of indexCombinations(openValves.length, k)) {
      tested++;
      const extraClosed = new Set(indices.map((i) => openValves[i]));
      const reach = reachableFromSupplies(topo, supplies, extraClosed);
      if (reach.has(leak)) continue; // 漏点仍未隔离
      let allProtectedOk = true;
      for (const p of protectedOutlets) {
        if (!reach.has(p)) {
          allProtectedOk = false;
          break;
        }
      }
      if (!allProtectedOk) continue;
      valid.push(indices);
    }
    stats.push({ k, tested, valid: valid.length });
    if (valid.length > 0) {
      // valid 按索引字典序产生 → 第一个即编号列表字典序最小者
      const bestIds = valid[0].map((i) => openValves[i]);
      const solution = buildSolution(
        topo,
        supplies,
        protectedSet,
        baseline,
        bestIds,
        outletIds,
      );
      const tiedAlternatives = valid
        .slice(1)
        .map((idx) => idx.map((i) => openValves[i]))
        .sort((a, b) => compareIdLists(a, b));
      return { ...base, ok: true, solution, tiedAlternatives, stats, diagnostics: [] };
    }
  }

  if (diagnostics.length === 0) {
    diagnostics.push(
      `已枚举全部 ${base.totalCombinations + 1} 种关阀组合（含不关阀），均无法同时满足“漏点与所有供水点断开”且“每个保供出口仍有供水”。漏点可能位于保供出口的唯一供水通道上。`,
    );
  }
  return { ...base, stats, diagnostics };
}

/** 复制一份阀门表并把全部阀门置为开启（仅用于结构性可达诊断，不触碰输入） */
function cloneAllOpen(topo: PreparedTopology): PreparedTopology['valves'] {
  const m = new Map<string, { id: string; state: 'open' | 'closed' }>();
  for (const v of topo.valves.values()) m.set(v.id, { id: v.id, state: 'open' });
  return m;
}
