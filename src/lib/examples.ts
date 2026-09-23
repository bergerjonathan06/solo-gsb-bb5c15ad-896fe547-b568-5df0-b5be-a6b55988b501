import type { TopologyInput } from '../types.js';

/**
 * 示例一：双供水点环网，跨接支管上发生泄漏（有解）
 *
 * 拓扑示意（双水源 + 环网，漏点在 A、B 之间的跨接支管上）：
 *
 *   S1 供水泵一 ─V01─ A ──V02── B ─V05─ S2 供水泵二
 *                     │  ╲     ╱ │
 *                    V03  L(漏点) V04
 *                     │  ╱     ╲ │
 *                    O1          O2
 *                     A ──无阀── B  （下环，经跨接点 X）
 *                          X ─V07─ O3
 *
 * - 隔离漏点 L 的最少方案：同时关闭漏点两侧的 V03、V04（每个各切断一个进水方向）；
 *   由于 A、B 之间还有 V02 与无阀跨接点 X 两条通路，只关一个阀无法隔离，不存在 1 阀方案；
 * - O1/O2/O3 为保供出口，关 V03+V04 后双泵经下环 X 仍为全部保供出口供水；
 * - D1 为非保供排空口（V08 初始常闭），表格中会显示其初始与实施后均断水但不影响方案成立。
 */
export const exampleOne: TopologyInput = {
  supplies: ['S1', 'S2'],
  leak: 'L',
  protectedOutlets: ['O1', 'O2', 'O3'],
  outlets: ['O1', 'O2', 'O3', 'D1'],
  nodes: [
    { id: 'S1', name: '供水泵一', kind: 'supply', x: 60, y: 120 },
    { id: 'S2', name: '供水泵二', kind: 'supply', x: 840, y: 120 },
    { id: 'A', name: '东侧分水点', kind: 'junction', x: 330, y: 120 },
    { id: 'B', name: '西侧分水点', kind: 'junction', x: 570, y: 120 },
    { id: 'L', name: '跨接管漏点', kind: 'leak', x: 450, y: 250 },
    { id: 'X', name: '环网跨接点', kind: 'junction', x: 450, y: 400 },
    { id: 'O1', name: '展厅一出口', kind: 'outlet', x: 180, y: 300 },
    { id: 'O2', name: '展厅二出口', kind: 'outlet', x: 720, y: 300 },
    { id: 'O3', name: '卫生间出口', kind: 'outlet', x: 450, y: 500 },
    { id: 'D1', name: '检修排空口', kind: 'outlet', x: 700, y: 470 },
  ],
  pipes: [
    // 上环：双泵到分水点，A/B 之间上环带阀 V02
    { from: 'S1', to: 'A', valve: 'V01' },
    { from: 'B', to: 'S2', valve: 'V05' },
    { from: 'A', to: 'B', valve: 'V02' },
    // 漏点所在跨接支管：A—V03—L—V04—B
    { from: 'A', to: 'L', valve: 'V03' },
    { from: 'B', to: 'L', valve: 'V04' },
    // 下环：A、B 经无阀管段在 X 连通（保证单泵停用时另一泵仍供全部保供出口）
    { from: 'A', to: 'X' },
    { from: 'B', to: 'X' },
    // 出口
    { from: 'A', to: 'O1' },
    { from: 'B', to: 'O2', valve: 'V06' },
    { from: 'X', to: 'O3', valve: 'V07' },
    // 非保供排空口，初始常闭（演示初始关闭阀门不参与关阀、不可被开启）
    { from: 'X', to: 'D1', valve: { id: 'V08', state: 'closed' } },
  ],
};

/**
 * 示例二：保供出口与漏点共用无阀立管（无解）
 *
 * O2 与漏点 L 在同一段无阀管网上：任何关阀组合要么隔不断漏点，
 * 要么必然停掉 O2，用于演示无解诊断提示。
 */
export const exampleTwo: TopologyInput = {
  supplies: ['S1'],
  leak: 'L',
  protectedOutlets: ['O1', 'O2'],
  outlets: ['O1', 'O2', 'D1'],
  nodes: [
    { id: 'S1', name: '市政供水', kind: 'supply', x: 90, y: 280 },
    { id: 'A', name: '入户总阀后', kind: 'junction', x: 280, y: 280 },
    { id: 'B', name: '二层立管节点', kind: 'junction', x: 500, y: 180 },
    { id: 'L', name: '立管砂眼漏点', kind: 'leak', x: 680, y: 180 },
    { id: 'O1', name: '一层展厅出口', kind: 'outlet', x: 280, y: 460 },
    { id: 'O2', name: '二层展厅出口', kind: 'outlet', x: 820, y: 300 },
    { id: 'D1', name: '排空口', kind: 'outlet', x: 500, y: 40 },
  ],
  pipes: [
    { from: 'S1', to: 'A', valve: 'V01' },
    { from: 'A', to: 'B', valve: 'V02' },
    { from: 'B', to: 'L' },
    { from: 'L', to: 'O2' },
    { from: 'A', to: 'O1', valve: 'V03' },
    { from: 'B', to: 'D1', valve: { id: 'V04', state: 'closed' } },
  ],
};
