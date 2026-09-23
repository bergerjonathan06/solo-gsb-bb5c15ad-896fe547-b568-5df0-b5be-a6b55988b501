import assert from 'node:assert';
import { prepareTopology, parseTopologyJson } from '../src/lib/topology.ts';
import { searchIsolation } from '../src/lib/solver.ts';
import { exampleOne, exampleTwo } from '../src/lib/examples.ts';

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function run(json: unknown, supplies: string[], leak: string, prot: string[]) {
  const text = JSON.stringify(json);
  const parsed = parseTopologyJson(text);
  assert.ok(parsed.input, parsed.error);
  const topo = prepareTopology(parsed.input);
  assert.deepStrictEqual(topo.issues.filter((i) => i.level === 'error'), []);
  return searchIsolation(topo, { supplies, leak, protectedOutlets: prot });
}

// 1. 基本：关 V2 隔离漏点且保供出口仍通水；关 V1 会断供 → 唯一最优 [V2]
check('基础单阀隔离', () => {
  const r = run(
    {
      nodes: [
        { id: 'S1', kind: 'supply' },
        { id: 'A' },
        { id: 'L', kind: 'leak' },
        { id: 'O1', kind: 'outlet' },
      ],
      pipes: [
        { from: 'S1', to: 'A', valve: 'V1' },
        { from: 'A', to: 'L', valve: 'V2' },
        { from: 'A', to: 'O1' },
      ],
    },
    ['S1'],
    'L',
    ['O1'],
  );
  assert.ok(r.ok, r.diagnostics.join(';'));
  assert.deepStrictEqual(r.solution!.closeValveIds, ['V2']);
  const o1 = r.solution!.outletStatuses.find((s) => s.outletId === 'O1')!;
  assert.ok(o1.connectedAfter && o1.fedByAfter.includes('S1'));
});

// 2. 双供水点：必须与两个水源都断开
check('双供水点需双侧隔离', () => {
  const r = run(
    {
      nodes: [
        { id: 'S1', kind: 'supply' },
        { id: 'S2', kind: 'supply' },
        { id: 'A' },
        { id: 'B' },
        { id: 'L', kind: 'leak' },
        { id: 'O1', kind: 'outlet' },
      ],
      pipes: [
        { from: 'S1', to: 'A', valve: 'V1' },
        { from: 'S2', to: 'B', valve: 'V2' },
        { from: 'A', to: 'L', valve: 'V3' },
        { from: 'B', to: 'L', valve: 'V4' },
        { from: 'A', to: 'B' },
        { from: 'B', to: 'O1' },
      ],
    },
    ['S1', 'S2'],
    'L',
    ['O1'],
  );
  assert.ok(r.ok, r.diagnostics.join(';'));
  assert.deepStrictEqual(r.solution!.closeValveIds, ['V3', 'V4']);
});

// 3. 字典序：V10、V2 串在漏点的唯一供路上，关任一个即可隔离 → 1 阀方案中 V10 字典序在前
check('同关阀数按编号字典序', () => {
  const r = run(
    {
      nodes: [
        { id: 'S1', kind: 'supply' },
        { id: 'A' },
        { id: 'L', kind: 'leak' },
        { id: 'O1', kind: 'outlet' },
      ],
      pipes: [
        { from: 'S1', to: 'A', valve: 'V10' },
        { from: 'A', to: 'L', valve: 'V2' },
        { from: 'S1', to: 'O1' },
      ],
    },
    ['S1'],
    'L',
    ['O1'],
  );
  assert.ok(r.ok, r.diagnostics.join(';'));
  assert.deepStrictEqual(r.solution!.closeValveIds, ['V10']);
  assert.deepStrictEqual(r.tiedAlternatives, [['V2']]);
});

// 4. 漏点与供水点无阀直连 → 无解 + 结构诊断
check('无阀直连供水点无解', () => {
  const r = run(
    {
      nodes: [
        { id: 'S1', kind: 'supply' },
        { id: 'A' },
        { id: 'L', kind: 'leak' },
        { id: 'O1', kind: 'outlet' },
      ],
      pipes: [
        { from: 'S1', to: 'A' },
        { from: 'A', to: 'L' },
        { from: 'S1', to: 'O1', valve: 'V1' },
      ],
    },
    ['S1'],
    'L',
    ['O1'],
  );
  assert.ok(!r.ok);
  assert.ok(r.diagnostics.some((d) => d.includes('完全不经过阀门')));
});

// 5. 保供出口与漏点同一无阀分量 → 无解
check('保供出口与漏点共无阀管段无解', () => {
  const r = run(
    {
      nodes: [
        { id: 'S1', kind: 'supply' },
        { id: 'A' },
        { id: 'L', kind: 'leak' },
        { id: 'O1', kind: 'outlet' },
      ],
      pipes: [
        { from: 'S1', to: 'A', valve: 'V1' },
        { from: 'A', to: 'L', valve: 'V2' },
        { from: 'L', to: 'O1' },
      ],
    },
    ['S1'],
    'L',
    ['O1'],
  );
  assert.ok(!r.ok);
  assert.ok(r.diagnostics.some((d) => d.includes('同属一段无阀管网')));
});

// 6. 初始关闭阀门已隔离漏点 → 0 关阀方案，且不改变输入状态
check('初始已隔离 → 零关阀', () => {
  const input = {
    nodes: [
      { id: 'S1', kind: 'supply' },
      { id: 'A' },
      { id: 'L', kind: 'leak' },
      { id: 'O1', kind: 'outlet' },
    ],
    pipes: [
      { from: 'S1', to: 'A', valve: 'V1' },
      { from: 'A', to: 'L', valve: { id: 'V2', state: 'closed' } },
      { from: 'A', to: 'O1' },
    ],
  };
  const r = run(input, ['S1'], 'L', ['O1']);
  assert.ok(r.ok);
  assert.deepStrictEqual(r.solution!.closeValveIds, []);
  assert.deepStrictEqual(r.closedValves, ['V2']);
  // 输入不被修改
  assert.strictEqual((input.pipes[1].valve as { state: string }).state, 'closed');
});

// 7. 超 12 个开启阀门 → limitError
check('超过12个开启阀门拒绝搜索', () => {
  const nodes = [{ id: 'S', kind: 'supply' }, { id: 'L', kind: 'leak' }];
  const pipes = [];
  for (let i = 1; i <= 13; i++) pipes.push({ from: 'S', to: 'L', valve: `V${i}` });
  const r = run({ nodes, pipes }, ['S'], 'L', []);
  assert.ok(!r.ok && r.limitError?.includes('12'));
});

// 8. 恰好 12 个：可搜索
check('恰好12个开启阀门可枚举', () => {
  const nodes = [{ id: 'S', kind: 'supply' }, { id: 'L', kind: 'leak' }];
  const pipes = [];
  for (let i = 1; i <= 11; i++) pipes.push({ from: 'S', to: 'L', valve: `V${i}` });
  // 一条并联路径，只用一个阀即可（其余并联边也都带阀…构造不同）
  pipes.push({ from: 'S', to: 'L', valve: 'V12' });
  const r = run({ nodes, pipes }, ['S'], 'L', []);
  // 每条边都 S-L：关任意一个阀都无法隔离（还有其余边），需全关 → 12 阀可行
  assert.ok(r.ok, r.limitError ?? r.diagnostics.join(';'));
  assert.strictEqual(r.solution!.closeValveIds.length, 12);
  assert.strictEqual(r.totalCombinations, 4095);
});

// 9. 示例一：有解，保供出口全部通水，非保供出口可断
check('示例一有解', () => {
  const topo = prepareTopology(exampleOne);
  assert.deepStrictEqual(topo.issues.filter((i) => i.level === 'error'), []);
  const r = searchIsolation(topo, {
    supplies: exampleOne.supplies!,
    leak: exampleOne.leak!,
    protectedOutlets: exampleOne.protectedOutlets!,
  });
  assert.ok(r.ok, r.diagnostics.join(';'));
  console.log('    推荐关阀:', r.solution!.closeValveIds.join(', '), '| 并列数:', r.tiedAlternatives.length);
  for (const o of r.solution!.outletStatuses) {
    if (o.protected) assert.ok(o.connectedAfter, `${o.outletId} 应保供`);
  }
  assert.ok(!r.solution!.reachableAfter.has('L'));
});

// 10. 示例二：无解诊断
check('示例二无解', () => {
  const topo = prepareTopology(exampleTwo);
  const r = searchIsolation(topo, {
    supplies: exampleTwo.supplies!,
    leak: exampleTwo.leak!,
    protectedOutlets: exampleTwo.protectedOutlets!,
  });
  assert.ok(!r.ok);
  assert.ok(r.diagnostics.length > 0);
  console.log('    诊断:', r.diagnostics[0]);
});

// 11. 保供出口初始就被常闭阀隔断 → 无解提示
check('保供出口初始断水诊断', () => {
  const r = run(
    {
      nodes: [
        { id: 'S', kind: 'supply' },
        { id: 'A' },
        { id: 'L', kind: 'leak' },
        { id: 'O1', kind: 'outlet' },
      ],
      pipes: [
        { from: 'S', to: 'A', valve: 'V1' },
        { from: 'A', to: 'L', valve: 'V2' },
        { from: 'A', to: 'O1', valve: { id: 'V3', state: 'closed' } },
      ],
    },
    ['S'],
    'L',
    ['O1'],
  );
  assert.ok(!r.ok);
  assert.ok(r.diagnostics.some((d) => d.includes('已经断水')));
});

console.log(`\n全部 ${passed} 项测试通过`);
