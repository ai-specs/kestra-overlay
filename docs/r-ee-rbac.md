# R-EE-RBAC：OSS 上的外部细粒度授权能力（需求文档）

> **状态**：实施中（2026-10-13）。消费仓已指定为 `ai-specs/kestra-plugin-rbac`。
> 独立 jar 承载业务角色模型与 REST 操作解析；overlay 提供统一授权 SPI、REST
> 失败关闭门、REST 执行前 gate、MCP 可信主体传递及逐操作激活点，构建期只注入 classpath 元数据。
> 真实 jar、镜像和 CI 验收全部完成前，不宣称完整细粒度资源隔离已交付。
> **归属**：`docs/oss-ee-gap.md` §2-B 行 / §4 R-EE-RBAC 行的展开。
> **一句话**：让任何下游能以 EE 同构方式（外部组件 + 配置）在 OSS 上获得**每请求
> (资源， 动作， namespace) 级**的授权判定。补的是授权判定钩子这个架构能力，
> 不复刻 EE IAM 产品面。

证据分级：`[src]` = BASE（v2.0.5 @ 172dd0f37）源码；`[live]` = 2026-10-07 本地 vanilla
实例（kestra:v2.0.5-no-plugins，Basic Auth admin 会话）实测；`[docs]` = kestra.io 官方
文档（`[docs-rbac]` = auth/rbac 页原文，`[docs-sa]` = auth/service-accounts 子页）。

## 1. 背景：OSS 实测现状

API base 校准：`/api/v1/main/flows/search` → 200（会话有效）；`/configs` 真实路径 =
`/api/v1/configs`（MiscController `@Controller("/api/v1")`）。

| 探测 | 返回 |
|---|---|
| `GET /ui/main/admin/iam` | EE 推销页（标题 + 介绍 + Contact Sales/Learn more → kestra.io/docs/enterprise/auth） |
| `GET /api/v1/configs` | 200：`edition:"OSS"` |
| `GET /api/v1/{users,roles,permissions,groups,service-accounts,me}`（含 `/main/` 变体） | **全部 route-miss 404** problem+json |

`[src]` OSS 主源码零授权钩子（webserver/core 无 SecurityRule/intercept-url-map 类，
2026-10-07 复扫）。认证过滤器链不在 OSS 构建（`webserver/build.gradle:25` 仅 csrf，
差异表 §1-S6）。

⇒ EE 的 IAM 不是「OSS 有端点但门控 403」（区别于 MCP authType 那类点门控）。
判定面整体在 EE jar。OSS 侧没有可解禁的开关，只能从外部叠加。

## 2. EE 参照面（能力语义基线；本需求**不照抄**其产品语义）

`[docs]` kestra.io/docs/enterprise/auth/rbac（2026-10-07 抓取）：

- **权限原子 = 资源 × 动作**。核心 namespace 级资源：FLOW、EXECUTION、TRIGGER、
  NAMESPACE、KVSTORE、SECRET、CREDENTIAL。tenant 级资源：DASHBOARD、BLUEPRINT、APP、
  TESTSUITE、ASSET、MCP_SERVER、COPILOT、USER、GROUP、ROLE、BINDING、SERVICE_ACCOUNT、
  INVITATION、AUDITLOG、POLICY、SYSTEM_SETTINGS、TENANT_SETTINGS。通用动作
  VIEW/LIST/CREATE/UPDATE/DELETE + 资源专属（FLOW:EXECUTE、EXECUTION:KILL/REPLAY/
  ACCESS_OUTPUTS、USER:IMPERSONATE）。**无通配符语法**。
- **绑定（binding）= 角色 ↔ 主体（用户/服务账号/组），scoped 到 namespace 且向子级
  级联**（绑 `prod` 覆盖 `prod.engineering`）。绑定不可变，只能删除重建。
  「角色本身不授予任何东西——必须经绑定附着到主体」。组绑定授予全部成员；删组只剥权限，
  成员保留。
- **内置角色 5 个**（Instance Owner 可另建自定义）：Admin（全资源全动作）/ Developer /
  Editor / Launcher（执行系动作，无 flow 写）/ Viewer（只读+EXPORT）。
  Instance Owner 是独立用户类型（跨 tenant 管理，无 flow/execution 访问）——不是 Admin 角色。
- **服务账号**：与用户同等接收角色绑定（"treated as users when binding role assignments"
  `[docs-rbac]`）；「无密码、无 UI、仅 API token 认证」出自 service-accounts 子页 `[docs-sa]`。
- **SSO 默认角色**：可为经 SSO 新加入的用户配置自动指派默认角色 `[docs]`——本需求 ③ 层
  「OIDC claim → 角色」映射的官方同构参照。
- 管理面：IAM UI / SCIM / Terraform / 流程内 IAM 任务 `[docs-rbac]`（官方 RBAC 页另链
  「Permissions reference」资源↔端点映射；未写明管理 REST 与 deny 的 HTTP 语义——本需求
  §3 的 403 problem+json 是自定目标行为，不归因官方宣称）。impersonation
  （USER:IMPERSONATE，Instance Owner 可对用户执行）用于验证生效权限。

**2026-10-07 官网一致性审核**：资源清单、动作与无通配符、绑定级联/不可变/「角色须绑定」、
五内置角色——四组论断与该页逐项一致。两处已修正：服务账号细节改标 `[docs-sa]` 归属；
管理 REST 与 deny→403 官方页未写明，改注为本需求自定行为。

## 3. 目标能力（需求本体）

在 OSS 镜像上（本仓 patch 集 + 扩展仓 jar + 部署配置的组合形态）：

1. 任一**已认证**主体的 REST 请求与 MCP 工具内部实际资源操作可被**外部授权组件**按
   **(资源， 动作， namespace)** 判定 allow/deny。二者使用同一主体和授权语义；
   MCP 共用 HTTP 入口不能代替逐工具/子操作判定。
2. deny → **403 problem+json**（复用上游错误管线）。未认证 → 401（API 客户端）或登录
   重定向（浏览器）。与 EE 语义一致。
3. 角色/权限模型与主体-角色映射由扩展仓自带。模型自定，不要求复刻 EE 的五角色/
   binding/级联语义。机器身份走 OIDC JWT（差异表 §2-A 替代路线），不建 EE 式 token 库。
4. 本仓 MCP 能力 scope 独立控制资源大类 read/write/delete（write 不含 delete），
   不由外部 RBAC 定义或代替；RBAC 启用时两层均须允许。详细契约见
   [MCP OAuth2 双层门](mcp-oauth-integration.md#mcp-能力-scope-与外部-rbac-的独立双层门)。
5. RBAC 启用但组件不可用、主体丢失或具体资源无法确定时失败关闭，不静默放行。

## 4. 非目标（AGENTS.md §2 拒绝清单约束）

| 不做 | 理由 |
|---|---|
| 用户/组/服务账号/角色/绑定管理 CRUD（REST+UI+邀请流） | EE 产品功能 |
| SCIM 目录同步 | EE 产品功能 |
| 审计日志 | EE 产品功能 |
| impersonation | EE 产品功能 |
| EE 式 API token 签发/管理 | 机器身份走 OIDC JWT |
| UI 按钮/菜单按细粒度 RBAC 隐藏 | 不在本需求；OIDC/MCP 用户同意与能力 scope 页面是独立已接收认证契约，不受此非目标排除 |
| 照抄 EE 五内置角色/binding 不可变/级联语义 | 业务语义归扩展仓设计 |

## 5. 交付分层与归属（EE 同构三通道）

| 层 | 内容 | 归属 | 通道 |
|---|---|---|---|
| ① | 扩展 jar 进镜像的承载机制 | **本仓骨架**（R-CLASSPATH-MERGE，已立案待实施，机制文档 §4） | ② 前置 |
| ② | 认证链（micronaut-security）+ `intercept-url-map` 全局认证门 | 认证层（R-OIDC-SERVER patch 内置——前置裁定②）+ 部署配置 | ①+④ |
| ③ | 细粒度判定：SecurityRule + 必要的执行层 Authorizer，(主体，资源，动作，namespace) → allow/deny；覆盖 REST 与 MCP 实际调用 | 扩展仓 jar（角色模型在此层），本仓提供最小激活面/主体传递 | ② |

依赖链 ①→②→③，逐层可验收（② 即差异表 §2-B-1 最小端点门）。

**数据面占位（已立，2026-10-07）**：`extensions.tsv` 的 classpath 行 `kestra-rbac-authorizer`
——约定文件名 `kestra-rbac-authorizer.jar` 即 R-CLASSPATH-MERGE 落地后的 manifest
Class-Path 条目（休眠占位：缺席=静默休眠；外部仓按约构建、挂载 `/app/libs`、重启生效）。

## 6. overlay patch 面

角色/权限实现进外部 classpath jar，不进 overlay。仅靠 HTTP SecurityRule 是否
能覆盖现有 MCP 执行路径须逐工具实证，不能预先承诺零 patch。若直接服务调用、
批量/异步/流式路径缺执行层授权点，按 AGENTS.md §2 入口 B 收最小激活 patch
（消费仓 + 调用路径证据 + 差异表行），不搬入业务权限模型。缺口未闭环不得交付。

## 7. 前置与触发条件（形态绑定，AGENTS.md §3-6）

- 前置：R-CLASSPATH-MERGE 落地（jar 承载）。
- 本仓侧的扩展点充分性（通道②承载、激活点盘点）按基本原则独立推进，不受外部
  指名时序影响（AGENTS.md §0·基本原则）。
- 开工（动刀：patch/实证）要件：① 指名消费扩展仓（kestra-oidc-provider 侧或未来
  授权扩展仓）；② 行为证据（缺授权时哪个端点/页面/流程暴露）；③ 最小面声明；
  ④ 差异表 §2-B 行（已存在，本文即其展开）。

## 8. 验收判据（①②③ 全部落地后执行）

```
无 token    curl POST /api/v1/main/flows            → 401（或浏览器 307 登录重定向）
低权限 JWT  curl POST /api/v1/main/flows            → 403 problem+json
低权限 JWT  curl GET  /api/v1/main/flows/search     → 200（只读放行）
高权限 JWT  curl POST /api/v1/main/flows            → 2xx（业务结果）
namespace 边界：低权限对 {ns-allowed} 可写、对 {ns-denied} 403（由扩展仓角色模型定义）
同用户/资源/动作：REST deny → MCP tools/call 也 deny，无业务副作用
复合/批量/直接服务/异步：全部子操作受控，身份传递不丢失，无路由绕过
scope deny + RBAC allow → deny；scope allow + RBAC deny → deny
RBAC 启用且组件异常/主体缺失/资源不明 → deny
回归：无认证链部署（不装 ②③）行为与 vanilla OSS 逐字节一致（本仓 patch 不引入授权行为）
```

## 9. 风险与开放问题

- **OQ-RBAC-1**：SecurityRule/Authorizer bean 从外部 classpath jar 注册的端到端实证未做。
  随 R-CLASSPATH-MERGE 实施步骤 2 一并闭环（F2：bean 发现=启动期，须带 micronaut 注解
  处理索引）。
- **OQ-RBAC-2**：过滤器链与执行层死角未扫。开工前盘点 BASE 路由及全部 MCP
  工具→服务→具体资源操作（直接、复合、批量、异步、流式）路径，逐一标注统一
  Authorizer 执行点。只完成路由盘点不算闭环；MCP 路径未覆盖就是授权漏洞。
- **OQ-RBAC-3**：与 CSRF/SecurityFilter 顺序（micronaut SecurityFilterPhase）协同未实证。
- **OQ-RBAC-4**（2026-10-07 充分性审查新增）：deny 的 403 是否被上游
  `ProblemResponseFilter` 自动 problem 化未实证（该 filter 对 ≥400 且无 body 的响应补
  problem 文档；安全链 403 的 body 形态取决于 micronaut-security 渲染）。若不自动，
  由 ③ 层扩展仓渲染——不影响占位具备性，只影响 §8 验收细节。

EE 未来 release 的 RBAC 语义变化不影响本需求（不复刻其语义）。BASE 升级复扫仅核对
§1 的「OSS 零钩子」事实是否仍成立（差异表 §5 命令集覆盖）。

## 10. 证据清单（复现）

```bash
# [live] vanilla 实例（Basic Auth admin 会话）：
curl -s http://localhost:8080/api/v1/configs | jq .edition          # "OSS"
for u in users roles permissions groups service-accounts me; do
  curl -s -o /dev/null -w "%{http_code} /api/v1/$u\n" http://localhost:8080/api/v1/$u   # 全 404
done
# [src] BASE 树内（差异表 §5 命令集）：
git grep -ln "SecurityRule\|AuthorizationInterceptUrlMap" -- 'webserver/src/main/**/*.java' 'core/src/main/**/*.java'  # 空=零授权钩子
grep -n "micronaut-security" webserver/build.gradle                  # 仅 csrf
```

文档源：kestra.io/docs/enterprise/auth（索引）、…/auth/rbac、…/auth/service-accounts
（2026-10-07 抓取；`.md` 后缀取纯文本）。

## 11. 本阶段实施接收（2026-10-13）

入口 B 四要件：

- 消费仓：`ai-specs/kestra-plugin-rbac`，以 monorepo submodule 组织。
- 行为证据：现有 `McpCapabilityGate` 仅有 MCP READ/EXECUTE 扩展 SPI；
  REST `FlowController.createFlow` 与 `ExecutionController.createExecution` 在认证后
  直接调用业务服务，未消费资源授权组件；外部 jar 缺席时无法约束 REST。
  `selfrun` 使用 `java -jar`，未声明 Class-Path 时 `/app/libs` jar 不进入应用上下文。
- 最小面：构建脚本注入 manifest 元数据；overlay typed SPI、常驻失败关闭门、
  可信角色传递和执行前授权激活点。角色、绑定与权限模型属于外部仓；上游路由适配属于宿主。
- 归属行：差异表 §2-B 与 §4 的 R-EE-RBAC / R-CLASSPATH-MERGE。

部署统一开关为 `kestra.rbac.enabled`。未知、无法确定完整资源集合或无法安全解析
的路径必须拒绝，支持路径以消费仓覆盖清单及真实镜像验收为准。
使用本次 CI 推送并验收后的 commit hash 标签或 OCI digest，不能依赖复用的版本
标签判断代码是否更新；monorepo 固定镜像与插件提交组合。

本阶段实证发现 REST `createExecution` 在选择 revision 与 namespace meta 处理后才
获得实际 runtime flow；因此仅在 HTTP 入口解析作者源码不能证明覆盖实际输入/输出读取。
overlay 在 `readExecutionInputs` 之前消费真实 runtime flow、execution ID 和可信主体，
执行资源权限与外部依赖计划检查。该点不包含角色模型或业务路由策略。
## Namespace 查询契约：REQ-0240

入口 B，消费扩展仓 `kestra-plugin-rbac`。用户生产目标要求普通用户只看到授权
namespace 的列表、分页、计数和统计，并支持多角色权限并集。旧 `AccessScope`
只能表达子树：Exact `team.a` 会错误匹配 `team.a.child`；只读枚举数据库后传入
旧 scope 仍有同样问题。Namespace search/autocomplete 在仓库 ACL 之后补充父级和
system namespace，未授权候选会进入分页和 total。这两条失败路径是接收依据。

最小宿主面为 scope 数据表达、统一 JDBC 与独立 log-store 条件翻译，以及 Namespace
控制器合成候选过滤。宿主不得包含角色、主体绑定、管理员或后台身份策略。

`AccessScope` 保留 `GLOBAL`、`NAMESPACES`、`DENY_ALL`。三参构造为
`AccessScope(Kind, List<String> namespaces, List<String> exactNamespaces)`；旧二参构造
及 `namespaces(List)` 保留子树语义。`namespaces(subtrees, exact)` 返回两者并集；
两集合为空时拒绝全部。集合复制为不可变列表。Exact 只比较相等；子树匹配自身及
点分隔后代，不匹配前缀碰撞。`GLOBAL` 不改变默认 OSS 行为。

`AccessScope.namespaceAllowed(id)` 提供统一匹配；
`NamespaceAccessControl.namespaceAllowed(resource, id)` 是基于当前 scope 的 default
方法。Namespace search/autocomplete 在父级展开之后、分页和 total 之前过滤全部候选，
包括 system 与强制 IDs；强制 IDs 不得绕过 predicate。候选来源保持原状，不承诺发现
只有 KV/file 或尚无 flow 的 namespace。详情及写操作仍须由 REST 计划授权。

MCP scope 匹配使用同一 predicate，缓存键区分 Exact 和子树集合，防止跨 scope
共享工具缓存。没有新增 enum，已有 switch 仍穷尽全部 kind。旧构造调用描述符保留；
record 反射和序列化增加组件，消费方必须按发布产物核对兼容性。

插件可以替换 `GlobalNamespaceAccessControl` 和 `GlobalLogDataStoreAccessControl`，
按可信请求身份生成资源 scope。未登录、上下文丢失和后台 engine 行为由插件
决定。此契约不提供写操作授权、任务沙箱或请求上下文传播保证。

宿主定向探针 `NamespaceScopeContractTest` 验证 Exact/child/前缀碰撞、混合 union、
空 scope、GLOBAL、二参构造、真实 H2 SQL 条件、独立 log 条件、MCP 缓存隔离，以及
Namespace 分页、total 和强制候选。真实插件和 Compose 验收归消费仓与部署仓。

## Typed 宿主适配：REQ-0250 / REQ-0260

入口 B，消费仓为 `kestra-plugin-rbac`。普通 UI 的 Flow revisions/graph、Execution search、
KV/file、Dashboard preview 必须使用稳定资源语义。旧 REST SPI 将 controller、handler 和 URL
交给扩展解析，导致扩展随上游路由变化而修改。Dashboard Execution/Log/Trigger `fetchData`
没有附加已有 namespace ACL，是聚合查询越权的实际路径。

比较结果：复用 `NamespaceAccessControl`、独立 log ACL 和现有 runtime execution gate；
增强查询排除条件与 dashboard fetchData 条件；新增宿主适配器消费版本化 typed policy。
不新增角色模型、IAM API 或菜单产品功能。上游适配集中在 `OssRestOperationAdapter`，
扩展只实现 `TypedAuthorizationResolver`，不读取 URL、controller、handler 或 chart 文本。

`kestra.rbac.enabled: true` 和 `kestra.rbac.typed.enabled: true` 同时启用 typed REST 与查询门。
typed 开关默认关闭，以保留旧已发布扩展兼容性；启用后旧 REST resolver 不参与请求授权。
未知业务操作生成 SYSTEM/EXECUTE 完整批次操作，只能由扩展明确授予实例权限；普通角色
必须拒绝该操作。实际执行 gate 和 MCP gate 在 typed 模式下消费同一 policy，MCP scope
检查保持独立。输入/输出依赖解析继续使用已有公开 `McpAuthorizationResolver`。

`QueryDomain` 明确区分 GLOBAL 与 RESTRICTED。受限空集合为空域；null scope、null 集合、
集合中的 null、非法 namespace、不完整分页域和未知版本必须拒绝。宿主将 policy scope
与实际查询域求交集。排除项表示精确 namespace，SQL 在分页、total 和聚合之前附加排除条件。
Exact 不包含后代或同名前缀。Namespace 合成候选使用同一 predicate。

Dashboard 在合并真实 global filters 后解析实际 datasource；只接受宿主 Execution、Log、
Trigger 数据源及 FlowDescription，拒绝未知类型与表达式。实际 repository 执行范围受
namespace/log ACL 限制；KPI 的分子和分母均使用 repository ACL。展示字段不进入授权。
Namespace file 根目录只读列举不会创建目录。Execution 文件读取只接受实际 execution
storage prefix 中的规范 `kestra:` URI，其他 scheme、跨 execution、编码和路径歧义拒绝。

宿主自身探针包括真实 Netty、真实 H2 Flow 搜索、精确 namespace/child/前缀隔离、拒绝创建后
无 Flow 持久化，以及 typed 缺组件/身份/异常、scope 交集与 datasource 检查。构建脚本必须
校验专属 XML 无失败和跳过。通过源码探针不代表发布镜像或第三方 Compose/UI 已验收。

REQ-0261 在现有 topology repository 的查询入口附加 source/destination 两端 Flow
namespace ACL。未授权的依赖边不得进入图构造；H2 条件探针验证 Exact 不包含 child，
且任一端越权都排除。该机制不改变依赖业务模型，不将策略放入宿主。

REQ-0270 将 Dashboard 数据查询授权放在 `ChartDataService` 的实际 repository 调用前。
公开 `DashboardQueryAccessControl` 提供默认 GLOBAL bean，宿主 typed adapter 替换该 bean。
每次 `fetchData` 和 `fetchValue` 都必须先完成授权。百分比 KPI 的分子与分母分别生成
operation；分子域额外交集 numerator 中的 namespace 条件，分母只使用实际 where 域。
实际 SQL 范围继续由 namespace/log ACL 应用。未知 datasource 或表达式拒绝，普通
策略不读取 chart 文本。执行顺序探针验证两次 operation 和拒绝时零 repository 调用。

REQ-0280 不再根据缺少 `ServerRequestContext` 推断全域内部调用。HTTP filter 捕获实际
请求来源，宿主执行器包装器使用 Micronaut `PropagatedContext` 传播来源和身份；上下文
完全丢失且无显式内部标记时，namespace/log 查询 scope 为空。身份缺失不能被内部标记
覆盖。runtime KV/file metadata façade 和定时 KV 清理入口显式声明宿主调用来源；HTTP
调用该入口仍保留原请求。后台 scope 不等于 HTTP 主体权限，不向插件暴露线程名或路由。
裸线程上下文丢失、线程池请求传播、明确内部调用、内部标记下HTTP身份缺失和真实H2查询
探针必须通过。真实 Compose 仍需验证 engine、scheduler、MCP及关闭RBAC回归。
异步任务只复制授权来源，不复制 JDBC 连接、事务等执行上下文。queue subscriber 为明确
后台入口，订阅创建发生在 HTTP 处理中时也不能继承请求的连接与短期身份。该隔离由
上下文探针及真实 MCP 实例长连接/第二用户/SDK检查验证。

REQ-0290 对 GraphService 的实际 subflow 展开目标，在读取 Flow source 前复用
namespace ACL。Execution graph 原先的 WithoutAcl 读取不得绕过目标 owner 范围。
未知或越权目标拒绝；允许两个 namespace 时保留正常展开。GraphService 探针验证
拒绝发生在 repository 调用前，允许场景可以执行同一实际 source lookup。

### REQ-0300：UI、usage 与 MCP 读取反馈提案

消费项目为 `kestra-plugin-rbac`。用户实际报告登录落在缺少 tenant 的 dashboard 空白页、
usage 显示全局统计、MCP 只读页面被统一拒绝，以及零授权账号无法退出换号。
现有机制已经提供可信 principal、typed operation 和 namespace ACL，无需新增插件业务模型。

接收范围：UI 在首次资源加载前规范 tenant 路径；配置 API 拒绝后显示独立 403 页面，
退出动作复用宿主 OIDC 撤销会话和清除 cookie；usage 使用 tenant 报告入口及现有 Flow/
Execution ACL；MCP listTools 分类为完整 Flow 查询。MCP server READ/LIST grants 归插件
配置，配置写入仍需单独授权。宿主不得因允许连接页面而允许服务配置写入。

#### MCP 页面与宿主操作的对应关系

已有有效授权的受限用户必须能查看以下页面。角色无映射且无用户身份绑定的用户仍须拒绝。

| 页面 | 受限用户行为 | 宿主授权操作 |
|---|---|---|
| `/ui/main/admin/mcp-servers` | 查看服务列表 | `MCP_SERVER` 完整查询，要求 READ/LIST |
| `/ui/main/admin/mcp-servers/edit/default/edit` | 查看配置；不得保存或开启/关闭 | 读取为 READ，保存和开关为 UPDATE |
| `/ui/main/admin/mcp-servers/edit/default/connect` | 查看和使用连接说明，无额外配置变更 | 服务配置 READ；工具执行独立授权 |
| `/ui/main/admin/mcp-servers/edit/default/tool-flows` | 查看其 Flow 授权命名空间中的工具 | `FLOW` 完整查询，查询前应用授权范围 |

当前需求只允许明确获得实例管理权限的用户修改、保存和开启/关闭服务。部署配置将服务
只读权限与配置写权限分开，扩展策略决定权限。宿主不得按用户名作管理权限特例。
宿主不得因页面在 `admin` 路径下而将全部读取分类为管理操作，也不得因读取允许而放行写入。
当前 UI 控件可能可见；API 拒绝和原配置保持不变是必需验收条件。

连接页面可用不代表 token 获准调用工具。OAuth 能力范围与实际资源授权必须同时允许。
服务配置的租户级读取权限不得扩大 Flow 查询范围。后续宿主适配必须保留这些区别，
并使用本仓独立操作测试验证；实际角色配置和组合页面验收由部署仓负责。

此改动复用已发布 SPI，不改变版本和编译契约。宿主以独立操作分类探针验证，部署仓必须
验证每个角色的实际登录、规范路径、usage 统计范围、MCP 读取/修改拒绝/工具范围，以及
未知角色拒绝后点击返回登录并以另一账号成功登录。跨域多角色必须检查 A 写、B 读、B 写
拒绝和域外拒绝，拒绝检查须核对持久化。提案已接收并实施。宿主 CI
`38520344869` 通过并发布镜像；部署组合的当前验收证据由部署仓维护，本节不作为部署版本锁。
