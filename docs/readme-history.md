# README 历史发布与契约记录

以下内容从 README 迁入，仅记录当时的版本、候选和测试状态。当前宿主入口见
[README](../README.md)，正式使用仍须核对所选提交的成功 CI 与发布产物。

## 历史 v2.0.11 发布记录

以下为 v2.0.11 / `dde805a27d7c636732f181dc1eab906330e6f7c9` 的历史发布证据。
宿主提交 `1d50c01a29b11186c29c07105c3d9c24b3762a96` 的 CI `45407070627`
已成功，镜像已推广：

```text
ghcr.io/ai-specs/kestra-overlay@sha256:05917c8f72777ab9f9fb01f106d33db344ff9d01435a3cd836b7c7a037c447e1
```

正式报告已下载核对；双架构 provenance 的 completeness=false 限制保留。
本节及下方带日期的候选段落只记录历史，不是 v2.0.13 的发布或部署指令。
独立扩展仍须自行取得正式宿主输入并通过自身发布门；部署组合由部署仓验证。
升级工具与交付前文档检查见 [上游升级规则](upstream-upgrade-agent.md)。

## 历史能力记录

以下至“这是面向第三方独立扩展项目”之前为按日期保留的历史记录。文中的“候选”、
“当前”及“待发布”仅指当时状态，当前宿主发布状态以上方正式发布节为准。

2026-11-23 REQ-0407 候选（未发布）：MCP 后台工具刷新显式隔离队列连接、事务和请求
授权上下文。真实 Micronaut/H2 红复现确认原实现跨 boundedElastic 复用调用方 Connection；
候选保持原工具调用身份、权限、错误与关闭路径，不修改队列 fatal/retry，不增加自动重启。
候选本机 arm64 镜像 `kestra-overlay:queue-context-20261123` 只用于本地验收，未推送、
未推广，不得作为正式插件编译输入或生产部署版本。实际验证范围与限制见
[R-EE-RBAC 的 REQ-0407](r-ee-rbac.md)。

REQ-0406 已随正式宿主 `e27864c` 发布，CI `45069032782`，正式镜像 digest 为
`sha256:116c5503bbca8b889c65de95ae86afdf196be461f1201dabda7e5f2fc8b492f8`。
它修复原生 Flow 列表模式 A/B 首屏同值 configs 重载误清空，保留身份失效与当前查询
补偿，并统一原生列表和详情浏览器的有界异步等待。该正式输入不包含本轮0407候选；
部署组合仍由部署仓验收，宿主发布不能代替生产组合通过。

2026-11-17 REQ-0400 本地候选（未发布）：原生 GET `/api/v1/main/ai/providers`
精确使用租户 `AI.READ`，只返回既有 `id/displayName/isDefault`。该许可不授予模型执行、
流程读取或旧 generateFlow；未知 AiController 方法和路径失败关闭。关闭 RBAC 的模式 A
保留原生路径。生产 4891c3d 的 providers 403 证据、红绿及剩余门见
[R-EE-RBAC](r-ee-rbac.md) 的 REQ-0400 记录；完整本地构建及本机镜像门已通过，SDK949 首轮休眠中断的失败保留、完整重跑通过。
主控审查、正式 CI、镜像发布和部署组合仍待验证。

### 历史授权契约记录

## Typed authorization V2 候选契约（2026-11-18，未发布）

REQ-0401/0402 已完成本地源码与镜像候选检查；正式 CI、镜像推广和消费扩展组合仍待
主控验收。本节不是当前正式镜像能力声明，插件不得以本地候选作为正式编译输入。

`io.kestra.webserver.rbac.TypedAuthorization.CONTRACT_VERSION` 为 2。公开共享域为
`io.kestra.core.models.NamespaceDomain(List<Term> terms)`，`VERSION=2`；
`Term(Universe universe, boolean allNamespaces, List<String> exactNamespaces,
List<String> namespaceSubtrees, List<String> excludedNamespaces, List<String> excludedSubtrees,
IdScope idScope, List<String> resourceIds)`。`Universe` 为 NAMESPACE/TENANT，`IdScope`
为 ALL_IDS/RESTRICTED_IDS。通过 `QueryDomain.structured(domain,complete,paginated)`
构造，`effectiveDomain()` 取得实际相关域；空域规范为明确拒绝域。

term 是相关项，域是 term 的并集。包含、精确/子树排除、IDs 保留在同一项；交集逐项
配对，包含求交、排除求并、IDs 求交。NAMESPACE 的 allNamespaces 是当前操作 tenant
内全部合法具体 namespace，不含 null，与 TENANT 分离。子树包含自身及点分隔后代，
不匹配 company2。补集是该项的允许域，另一条正向项继续有效。宿主不解析 `!` 语法。

固定上限为 `MAX_TERMS=256`、每项包含选择器总数及排除选择器总数各
`MAX_SELECTORS=128`、每项 `MAX_IDS=256`、单次交集 `MAX_PAIRS=4096`；结果继续
遵守相同构造上限。超限、未知版本、非法选择器或不支持的资源 ID 查询域失败关闭，
不得截断或扩大为 GLOBAL。COMPLETE_QUERY 的 namespace 检查保留非空相关 ID 域给
SQL；标量操作与创建空 ID 不得借此跳过 IDs。

旧 QueryDomain 构造器保留精确排除含义和调用形状，不表示旧二进制能消费 V2。旧
Operation/Decision 版本拒绝；provider、评估、MCP 和独立探针必须按正式 V2 产物重新
编译验证。旧无选择器请求 unrestricted 作为请求交集恒等元；显式结构化 namespace
GLOBAL 不授予 TENANT。namespace/log JDBC、候选 predicate 和实际单资源检查使用
相关项；非 FLOW/EXECUTION 的受限 ID 查询未普遍支持，必须明确拒绝。

未解析 REST controller/handler 返回空计划，SYSTEM 不再作为可授予行政兜底。
普通 bulk/import/backfill 等尚未适配的路径保持拒绝，不计为正常功能已支持。特殊
功能登记仍为文档候选，本批没有新增泛 FEATURE 或 MCP scope SPI。MCP 动态工具列表
继续在每次评估中逐 Flow 执行 typed READ，旧 AccessScope 仅为独立上界。

本地完整 localCI 为后端597项（595通过、0失败、2项原镜像专项 assume）、core3、
UI130通过；镜像专项随后在候选门运行，不将 assume 计为通过。候选 executable
SHA-256 为 `126b4ed8c5431b88fcc4dda5878da5611e367a2f1a7796d65942ca79e36336b4`。
当前 classpath、OIDC35、MCP原脚本、form/env原脚本、geometry64及SDK949通过。
SDK949具名ID唯一、零失败/跳过/未运行且source hash复核一致。最终结果、兼容限制和
消费者清单见 `docs/r-ee-rbac.md`；本地门不等于正式发布。

REQ-0399 已随正式宿主 `4891c3d` 发布；该基线将 AI 会话入口与工具访问分别授权。
其租户级 `AI.READ`（读取自己的线程）和 `AI.EXECUTE`（创建、聊天、确认及持续输出）
操作；线程归属不授予流程或执行权限。工具仍检查实际 FLOW/EXECUTION/LOG/METADATA
及依赖授权。不能用 `SYSTEM`、首装账号身份或仅管理权限替代显式 AI 运行许可。
关闭 RBAC 且不装载插件的模式 A 保留原有能力；模式 B 需要正式兼容插件的显式授权。
该正式基线不包含本轮 0400 provider 读取修复；0400 仍为未发布候选，不得作为
独立插件的正式编译输入。当前机制与限制见 [R-EE-RBAC](r-ee-rbac.md) 的记录。

2026-11-11 本地未发布第二候选：执行 follow 源内授权生命周期与通知修复已通过独立
local-ci（后端451通过/2镜像专用跳过、UI126）和当前镜像门；主控真实生产十次流程
通过。SDK949、geometry64及全部相关本地镜像门已通过；正式CI、推广与最终交付
未完成。该候选不能作为插件正式
编译输入。最新状态和历史失败候选边界见 docs/r-ee-rbac.md 的本轮记录。


0384当前公开契约输入为2f2984a：contract.json的overlayCompatibility与内置SDK README
一致，仅支持KsDrawer/KsDialog/KsSelect/KsFilter经公开helper和owned renderer使用。
原始未适配弹层、popover、未列出的复杂下拉和KsPagination仍不支持。新13文件输入
包含公开说明与一致性测试；必须核对对应提交构建、完整矩阵和镜像发布，不复用旧输入。

原生filter锚定正式基线（2026-10-29，`1e3632e`，成功CI `40822882820`）：扩展renderer将当前owned高级筛选
触发器映射到viewport坐标，隔离宿主document同名filter；移动层按实际触发器所属实例
关联。正式基线真实几何36门与原949矩阵已随该版本发布。
业务groupable、字段和AND/OR语义仍由消费扩展配置，本机制不赋予业务权限。

移动filter视口边界正式基线（2026-10-30，27520a2/CI40941713707）：原36门保留，移动底部/离屏/重开resize新增12门，总48；原949仍须针对最终提交实际执行。移动sheet仅下方空间足够时保持bar+8，否则翻转或视口clamp并维持正滚动高度；desktop本轮不变。该移动基线已正式发布；后续增量仍须通过其自身最终CI和推广。

0384提供公开原生组件的最小ShadowRoot portal、焦点、ESC及导航适配，不包含业务模型
或业务UI。消费方必须使用对应正式镜像中的SDK与其精确依赖，并经helper使用已声明
组件；不得将未适配的全局弹层或其他版本推断为支持。规范fullPath/query与可选异步
beforeNavigate只有明确true允许离开，异常/abort失败关闭；安全登录/拒绝路由不受草稿
阻止。具体支持边界见docs/r-ee-rbac.md。实际发布以对应提交CI及镜像推广成功为条件。

2026-10-28历史本地验证：11文件补丁69e11808、build02d12978的完整local-ci、普通
镜像门及Ego/Playwright同949均通过。公开元数据与SDK说明的后续修订产生新输入时，
必须重新验证，不继承该旧hash结果；本地通过不能代替对应提交CI和正式镜像发布。

> 当前应用组协议候选与发布边界见本仓 `docs/r-oidc-server.md`。应用组业务归消费插件；未经正式发布的候选不能作为独立插件的交付编译输入。

协议0380–0383已在64c4498通过正式CI40523539018并推广镜像
`sha256:bebf7a7c06a6205c151ffd35882c54965918357f4e1c71bc0cd2879c3177a22e`。
该正式44补丁版本不包含后续UI SDK兼容扩容；后续SDK须选择另行通过发布门的对应镜像。
本地通过或源码中的公开类型不是插件正式编译输入，不代表插件或部署组合已交付。
