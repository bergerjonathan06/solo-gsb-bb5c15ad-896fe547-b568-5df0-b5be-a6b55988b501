/** 应用核心类型定义 */

/** 阀门当前状态：open=开启（水可通过），closed=关闭（水不可通过） */
export type ValveState = 'open' | 'closed';

/** 节点在拓扑中的角色 */
export type NodeKind = 'supply' | 'outlet' | 'junction' | 'leak';

/** —— 用户输入 JSON 中的节点 —— */
export interface InputNode {
  id: string;
  name?: string;
  /** 可显式声明角色；未声明时按拓扑引用自动推断 */
  kind?: NodeKind;
  /** 可选：拓扑图绘制坐标（像素，viewBox 900x560） */
  x?: number;
  y?: number;
}

/**
 * 阀门管段写法：
 *   "V1"                      —— 阀门编号 V1，默认开启
 *   { id: "V1", state: "closed" } —— 指定初始状态
 */
export type ValveSpec = string | { id: string; state?: ValveState };

/** —— 用户输入 JSON 中的管段 —— */
export interface InputPipe {
  from: string;
  to: string;
  /** 无阀管段省略 valve 字段 */
  valve?: ValveSpec;
}

/** —— 用户粘贴的完整拓扑 JSON —— */
export interface TopologyInput {
  nodes: InputNode[];
  pipes: InputPipe[];
  /** 可在 JSON 中预指定，也可在页面上勾选 */
  supplies?: string[];
  leak?: string;
  protectedOutlets?: string[];
  /** 可选：显式声明哪些节点是出口 */
  outlets?: string[];
}

/** 规范化后的阀门 */
export interface Valve {
  id: string;
  state: ValveState;
}

/** 规范化后的节点 */
export interface Node {
  id: string;
  name: string;
  kind: NodeKind;
  x?: number;
  y?: number;
}

/** 规范化后的管段（无阀管段 valveId 为 null） */
export interface Pipe {
  index: number;
  from: string;
  to: string;
  valveId: string | null;
}

/** 校验问题 */
export interface Issue {
  level: 'error' | 'warning';
  message: string;
}

/** 解析并规范化后的拓扑（所有后续计算均使用该结构，不改动输入对象） */
export interface PreparedTopology {
  nodes: Map<string, Node>;
  /** 邻接表：nodeId -> [{ to, pipeIndex }] */
  adjacency: Map<string, Array<{ to: string; pipeIndex: number }>>;
  pipes: Pipe[];
  /** 阀门编号 -> 阀门（编号全局唯一） */
  valves: Map<string, Valve>;
  /** 管段下标 -> 该管段上的阀门编号（无阀为 null），便于 BFS */
  pipeValve: Array<string | null>;
  /** 声明/推断出的出口 */
  outletIds: Set<string>;
  declaredSupplies: string[];
  declaredLeak: string | null;
  declaredProtected: string[];
  /** 原始输入（仅保留引用，全程只读） */
  raw: TopologyInput;
  issues: Issue[];
}

/** 出口连通状态 */
export interface OutletStatus {
  outletId: string;
  name: string;
  protected: boolean;
  /** 初始（不新增关阀）是否可连通任一供水点 */
  connectedBefore: boolean;
  /** 方案实施后是否可连通任一供水点 */
  connectedAfter: boolean;
  /** 实施后实际为该出口供水的供水点编号（可能多个） */
  fedByAfter: string[];
}

/** 一个可行的关阀组合方案 */
export interface Solution {
  /** 关闭的阀门编号，已按编号排序 */
  closeValveIds: string[];
  /** 方案实施后漏点是否仍能连到供水点（可行方案必为 false） */
  leakReachable: boolean;
  outletStatuses: OutletStatus[];
  /** 实施后可达的全部节点（用于拓扑图着色） */
  reachableAfter: Set<string>;
}

/** 搜索结果 */
export interface SearchResult {
  ok: boolean;
  /** 输入/选择层面的硬错误 */
  error?: string;
  /** 阀门数超过 12 等前置限制提示 */
  limitError?: string;
  supplies: string[];
  leak: string;
  protectedOutlets: string[];
  /** 当前开启的阀门编号（候选关阀集合） */
  openValves: string[];
  /** 当前已关闭的阀门编号（仅展示，不参与关阀） */
  closedValves: string[];
  /** 初始状态下（不新增关阀）漏点是否连到供水点 */
  leakReachableBefore: boolean;
  solution?: Solution;
  /** 并列的其余最优方案（关阀数同为最小，编号列表字典序靠后） */
  tiedAlternatives: string[][];
  /** 不同关阀数的枚举统计，如 [{k:1,valid:0},{k:2,valid:3}] */
  stats: Array<{ k: number; tested: number; valid: number }>;
  /** 无解时的诊断提示 */
  diagnostics: string[];
  /** 枚举的组合总数上限（2^n，n 为开启阀门数，最多 4096） */
  totalCombinations: number;
}
