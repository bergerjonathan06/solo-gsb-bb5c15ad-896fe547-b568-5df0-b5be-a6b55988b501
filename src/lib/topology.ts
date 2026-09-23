import type {
  InputNode,
  InputPipe,
  Issue,
  Node,
  NodeKind,
  Pipe,
  PreparedTopology,
  TopologyInput,
  Valve,
} from '../types.js';

/** 读取任意输入（可能不是合法 JSON / 结构不正确），返回错误信息 */
export function parseTopologyJson(text: string): { input?: TopologyInput; error?: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { error: `JSON 解析失败：${(e as Error).message}` };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { error: '顶层必须是一个对象，形如 { "nodes": [...], "pipes": [...] }' };
  }
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.nodes)) return { error: '缺少 nodes 数组' };
  if (!Array.isArray(obj.pipes)) return { error: '缺少 pipes 数组' };
  return { input: data as TopologyInput };
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return null;
}

/**
 * 解析并规范化拓扑，同时做结构校验。
 * 不修改输入对象——所有阀门状态都复制到独立 Map 中。
 */
export function prepareTopology(input: TopologyInput): PreparedTopology {
  const issues: Issue[] = [];
  const nodes = new Map<string, Node>();
  const valves = new Map<string, Valve>();
  const pipes: Pipe[] = [];

  // —— 节点 ——
  for (const [i, raw] of input.nodes.entries()) {
    if (typeof raw !== 'object' || raw === null) {
      issues.push({ level: 'error', message: `nodes[${i}] 不是对象` });
      continue;
    }
    const rn = raw as InputNode;
    const id = asString(rn.id);
    if (id === null || id === '') {
      issues.push({ level: 'error', message: `nodes[${i}] 缺少有效的 id` });
      continue;
    }
    if (nodes.has(id)) {
      issues.push({ level: 'error', message: `节点编号重复：${id}` });
      continue;
    }
    let kind: NodeKind = 'junction';
    if (rn.kind === 'supply' || rn.kind === 'outlet' || rn.kind === 'junction' || rn.kind === 'leak') {
      kind = rn.kind;
    } else if (rn.kind !== undefined) {
      issues.push({ level: 'warning', message: `节点 ${id} 的 kind="${String(rn.kind)}" 无法识别，按普通节点处理` });
    }
    nodes.set(id, {
      id,
      name: typeof rn.name === 'string' && rn.name !== '' ? rn.name : id,
      kind,
      x: typeof rn.x === 'number' ? rn.x : undefined,
      y: typeof rn.y === 'number' ? rn.y : undefined,
    });
  }

  // —— 管段 / 阀门 ——
  for (const [i, raw] of input.pipes.entries()) {
    if (typeof raw !== 'object' || raw === null) {
      issues.push({ level: 'error', message: `pipes[${i}] 不是对象` });
      continue;
    }
    const rp = raw as InputPipe;
    const from = asString(rp.from);
    const to = asString(rp.to);
    if (from === null || to === null) {
      issues.push({ level: 'error', message: `pipes[${i}] 缺少 from/to 端点` });
      continue;
    }
    if (!nodes.has(from)) {
      issues.push({ level: 'error', message: `pipes[${i}] 引用了不存在的节点：${from}` });
    }
    if (!nodes.has(to)) {
      issues.push({ level: 'error', message: `pipes[${i}] 引用了不存在的节点：${to}` });
    }
    if (from === to) {
      issues.push({ level: 'warning', message: `pipes[${i}] 是自环管段（${from}），已忽略其连通意义` });
    }

    let valveId: string | null = null;
    if (rp.valve !== undefined && rp.valve !== null) {
      let vId: string | null = null;
      let vState: Valve['state'] = 'open';
      if (typeof rp.valve === 'string' || typeof rp.valve === 'number') {
        vId = String(rp.valve);
      } else if (typeof rp.valve === 'object') {
        vId = asString((rp.valve as { id?: unknown }).id);
        const st = (rp.valve as { state?: unknown }).state;
        if (st === 'open' || st === 'closed') vState = st;
        else if (st !== undefined) {
          issues.push({ level: 'warning', message: `阀门状态 "${String(st)}" 无法识别，默认按开启处理` });
        }
      }
      if (vId === null || vId === '') {
        issues.push({ level: 'error', message: `pipes[${i}] 的阀门缺少编号` });
      } else if (valves.has(vId)) {
        issues.push({ level: 'error', message: `阀门编号重复：${vId}（必须全局唯一）` });
      } else {
        valves.set(vId, { id: vId, state: vState });
        valveId = vId;
      }
    }
    pipes.push({ index: pipes.length, from, to, valveId });
  }

  // —— 角色声明（顶层字段）——
  const readIds = (v: unknown): string[] => {
    if (v === undefined || v === null) return [];
    const arr = Array.isArray(v) ? v : [v];
    const out: string[] = [];
    for (const x of arr) {
      const s = asString(x);
      if (s !== null) out.push(s);
    }
    return out;
  };
  const declaredSupplies = readIds(input.supplies);
  const leakRaw = asString(input.leak ?? null);
  const declaredLeak = leakRaw;
  const declaredProtected = readIds(input.protectedOutlets);
  const explicitOutlets = new Set(readIds(input.outlets));

  // —— 角色推断与交叉校验 ——
  for (const id of declaredSupplies) {
    const n = nodes.get(id);
    if (!n) {
      issues.push({ level: 'error', message: `供水点 ${id} 不在节点列表中` });
    } else if (n.kind === 'junction') {
      n.kind = 'supply';
    } else if (n.kind !== 'supply') {
      issues.push({ level: 'warning', message: `节点 ${id} 被指定为供水点，但其 kind 为 ${n.kind}` });
    }
  }
  if (declaredLeak) {
    const n = nodes.get(declaredLeak);
    if (!n) {
      issues.push({ level: 'error', message: `漏点 ${declaredLeak} 不在节点列表中` });
    } else if (n.kind === 'junction') {
      n.kind = 'leak';
    } else if (n.kind !== 'leak') {
      issues.push({ level: 'warning', message: `节点 ${declaredLeak} 被指定为漏点，但其 kind 为 ${n.kind}` });
    }
  }
  for (const id of explicitOutlets) {
    const n = nodes.get(id);
    if (!n) {
      issues.push({ level: 'warning', message: `outlets 中声明的节点 ${id} 不在节点列表中` });
    } else if (n.kind === 'junction') {
      n.kind = 'outlet';
    }
  }
  for (const id of declaredProtected) {
    const n = nodes.get(id);
    if (!n) {
      issues.push({ level: 'error', message: `保供出口 ${id} 不在节点列表中` });
    } else if (n.kind === 'junction') {
      n.kind = 'outlet';
    }
  }

  // 出口集合：显式 outlets ∪ kind=outlet ∪ 保供列表
  const outletIds = new Set<string>();
  for (const id of explicitOutlets) outletIds.add(id);
  for (const [id, n] of nodes) if (n.kind === 'outlet') outletIds.add(id);
  for (const id of declaredProtected) outletIds.add(id);

  // —— 建图（无向）——
  const adjacency = new Map<string, Array<{ to: string; pipeIndex: number }>>();
  for (const id of nodes.keys()) adjacency.set(id, []);
  const pipeValve: Array<string | null> = [];
  for (const p of pipes) {
    pipeValve.push(p.valveId);
    const a = adjacency.get(p.from);
    const b = adjacency.get(p.to);
    if (a) a.push({ to: p.to, pipeIndex: p.index });
    if (b) b.push({ to: p.from, pipeIndex: p.index });
  }

  return {
    nodes,
    adjacency,
    pipes,
    valves,
    pipeValve,
    outletIds,
    declaredSupplies,
    declaredLeak,
    declaredProtected,
    raw: input,
    issues,
  };
}
