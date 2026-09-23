import './style.css';
import { parseTopologyJson, prepareTopology } from './lib/topology.js';
import { searchIsolation } from './lib/solver.js';
import { renderDiagram } from './lib/diagram.js';
import { exampleOne, exampleTwo } from './lib/examples.js';
import type { PreparedTopology, SearchResult } from './types.js';

const $ = <T extends HTMLElement | SVGElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as unknown as T;

const jsonInput = $<HTMLTextAreaElement>('jsonInput');
const parseStatus = $('parseStatus');
const issuesBox = $('issues');
const rolesCard = $('rolesCard');
const resultCard = $('resultCard');
const resultBody = $('resultBody');
const supplyList = $('supplyList');
const leakList = $('leakList');
const protectedList = $('protectedList');
const searchBtn = $<HTMLButtonElement>('searchBtn');
const diagramSvg = $<SVGSVGElement>('diagram');
const diagramEmpty = $('diagramEmpty');

let topo: PreparedTopology | null = null;
let lastResult: SearchResult | null = null;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setStatus(text: string, kind: '' | 'ok' | 'err'): void {
  parseStatus.textContent = text;
  parseStatus.className = kind ? `status-line ${kind}` : 'status-line';
}

function nodeLabel(id: string): string {
  const n = topo?.nodes.get(id);
  return n ? `${n.name}（${id}）` : id;
}

// —— 载入示例 ——
$('loadExample1').addEventListener('click', () => {
  jsonInput.value = JSON.stringify(exampleOne, null, 2);
  doParse();
});
$('loadExample2').addEventListener('click', () => {
  jsonInput.value = JSON.stringify(exampleTwo, null, 2);
  doParse();
});
$('parseBtn').addEventListener('click', doParse);
searchBtn.addEventListener('click', doSearch);

// —— 解析 ——
function doParse(): void {
  lastResult = null;
  resultCard.hidden = true;
  issuesBox.replaceChildren();
  setStatus('正在解析…', '');

  const { input, error } = parseTopologyJson(jsonInput.value);
  if (error || !input) {
    setStatus(error ?? '解析失败', 'err');
    rolesCard.hidden = true;
    diagramEmpty.hidden = false;
    diagramSvg.replaceChildren();
    return;
  }

  topo = prepareTopology(input);
  const errors = topo.issues.filter((i) => i.level === 'error');
  for (const iss of topo.issues) {
    const div = document.createElement('div');
    div.className = `issue ${iss.level}`;
    div.textContent = `${iss.level === 'error' ? '错误' : '警告'}：${iss.message}`;
    issuesBox.appendChild(div);
  }

  if (errors.length > 0) {
    setStatus(`解析完成，但存在 ${errors.length} 个错误，请修正后重试`, 'err');
    rolesCard.hidden = true;
    return;
  }

  const nValves = topo.valves.size;
  const nOpen = [...topo.valves.values()].filter((v) => v.state === 'open').length;
  setStatus(
    `解析成功：${topo.nodes.size} 个节点、${topo.pipes.length} 根管段、${nValves} 个阀门（开启 ${nOpen} 个）`,
    'ok',
  );

  renderRoleLists();
  rolesCard.hidden = false;
  diagramEmpty.hidden = true;
  refreshDiagram();
}

// —— 角色选择列表 ——
function kindTag(id: string): string {
  const n = topo?.nodes.get(id);
  if (!n) return '';
  if (n.kind === 'supply') return '<span class="tag tag-supply">供水</span>';
  if (n.kind === 'outlet') return '<span class="tag tag-outlet">出口</span>';
  if (n.kind === 'leak') return '<span class="tag tag-leak">漏点</span>';
  return '';
}

function renderRoleLists(): void {
  if (!topo) return;
  supplyList.replaceChildren();
  leakList.replaceChildren();
  protectedList.replaceChildren();

  const preSupplies = new Set(
    topo.declaredSupplies.length
      ? topo.declaredSupplies
      : [...topo.nodes.values()].filter((n) => n.kind === 'supply').map((n) => n.id),
  );
  const preLeak = topo.declaredLeak ?? [...topo.nodes.values()].find((n) => n.kind === 'leak')?.id ?? null;
  const preProtected = new Set(
    topo.declaredProtected.length
      ? topo.declaredProtected
      : [],
  );

  for (const [id, node] of topo.nodes) {
    const label = `${esc(node.name)} <span class="node-id">${esc(id)}</span>`;

    const sLabel = document.createElement('label');
    sLabel.className = 'check-item';
    sLabel.innerHTML = `<input type="checkbox" data-id="${esc(id)}" ${preSupplies.has(id) ? 'checked' : ''}> ${label}${kindTag(id)}`;
    supplyList.appendChild(sLabel);

    const lLabel = document.createElement('label');
    lLabel.className = 'check-item';
    lLabel.innerHTML = `<input type="radio" name="leakRadio" data-id="${esc(id)}" ${preLeak === id ? 'checked' : ''}> ${label}${kindTag(id)}`;
    leakList.appendChild(lLabel);

    const pLabel = document.createElement('label');
    pLabel.className = 'check-item';
    pLabel.innerHTML = `<input type="checkbox" data-id="${esc(id)}" ${preProtected.has(id) ? 'checked' : ''}> ${label}${kindTag(id)}`;
    protectedList.appendChild(pLabel);
  }

  const onChange = (): void => {
    syncConflicts();
    refreshDiagram();
  };
  supplyList.querySelectorAll('input').forEach((i) => i.addEventListener('change', onChange));
  leakList.querySelectorAll('input').forEach((i) => i.addEventListener('change', onChange));
  protectedList.querySelectorAll('input').forEach((i) => i.addEventListener('change', onChange));

  syncConflicts();
}

function getSelection(): { supplies: Set<string>; leak: string | null; protectedOutlets: Set<string> } {
  const supplies = new Set(
    [...supplyList.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.dataset.id!),
  );
  const leakEl = leakList.querySelector<HTMLInputElement>('input:checked');
  const protectedOutlets = new Set(
    [...protectedList.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => i.dataset.id!),
  );
  return { supplies, leak: leakEl?.dataset.id ?? null, protectedOutlets };
}

/** 三个角色互斥：已选为某角色的节点在其他列表中禁用 */
function syncConflicts(): void {
  if (!topo) return;
  const { supplies, leak, protectedOutlets } = getSelection();

  const toggle = (box: HTMLElement, id: string, disabled: boolean): void => {
    const input = [...box.querySelectorAll<HTMLInputElement>('input')].find(
      (i) => i.dataset.id === id,
    );
    if (!input) return;
    input.disabled = disabled && !input.checked;
    input.closest('.check-item')?.classList.toggle('disabled', disabled && !input.checked);
  };

  for (const id of topo.nodes.keys()) {
    toggle(supplyList, id, (leak !== null && leak === id) || protectedOutlets.has(id));
    toggle(leakList, id, supplies.has(id) || protectedOutlets.has(id));
    toggle(protectedList, id, supplies.has(id) || (leak !== null && leak === id));
  }

  const { supplies: s, leak: l } = getSelection();
  searchBtn.disabled = !(s.size >= 1 && l !== null);
}

function refreshDiagram(): void {
  if (!topo) return;
  const { supplies, leak } = getSelection();
  const reach =
    lastResult?.ok && lastResult.solution ? lastResult.solution.reachableAfter : null;
  const proposed = new Set(lastResult?.solution?.closeValveIds ?? []);
  renderDiagram(diagramSvg, topo, {
    supplies: [...supplies],
    leak,
    reachableAfter: reach,
    proposedClosed: proposed,
  });
}

// —— 搜索 ——
function doSearch(): void {
  if (!topo) return;
  const { supplies, leak, protectedOutlets } = getSelection();
  if (supplies.size === 0 || !leak) return;

  const result = searchIsolation(topo, {
    supplies: [...supplies],
    leak,
    protectedOutlets: [...protectedOutlets],
  });
  lastResult = result;
  resultCard.hidden = false;
  renderResult(result);
  refreshDiagram();
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function valveChips(ids: string[], muted = false): string {
  if (ids.length === 0) return '<span class="hint">（无）</span>';
  return ids.map((id) => `<span class="valve-chip ${muted ? 'muted' : ''}">${esc(id)}</span>`).join('');
}

function renderResult(r: SearchResult): void {
  if (r.error) {
    resultBody.innerHTML = `<div class="result-banner fail">无法搜索：${esc(r.error)}</div>`;
    return;
  }
  if (r.limitError) {
    resultBody.innerHTML = `<div class="result-banner fail">${esc(r.limitError)}</div>`;
    return;
  }

  const summary = `
    <div class="section-label">阀门现状（输入原值，未被修改）</div>
    <div style="font-size:13px;margin-bottom:4px">当前开启 · 候选关阀（${r.openValves.length} 个，${r.openValves.length > 12 ? '超上限' : '≤12'}）：</div>
    <div>${valveChips(r.openValves, true)}</div>
    <div style="font-size:13px;margin:8px 0 4px">输入中已关闭（${r.closedValves.length} 个，搜索视为常闭、不可开启）：</div>
    <div>${valveChips(r.closedValves)}</div>
  `;

  if (!r.ok) {
    const diag =
      r.diagnostics.length > 0
        ? `<ul class="diag-list">${r.diagnostics.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`
        : '';
    resultBody.innerHTML = `
      <div class="result-banner fail">
        无可行关阀组合：已按关阀数从少到多枚举 ${r.totalCombinations + 1} 种组合（含不关阀），
        没有任何组合能同时让漏点 ${esc(nodeLabel(r.leak))} 与所有供水点断开、并保持每个保供出口通水。
      </div>
      ${diag}
      ${summary}
      ${statsTable(r)}
    `;
    return;
  }

  const sol = r.solution!;
  const banner =
    sol.closeValveIds.length === 0
      ? `<div class="result-banner info">当前阀门状态下，漏点已经与所有供水点断开，且保供出口全部通水——<strong>无需关闭任何阀门</strong>。</div>`
      : `<div class="result-banner success">
           推荐方案：关闭以下 <strong>${sol.closeValveIds.length}</strong> 个阀门
           （关阀数最少；同数方案按阀门编号排序后的字典序取最先）：
           <div style="margin-top:8px">${valveChips(sol.closeValveIds)}</div>
         </div>`;

  const alt =
    r.tiedAlternatives.length > 0
      ? `<details class="alt">
           <summary>另有 ${r.tiedAlternatives.length} 个同为最少关阀数（${sol.closeValveIds.length}）的并列方案（点击展开）</summary>
           ${r.tiedAlternatives
             .map(
               (ids, i) =>
                 `<div class="alt-combo">并列 ${i + 1}：${ids
                   .map((id) => `<span class="valve-chip">${esc(id)}</span>`)
                   .join('')}</div>`,
             )
             .join('')}
         </details>`
      : '';

  resultBody.innerHTML = `
    ${banner}
    <div class="section-label">各出口连通状态</div>
    ${outletTable(sol)}
    ${alt}
    ${summary}
    ${statsTable(r)}
    <p class="hint">说明：方案仅给出“建议关闭”的阀门清单，输入 JSON 中的阀门 state 不会被改动；拓扑图中红色虚线为推荐关闭位置，蓝色管段为方案实施后仍通水部分。</p>
  `;
}

function outletTable(sol: NonNullable<SearchResult['solution']>): string {
  if (sol.outletStatuses.length === 0) {
    return '<p class="hint">拓扑中没有出口节点（可在节点 kind 中标记 "outlet"，或在顶层 outlets / protectedOutlets 中声明）。</p>';
  }
  const rows = sol.outletStatuses
    .map((o) => {
      const before = o.connectedBefore
        ? '<span class="pill ok">通水</span>'
        : '<span class="pill bad">断水</span>';
      const after = o.connectedAfter
        ? '<span class="pill ok">通水 ✓</span>'
        : o.protected
          ? '<span class="pill bad">断水 ✗</span>'
          : '<span class="pill skip">断水（非保供）</span>';
      const fed = o.fedByAfter.length
        ? o.fedByAfter.map((id) => esc(topo?.nodes.get(id)?.name ?? id)).join('、')
        : '—';
      return `<tr${o.protected ? ' style="background:#f0fdfa"' : ''}>
        <td>${esc(o.name)} <span class="node-id">${esc(o.outletId)}</span>${o.protected ? '<span class="tag tag-outlet">保供</span>' : ''}</td>
        <td class="num">${before}</td>
        <td class="num">${after}</td>
        <td>${fed}</td>
      </tr>`;
    })
    .join('');
  return `
    <table class="conn">
      <thead>
        <tr><th>出口</th><th class="num">初始状态</th><th class="num">方案实施后</th><th>实施后由谁供水</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function statsTable(r: SearchResult): string {
  const rows = r.stats
    .map((s) => {
      const hit = r.ok && r.solution && s.k === r.solution.closeValveIds.length;
      return `<tr${hit ? ' style="background:#f0fdf4;font-weight:600"' : ''}>
        <td>${s.k}</td><td>${s.tested}</td><td>${s.valid}</td>
      </tr>`;
    })
    .join('');
  return `
    <div class="section-label">枚举统计</div>
    <table class="stats-table">
      <thead><tr><th>关阀数</th><th>测试组合数</th><th>可行组合数</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// —— 初始：自动载入示例一，便于直接体验 ——
jsonInput.value = JSON.stringify(exampleOne, null, 2);
doParse();
