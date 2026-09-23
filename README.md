# 展馆水路检修隔离方案（Pavilion Pipeline Isolation）

一个纯浏览器端运行的展馆水路检修关阀方案搜索网页。粘贴描述 **节点 / 无阀管段 / 带唯一编号阀门管段** 的
JSON，指定 **供水点、漏点、必须不断水的保供出口**，程序枚举关阀组合并给出：

- 漏点与 **所有** 供水点断开；
- 每个保供出口仍能连到 **至少一个** 供水点；
- 关阀数最少；关阀数相同时，按阀门编号排序后的列表字典序取最先；
- 列出全部出口在方案实施前后的连通状态、并列方案与枚举统计；
- 无解时给出明确的无解提示与结构性诊断；
- **不会修改输入 JSON 中的阀门状态**，推荐关阀仅为建议清单。

技术栈：Node.js + Vite + TypeScript，零前端框架、零外部服务与账号依赖。

---

## 一条命令启动（Docker Compose）

前置条件：已安装 Docker（含 Compose 插件）。

```bash
docker compose up --build -d
```

然后浏览器访问：

```
http://localhost:8080
```

停止：

```bash
docker compose down
```

> 依赖安装（`npm ci`）与 TypeScript 类型检查、Vite 构建全部包含在镜像构建过程中，
> 运行镜像只携带 `dist/` 静态产物和一个零依赖的 Node 静态服务器，不需要外部账号、不访问任何第三方服务。

### 端口与配置

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| 宿主机访问端口 | `8080` | 改 `docker-compose.yml` 中 `ports` 的左侧，如 `"9000:8080"` |
| 容器内监听端口 | `8080` | 环境变量 `PORT`，改后需与 `ports` 右侧一致 |
| 监听地址 | `0.0.0.0` | 环境变量 `HOST` |
| `restart` | `unless-stopped` | 在 `docker-compose.yml` 中调整 |

也可以直接用 Docker 而不用 Compose：

```bash
docker build -t pavilion-pipeline-isolation .
docker run -d --name pipeline -p 8080:8080 pavilion-pipeline-isolation
```

---

## 本地开发（不用 Docker）

要求 Node.js 20+。

```bash
npm install
npm run dev        # 开发服务器，访问 http://localhost:5173
npm run build      # 类型检查 + 产出 dist/
npm run preview    # 本地预览构建产物，http://localhost:4173
node server/main.mjs   # 用生产静态服务器托管 dist/（先 build），http://localhost:8080
```

---

## 输入 JSON 格式

```json
{
  "nodes": [
    { "id": "S1", "name": "市政供水", "kind": "supply", "x": 60, "y": 120 },
    { "id": "A",  "name": "分水点",   "kind": "junction" },
    { "id": "O1", "name": "一号展厅", "kind": "outlet" },
    { "id": "L",  "name": "漏点",     "kind": "leak" }
  ],
  "pipes": [
    { "from": "S1", "to": "A", "valve": "V1" },
    { "from": "A", "to": "O1" },
    { "from": "A", "to": "L", "valve": { "id": "V2", "state": "open" } },
    { "from": "L", "to": "D1", "valve": { "id": "V3", "state": "closed" } }
  ],
  "supplies": ["S1"],
  "leak": "L",
  "protectedOutlets": ["O1"],
  "outlets": ["O1", "D1"]
}
```

### 字段说明

**nodes（必填，数组）**

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | 是 | 节点编号，拓扑内唯一 |
| `name` | 否 | 显示名称，缺省用 `id` |
| `kind` | 否 | `supply`（供水点）/ `outlet`（出口）/ `junction`（普通节点，默认）/ `leak`（漏点）；也可在页面勾选角色 |
| `x`、`y` | 否 | 拓扑图坐标（viewBox 为 900×560）；不提供时使用内置确定性力导向布局 |

**pipes（必填，数组，无向管段）**

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `from`、`to` | 是 | 管段两端节点编号 |
| `valve` | 否 | **省略即为无阀管段**。字符串 `"V1"` 表示编号 V1 的开启阀门；对象 `{ "id": "V3", "state": "closed" }` 可指定初始关闭状态 |

阀门编号在整个拓扑中必须唯一；每个阀门仅属于一条管段。

**顶层角色字段（均可选，也可在页面勾选/修改）**

- `supplies`：供水点编号（一个或多个）；
- `leak`：漏点编号；
- `protectedOutlets`：检修期间必须不断水的出口编号；
- `outlets`：可选，显式声明出口列表（不声明时，取 `kind:"outlet"` 与 `protectedOutlets` 的并集）。

页面内置两个示例：**示例一**（双供水环路、存在并列最优方案）和 **示例二**（保供出口与漏点共用无阀立管，无解），点击按钮即可载入。

---

## 搜索规则与算法

1. **候选阀门**：只有输入中当前 `state:"open"`（缺省即开启）的阀门允许被“关闭”；
   `state:"closed"` 的阀门在搜索中视为常闭，程序绝不会建议打开它。
2. **连通模型**：无向图，无阀管段恒通；带阀管段在阀门开启时通，关闭时断。
3. **可行方案**：在候选阀门中选择一个集合关闭，使
   - 从所有供水点出发都无法到达漏点（即漏点与每个供水点均断开）；
   - 每个保供出口仍可从至少一个供水点到达。
4. **最优方案**：先按关阀数最少；关阀数相同时，把阀门编号升序排列后按字典序比较，取最先者，其余列为并列方案。
5. **枚举规模**：当前开启阀门数 **最多 12 个**，即最多枚举 2¹² − 1 = 4095 个非空组合
   （按关阀数 k 从小到大，找到可行层即停）。超过 12 个会明确提示，不执行搜索。
6. **无解诊断**：除穷举结论外，还会提示典型结构性原因，例如：
   - 漏点与供水点之间存在完全不经过阀门的路径；
   - 某保供出口与漏点处于同一段无阀管网；
   - 某保供出口在拓扑上与所有供水点不连通，或已被输入中初始关闭的阀门隔断。
7. **不改变输入**：所有计算在规范化后的副本上进行，原始 JSON 对象只读；页面不会把关阀状态写回输入。

---

## 输出内容

- 推荐关阀清单（红色阀门编号）与“无需关阀”的特殊结论；
- 各出口 **初始 / 方案实施后** 连通状态对照表，保供出口高亮，并标注实施后由哪些供水点供水；
- 同关阀数的并列方案（折叠展示）；
- 按关阀数分层的枚举统计表；
- 拓扑图：蓝线为方案实施后仍通水的管段，红色虚线/红色菱形阀门为推荐关闭位置，灰色为初始关闭阀门。

---

## 目录结构

```
.
├── Dockerfile                # 多阶段构建：npm ci + 类型检查 + Vite 构建 → Node 静态服务器
├── docker-compose.yml        # 单条命令启动（端口 8080）
├── index.html
├── package.json / package-lock.json / tsconfig.json / vite.config.ts
├── server/
│   └── main.mjs              # 零依赖 Node 生产静态服务器（仅内置模块）
└── src/
    ├── main.ts               # 页面交互与结果渲染
    ├── style.css
    ├── types.ts              # 类型定义
    └── lib/
        ├── topology.ts       # JSON 解析、校验、规范化、建图
        ├── solver.ts         # 多源 BFS + 关阀组合枚举 + 无解诊断
        ├── diagram.ts        # SVG 拓扑图（含力导向布局）
        └── examples.ts       # 内置示例拓扑
```
