# R-EE-RBAC：OSS 上的外部细粒度授权能力（需求文档）


## REQ-0368 通用扩展入口独立于业务配置（2026-10-18，已接收、未发布）

消费项目：`kestra-plugin-rbac`。本提案基于 overlay
`5cac500003433edd95d842bf0d3ece67001722bc` 的 39 个 patch，BASE 为
`172dd0f3760fb1255d3b22bd1fd07ce31b173fa3`。主控报告该提交 CI
`39110903137` 全部 success（含 promote），主控已下载后端和浏览器报告并核对正式
digest `1ffea645d37525ca4b789233f61d4c30fee810467983caffed7404cab806bb3c`。
不修改或重新生成 0366/0367，不改变 Java SPI、descriptor 或 UI SDK 的 V1 版本。

### 失败行为及归因

主控提供的真实组合输入：正式宿主 digest `df41b913711f32beedffa35617914be80b877ef81271059af58a071fe782580c`
与插件 `4bfcb29de2c38fcd6e5fa0f31c30d349f6859cd9`。通过真实 UI 编辑 client 后目录
推进 epoch，重新登录后 capability 返回 needsReconciliation=true、allowed=true、
reconciliationAllowed=true，业务 configs 返回 403。真实浏览器证据同时确认 manifest
被外层 METADATA 门拒绝；恢复 API 本身返回 200，恢复编辑器未挂载。

源码确认：`ui/src/main.ts` 的 OIDC beforeResolve 无条件 loadConfigs，把 403 转到
access-denied；它在 ExtensionPage 的 manifest 装载之前执行。App.vue 的
loadGeneralResources 又调用 loadConfigs；只修改守卫不足。DefaultLayout 以 configs
决定是否显示 LeftMenu、RouteTabsSidebar 与 ContextDrawer；App 顶栏还装载 GlobalSearch
及完整业务菜单。不能伪造空 configs 让这些组件误认为完整初始化成功。

已发布机制足以做扩展独立授权：UiExtensionController.manifest 逐 descriptor 执行
EXTENSION.READ；注册资源仍经宿主真实安全过滤。registry.ts 已支持可选 capabilityPath
且要求 allowed===true；ExtensionPage 当前只查 manifest，未复用 capability 检查。
插件 ProjectTypedPolicy 已明确允许获准恢复者的 EXTENSION.READ/UPDATE，而普通
METADATA 拒绝符合其契约。故缺口属于宿主 UI 初始化耦合，不是业务 configs 权限缺失。
OSS task 模块联邦不是管理入口，也不能修复此守卫链。

实际 docs 中不存在独立 ui-extension*.md。现有能力入口为本节所属的管理页面公开扩展
契约、extension-mechanisms.md 的管理页面机制和 oss-ee-gap.md 的 REQ-0340/0362。
本提案复用这些机制，不新增与现有能力重复的文档或服务端通行例外。

### 最小接收范围

主控接收并收窄：先认证 manifest 与目标 capability，再正常尝试 configs。只有 configs
明确返回 403 且目标扩展明确获准时，才启用该扩展的 fallback 安全壳层；configs 获准
的正常扩展继续完整宿主布局和菜单。其他错误不得作为 fallback，普通路由维持原门。

实现使用明确的 fallback
状态控制 App general resources；普通路由重新经过 configs，不伪造 configs。拒绝页
认证发现的通用获准扩展链接和其他安全、竞态、主题、语言矩阵保持接收。

补充真实证据：round18 的独立 manifest 请求也返回 403；同一身份 capability 与目标
恢复 API 均 200，configs 403。证据入口为部署仓本轮 `round-18-recovery-defect.json`。
源码确认 OssRestOperationAdapter 将 UiExtensionController.manifest 先分类为 METADATA，
TypedRestRbacFilter 因而在 Controller 的逐 descriptor EXTENSION.READ 前拒绝发现。
按主控增补接收最小发现激活：仅实际 UiExtensionController.manifest、main tenant、
精确 manifest 路径、GET/HEAD 请求可在已认证且既有评估边界内交给 Controller 逐项
EXTENSION.READ 过滤。不是 protocol/匿名豁免，不放行任何业务 METADATA、asset 或未知路径。
空发现可返回 200 空列表，但不授予目标访问。普通配置与资源/API 门保持独立。

1. 路由只按既有命名路由 extensions/page 及对应匹配记录识别扩展，不能按任意字符串
   包含 extensions 识别。先规范 tenant，再校验 ID，取得同源、禁重定向、携带当前 cookie
   的认证 manifest。仅目标 descriptor 存在、版本正确且声明的 capability（若有）明确
   allowed===true 时准入。空列表的 200 不证明目标有权访问。每次 direct、refresh、SPA
   进入均重新验证，不以先前成功或 configs 缓存替代。装载前继续使用同一通用校验流程。
2. 扩展路线验证 descriptor/capability 后正常请求业务 configs；仅该请求的 403 启用 fallback。
   configs 获准时保留完整宿主布局，其他错误不作为 fallback；普通路线仍执行原 configs 门。登录配置只用于选择认证
   流程，不证明身份。401 走既有登录；403、无目标或能力拒绝不装载模块；网络错误、非法
   JSON、未知版本、异常与超时不作为允许。无身份、恶意 ID 和错误 tenant 均失败关闭。
3. 仅为 configs 拒绝且扩展获准的路线使用专用安全壳层，明确这是扩展视图，不能声称完整宿主 UI。壳层提供获准
   扩展列表、根内导航、宿主导航链接、主题、语言及宿主真实退出动作。返回宿主链接进入
   原守卫，仍受 configs 门。扩展列表来自认证 manifest 和 capability，不硬编码业务 ID。
4. App 的 general resources watcher 必须同时观察路线类别、fallback 与 anonymous 状态，fallback 路线
   不调用 loadGeneralResources；离开扩展到普通路线须重新经过 configs 门并恢复普通
   初始化，不能仅观察 anonymous（两类路线都为 false）。专用壳层不挂载完整 AppTopNavBar、
   DefaultLayout 的业务侧栏/上下文抽屉、版本通知、tour 或 PWA 业务提示等配置消费者。
   保留通用错误处理和必需的卸载/未保存处理，不吞全局错误。禁止对整个应用 suppress 403。
5. 主题继续使用 misc.theme、switchTheme 和既有系统主题监听；语言继续使用 init.ts 的
   偏好、动态语言分块和 design-system locale。壳层只复用无业务请求的宿主偏好控件或最小
   通用控件，不复制翻译表。保持 ExtensionPage context 的主题/语言更新和 ShadowRoot 隔离。
6. 拒绝页保留突出拒绝原因及真实退出换号入口；增加可选的通用获准扩展链接列表，以使
   登录默认落到普通页面而 configs 拒绝时仍可点击进入恢复入口。列表按 main 认证 manifest
   和 capability 过滤，不解析 needsReconciliation 或任何插件模型，不要求用户先手改 URL。
   零授权列表为空；发现失败不得阻断原拒绝页和退出，不显示不可获准的业务入口。

宿主不解析 rbac、project、scope、reconciliation 等业务路径或字段，不放宽 configs、
METADATA、扩展业务 API、匿名规则或 CSRF；不按恢复状态改变服务器授权。模块和 API
每次请求仍经真实过滤器；capability 只是 UI 装载条件，不授予 API 操作权限。

### 实施与验证边界

独立 overlay clone 新增 `patches/webserver/0368-*.patch` 并更新所属现有机制文档。
主控追加授权按既有来源归属重新生成 0132/0220/0300/0310/0340，仅演进原通用激活点。
0368 承载独立 helper、壳层与宿主最小 probe；使用本任务独占源码/验证树，沿 BASE
逐项需求提交生成全部 patch，禁止手写 hunk。测试不得读取真实
插件源码作为构建输入。不得修改正式 overlay、root tracked 文件、plugin、CI 或 manifest。
未登记 manifest 的结构门预期不通过，必须如实报告；正式集成登记由主控另行处理。

| 检查 | 必需断言 |
|---|---|
| 宿主独立最小 provider/probe | EXTENSION READ/UPDATE 可允许且 METADATA/configs 拒绝；资源授权、认证、CSRF 不变 |
| 壳层实际挂载 | direct/refresh/SPA 都挂载目标；准入的一次 configs 尝试后无 feeds、业务搜索等壳层附带请求；App watcher 不补发 configs；route teleport 目标必须先挂载 |
| 普通导航回归 | 扩展到普通页面仍请求 configs，403 仍拒绝；有 METADATA 时普通页面仍完整初始化；拒绝页可返回获准扩展 |
| 拒绝矩阵 | 零授权、未认证、缺 provider、未知 extension、恶意/编码 ID、错误 tenant、manifest/capability 403/401/500/超时/错误版本均不 mount |
| 生命周期 | navigation 竞态取消、撤权后再次进入、模块/资源缺失错误；离开卸载，不复用旧允许 |
| 偏好和界面 | light/dark/dark-2/system、语言切换/刷新/页面切换、窄屏、键盘焦点与错误可读；实际动态语言资源成功 |
| 安全与副作用 | 真实安全过滤下允许 probe 写入、未授权/CSRF 写拒绝且 probe 存储不变；业务 configs/API 仍拒绝 |
| 来源与重放 | 39+0368 完整顺序重放，git apply --numstat 可解析，重放源码与需求提交树一致，定向前端与宿主测试记录失败/跳过 |

浏览器只使用宿主自有最小 probe；真实插件恢复、完整候选审核及保存由主控在正式宿主
发布后的组合环境复验。2026-10-18 候选源码本地前端 58 项、真实 EmbeddedServer/filter
宿主定向测试 8 项通过，无跳过。40 patch 使用未改 provenance 算法通过，干净 BASE 顺序
重放通过；实际检查与来源记录在本任务独占树。浏览器已发现并修复 fallback teleport
挂载顺序缺口；Vite 自有 HTTP 响应程序检查与真实宿主过滤测试分别记录，不能合称正式镜像验收。
结构脚本因未登记 0368 manifest 行仍失败一项；正式登记、CI、发布与真实组合验收均未完成。
复用已有依赖缓存，不复制 node_modules/fatjar，不删除旧 .work，不修改或 reset 主控编译树。

### 主控本地复验

最终 40 个补丁通过原版结构门和干净 BASE 顺序重放；重放 tree 与需求 tree 均为
`9377f8326dfebfefe99b06752ec37c058fd47bde`。宿主定向 283 项中 281 项通过，
两项既有外部环境探针跳过，必需报告门无失败或跳过。前端 58 项、生产 UI 构建与
executableJar 通过。主控 ego-browser 的宿主自有 UI 探针验证 light、dark、dark-2、
system 主题及 KsSelect wrapper 的可见键盘焦点；该探针后端为自有响应程序，真实
HTTP 安全过滤由独立宿主测试验证。正式镜像和真实插件组合仍须后续 CI 与部署验收。

### 兼容与升级影响

不新增公开服务端端点、不修改 V1 DTO 或 Java 二进制签名。已获准扩展仍消费同一 ESM
context；没有扩展的普通页面保持原门。仅 configs 拒绝但扩展获准的视图使用专用壳层，属于有意的布局变化，
不能把隐藏完整业务菜单表述为完整宿主 UI 兼容。恢复完毕后用户通过明确宿主导航回到
完整界面，configs 仍需其实际授权。无 capabilityPath 的既有描述继续由 manifest 授权。

上游升级必须重新核对 main.ts 守卫、App watcher、route/layout、偏好控件和 init 依赖图；
以探针证明壳层不隐含 configs 请求。上游提供等价的已认证扩展独立初始化和壳层后可移除
0368。正式发布仍由主控执行；本任务不提交、推送、发布正式仓或取消既有 CI。

## MCP 异步可信来源修复（2026-10-18，已接收、未发布）

消费项目为 `kestra-plugin-rbac`。基线 overlay 为
`8279e82e2ad9b4bbaaca2d181f2eab8e19930cf2`，BASE 为
`172dd0f3760fb1255d3b22bd1fd07ce31b173fa3`。部署验收的安全诊断显示允许工具调用
在等待执行完成后的新输出评估失败：`OidcTrustedIdentity.current:36` 缺少 HTTP 来源，
调用链包含 `AuthorizationEvaluations.lambda$boundary$0:80` 和 `MonoTakeLastOne`。
REST 56 项和 MCP 9 项拒绝／撤权通过是消费方提供的归因证据，本次宿主测试不代替其复测。

现有 `AuthorizationInvocationContext` 已支持短期 HTTP 来源；无需新增身份 SPI 或插件
模型。0170 的同次工具 publisher 仅保留 `PropagatedContext.empty().plus(origin)`，
不复制 JDBC 事务、旧评估或查询上下文。`ReactivePropagation.propagate` 恢复订阅与
回调线程的来源；runtime flow 和执行事件等待流分别在异步边界包裹它。
`ReactorPropagation.addPropagatedContext` 经 `contextWrite` 提供同一最小 Reactor 上下文。
仅写 Reactor context 不能保证 `OidcTrustedIdentity.current()` 的线程读取取得来源。

来源只限当前已认证 HTTP 请求的同次 publisher 生命周期，不写入队列或 MCP session。
transport `userId` 仅用于主体一致性检查，不能建立认证。无来源或不同主体失败关闭。
提交和 runtime 评估结束后仍关闭原句柄；等待期间不持有评估句柄。输出读取新建评估，
重新调用 `OidcTrustedIdentity` 在线核对账号认证版本及项目 epoch。晚到撤权拒绝且不读输出存储。
关闭新模式保留 V1 行为；新增传播不扩大任何 scope、角色或目录授权。

宿主独立探针 `McpAsyncIdentityContextTest` 使用宿主最小 V2 provider、真实
`OidcTrustedIdentity` 和独立执行事件线程，覆盖输出允许、等待期间 epoch／账号撤权、
无来源及主体错配、每个句柄恰好关闭一次、测试 JDBC marker 和旧评估不传播。
新增五项、既有 V1 生命周期三项和可信身份四项均通过，无失败或跳过。
主控最终定向矩阵共 278 项，276 项通过，两个既有外部环境探针跳过；必需应用项目
及类型化授权报告数量门全部通过，无失败或跳过。外部环境探针由镜像验收另行覆盖，
不得将这两个跳过项计为本地通过。
源码需求提交与 format-patch 已核对；0170 来源为 `7618b5b`，0366 来源为 `c23b2df`。
新测试已加入定向 CI 与报告数量检查，要求五项全部执行且无失败或跳过。
主控负责正式 CI、镜像发布、插件重新固定正式产物及允许／拒绝／撤权组合验收。
差异表 R-EE-RBAC 与机制文档的既有授权来源职责不变；需要同步的发布状态由主控处理。

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

本节限定宿主业务实现范围。2026-10-15 新需求中的用户、角色和授权管理属于独立插件，
不受本节历史产品非目标排除；宿主新增机制仍须单独接收。候选范围见本文末的管理页面提案。

| 不做 | 理由 |
|---|---|
| 在宿主实现用户/组/服务账号/角色/绑定业务 CRUD 与页面 | 业务功能归独立扩展；OIDC 账号目录机制按所属能力单独接收 |
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


### REQ-0310：拒绝页的视觉与主题兼容

`/ui/access-denied` 使用宿主语义颜色变量，兼容所消费宿主版本的全部主题选择。
页面突出拒绝原因与退出换号入口，移除 K 字母标志、对应样式和多余间距；清除内容区
继承的最小高度，避免短页面出现多余滚动。此调整不改变身份、授权、会话撤销或 cookie
清除行为。认证页面的主题选择、独立登录页实现与宿主浏览器矩阵统一见
[r-oidc-server.md 的认证页面主题兼容要求](r-oidc-server.md#认证页面主题兼容req-0132--req-0310)。

部署仓仍须通过生产登录验证零授权账号的拒绝页面、退出与换号，并检查所选主题下的
实际显示。源码和发布状态以对应提交、CI 与部署仓验收为准，本节不作为已部署证据。

## 管理页面公开扩展契约（2026-10-15）

**状态：REQ-0340 的基础契约已正式发布（2026-10-15）。** 宿主 `8d46953` 的
CI `38732224758` 全部通过并推广镜像
`sha256:f2b2cb7fc3bb3286148dbdce8a5e6bc70c59e152e74a3d42079e26cd0c169253`。
下载报告核对两阶段各 6 项页面检查、26 项主题检查、52 项语言检查均通过。
真实插件组合随后发现浏览器标题仍保留上一页面；本次修复复用宿主 `useRouteContext`，
不增加扩展业务契约，新增标题断言纳入同一浏览器检查。该修复仍须对应提交的 CI。
消费项目为 `ai-specs/kestra-plugin-rbac`。本契约只
定义通用 UI 装载与上下文机制，不在宿主实现用户、角色、grant 或绑定页面。现行一般 UI
patch 拒绝规则仍有效；实施前必须按入口 B 明确接收这个通用激活点的例外，不能借认证
页面的 REQ-0132 例外直接实施。主控依据独立探针接收通用激活例外，范围同步到 AGENTS.md，
不接收插件业务页面、内部组件源码依赖或任意 EE 功能。

### 用户行为与失败证据

用户挂载独立 classpath jar 后，要从管理菜单打开插件角色列表，进入详情、保存并刷新。
在固定 BASE `172dd0f37` 加当前补丁的源码中：

- `ui/src/main.ts` 直接导入 `routes/routes.ts`，`utils/init.ts` 将该表传给 createRouter。
  `override/components/useLeftMenu.ts` 生成静态菜单，IAM 项 locked，路由仍为 demo/IAM。
  因此仅挂载 bean jar 不会把新页面加入宿主路由或菜单；直接路径落入通配错误页面。
- `remoteComponents/useFederatedModule.ts` 已有模块联邦（运行时加载外部前端模块），
  但以 task type、plugin group、`plugin-ui.js` 为输入。`packages/slot-contracts/src/index.ts`
  仅有 topology details、task drawer、task modal；没有管理页面插槽或菜单注册。
- `UiController.serve` 可读取 classpath `ui/` 文件，但不存在文件会回退 SPA HTML；这不是
  页面注册协议，不能用 HTTP 200 证明插件入口已装载，也不能靠资源同名覆盖宿主页面。
- 发布镜像 `sha256:878be36bcb1a2d15266f6c7c05921f77d836136604bd956a5318671c2f34186c`
  的 executable 有 UI 静态资源，无管理页面扩展注册类型。对应 CI `38686689513` 成功；
  这只证明现有机制，未证明本候选可用。

初次源码调查：在固定 BASE 应用补丁后检查上述文件，并搜索 `registerRemotes`、
`createRouter`、`admin/iam` 与 KnownSlotsPropNames。初次只有源码证据；接收所需的
最小浏览器探针已补充如下。

补充行为证据：`scripts/rbac-ui-probe/` 在正式发布宿主运行静态测试 jar，浏览器实际
执行 ESM mount，但菜单仍无扩展入口、直接访问和刷新为 Page not found，缺失 JS 为
200 HTML。公开 design-system 独立消费也已运行：全局 styleBase 污染宿主；ShadowRoot
内单独加载样式后，在真实宿主 MCP 管理页面核对根外字体、颜色、间距不变，Inter
实际加载，三主题、表单焦点、窄屏和卸载有浏览器证据。错误及早期失败均保留。
该证据支持最小页面激活，不代表所有 vendor 弹出层、语言组件或新生产契约通过验收。

### 最小公开契约

候选以版本化 classpath 描述声明扩展 ID、相对资源根、内容 hash、模块入口、样式与
菜单标题。只注册扩展根路由及其 catch-all，详情路由由扩展自己解释，不把完整前端路由
对象搬入 Java SPI。宿主限定 `/ui/{tenant}/extensions/{extensionId}/...`，不覆盖 IAM、
认证和宿主路由，不注册假任务类型。以下方案比较用于确定最小面，尚不代表接收。

| 方案 | 依赖与升级影响 | 当前判定 |
|---|---|---|
| ESM 模块提供 mount/unmount，扩展自带 Vue 与业务 i18n | DOM 挂载、偏好数据和导航回调是稳定边界；不绑定宿主 Vue/router/store 实例，但多一份运行时和 CSS 隔离工作 | 优先以最小探针验证；验证失败再调整，不直接发布 |
| 模块联邦共享宿主 Vue/i18n | 可以复用现有 task UI 加载器，但要协商 Vue、router、i18n、组件包和单例初始化，升级耦合更大 | 不作为首选；仅有独立双版本兼容证据时重新比较 |
| iframe 独立应用 | 隔离较强，但偏好、焦点、导航、尺寸和宿主外观需额外桥接 | 首期不选 |

首选候选的模块只导出契约版本和 `mount(container, context)`，返回 `update(context)`
与 `unmount()`。宿主拥有容器、路由和订阅生命周期；扩展拥有自己的应用实例，卸载
必须清除监听、定时任务、弹出层及资源引用。重复挂载、离开时仍在加载、取消、模块
错误和未知契约版本必须有确定行为。函数签名及错误类型在接收前由探针定稿。

context 只含版本化数据：tenant、API/base URL、扩展内相对路径、locale、主题语义和
受支持语言；回调只允许扩展根内导航、订阅偏好及按公开规则发起同源 API 请求。不得
传入 Vue app、router、Pinia store、i18n 实例、Authentication、cookie 或 token。
请求桥接处理 CSRF 及公开的 401/403 语义，返回标准响应，不承诺宿主内部拦截器对象。
浏览器本来具备同源权限，桥接不是安全沙箱，服务端仍逐请求授权。

插件自带业务翻译，使用公开组件包的语言资源；复用宿主文案必须先定义有限、版本化
文案入口，不能导入内部 JSON。宿主将主题／语言变化作为 context 更新通知，插件更新
自身实例。CSS 必须限定扩展根，弹出层挂入扩展拥有的容器，不污染宿主样式。
独立 i18n 实例仍采用宿主同类 vue-i18n、语言目录、偏好与回退规则；必要的翻译检查／
生成工具必须经公开产物取得，不能复制源码或另写平行翻译表。工具发布形式和全部语言
消费验证是接收前检查项，不能只发布 locale 字符串就称国际化契约充分。

已有公开 `@kestra-io/design-system@0.5.0`，实际 npm tarball 有 dist、组件 exports、
styleBase 与语言相关入口。其存在缩小新增机制范围：优先发布宿主与该包的兼容清单，
以独立消费探针核对样式、Vue/i18n 单例和主题变量，再决定是否需要很小的适配包。
不复制宿主内部组件或翻译，不把整个 UI 工程作为扩展 SDK。宿主 workspace 的
`0.0.0-dev` 不能作为精确兼容版本；构建发布门必须生成可核对的版本／hash 对照。

静态资源只接受同源、扩展清单声明的相对路径，验证路径穿越、重复 ID、重复路由、版本、
文件存在、MIME 和内容 hash。稳定入口重新验证，hash 分块可长期缓存。清单不得接受任意
远程 URL 或可执行字符串。扩展代码具有同源脚本权限，属于部署可信 jar，不是脚本沙箱。

菜单可见性可由扩展自己提供的受保护 capability API 决定；未知／失败隐藏条目并显示
直接访问错误，不能决定 API 授权。宿主不保存角色名或调用插件业务表。资源放行仅限
必要静态目录，不扩张 `/api/**`、OIDC 目录或受保护页面匿名规则。

### 管理 API 机制的复用与限制

首期仅实例管理员管理。当前 `OssRestOperationAdapter.resolve` 对带实际 `tenant=main`
的未知控制器默认分类为 SYSTEM/EXECUTE，但这是源码行为，不能直接成为外部扩展的
稳定契约。接收前用本仓最小控制器验证并明确公开规则：怎样声明管理端点、怎样取得
可信主体、RBAC 开关与异常怎样处理。优先公开现有行为；如需声明激活点，限于控制器
管理语义，不包含角色名或 RBAC 业务对象。不能将所有未知路由扩大为可自选授权路径。

`SecurityFilter.AUTHENTICATION` 的内部 attribute 只作调查定位，正式消费方式须在公开
契约中说明。现有 `/api/.*` cookie CSRF 和认证继续复用。插件自己检查当前管理身份，
写策略时在事务内复核；不能仅靠 @Secured、菜单或 API 路径决定管理权。

当前 TypedAuthorizationGate 将异常／超时转换为 deny，TypedRestRbacFilter 返回 403。
保持这个失败关闭语义，不为本管理需求扩展全局状态码协议。只有已进入扩展控制器后
发生的业务存储故障可以由扩展返回 503；不得承诺授权数据库故障一定到达控制器。

首期不需要新增宿主 USER/ROLE/BINDING 枚举，不允许真实 RBAC 插件识别宿主
controller 或 handler。管理控制器／前端请求是插件自身 API，可自定义路径；宿主接口
适配仍留在宿主。委派管理若将来需要细分动作，重新提出类型化资源契约，不通过全局
绕过过滤器实现。首次复用前，宿主独立探针必须真实注册一个外部控制器并验证此行为。

### 兼容、异常与验收

这是新增可选机制；无扩展配置时保留原 UI。版本不符、重复 ID、资源缺失或描述非法
时拒绝该注册并报告诊断，不回退成另一个页面。模块装载失败必须显示可理解的错误并
保留宿主导航／退出。静态资源缺失返回真实 404，不能把 SPA HTML 当 JS 返回。
升级时由 overlay 适配 router/layout/主题内部变化，插件只依赖已发布版本和组件包。

宿主测试使用本仓最小 classpath 扩展：注册、菜单点击、详情、直接访问、刷新、上下文
路径、locale／主题动态变化、窄屏、404、重复／缺失／未知契约、加载失败、扩展关闭、
cookie 写 CSRF、普通用户拒绝和管理员允许。不得 checkout 真实插件仓。
部署仓再用正式发布镜像和插件 jar 验证真实 CRUD、管理拒绝无副作用、登录／退出和
与宿主管理页面一致的布局、表格、表单、按钮、错误及全部语言／主题。

裁决：接收通用页面挂载点和偏好桥接的最小范围；收窄共享组件需求为已发布包的
兼容声明；拒绝搬入业务页面、替换 EE edition、源码相邻依赖和通用动态 bean 装载。
生产实现、公开产物和组合验收仍须依次通过，接收记录不表示已发布。

主控接收 REQ-0340 的实现范围：一个通用根路由／菜单组、classpath 描述发现、清单内
资源真实 404、独立 ESM mount/update/unmount、AbortSignal 生命周期与同源请求桥接。
上下文只含 tenant、根内路径、语言、主题和必要函数，不传框架实例。扩展采用独立
ShadowRoot 及显式 styles 列表；宿主不加载业务 CSS 到 document，不改 NPM vendor 源码。
首期已验证控件只含公开按钮／输入／表格等基础控件，详情走路由、确认走页内区域。
不得以收窄范围删除原弹出层失败记录，也不承诺任意第三方组件的 ShadowRoot 兼容。

宿主同时发布可从正式 executable 取得的 UI 协议类型、支持语言与回退约定、公开组件
精确版本及独立翻译完整性检查入口，插件只消费该发布产物和 npm 包。业务翻译仍由插件
按同类 vue-i18n／语言目录提供；不用硬编码英文替代缺失语言。新接口无扩展时不改变
原业务页，未知／重复描述与缺失文件拒绝；菜单 capability 失败隐藏入口但服务端继续
授权。实现须包含独立最小扩展及原 UI 回归测试，发布后才允许真实插件编译消费。

## 授权评估边界候选提案（2026-10-15）

组合缺陷修复（2026-10-17，发布待验证）：数据库评估模式的 `tools/list` 在工具注册时
未建立评估边界，导致所有 READ 失败关闭而列表全空。0170 沿用现有激活点修复：
每个已验证本地或跨节点 session 的列表请求独立计算授权列表并直接返回，不读取缓存的
SDK 工具可见性；全部 Flow READ 共用一个短期快照。SDK 注册表只保存调用处理器，
不作为列表授权依据；`tools/call` 仍独立检查完整要求。独立 `McpDynamicToolListTest`
覆盖快照一致、新请求刷新、身份隔离、本地／跨节点 session、请求 ID 和缺组件拒绝。
此处不代表新提交 CI、协议黑盒或真实组合已通过。

**状态：REQ-0330 已随上述 `8d46953` 正式发布（2026-10-15）。** 宿主报告包含完整
REST、MCP、实际 flow 声明与生命周期检查，必需测试无失败；真实插件组合仍须独立验收。
消费项目为 `kestra-plugin-rbac`，需求是数据库
策略在线修改时，完整复合操作不能拼接来自不同策略版本的允许结果。策略表、revision、
缓存、管理员及 grant 均归消费项目，本宿主只负责操作评估的生命周期。

组合反馈（2026-10-15）：插件通过管理 API 新建仅 FLOW/READ 角色并绑定已登录账号，
读取已存在且授权的 Flow 详情得到 404，管理员同路径为 200。根因是单条 JDBC Flow 读取
复用集合查询的 READ/LIST 范围。宿主在已有 NamespaceAccessControl 增加默认兼容的
`resourceReadAllowed(resource,tenant,namespace,id)`，仅精确详情读取使用它，列表、总数和
聚合继续使用原查询域。评估模式用当前同一快照执行 SINGLE/READ，检查精确 ID 和范围；
缺身份、域外及其他 ID 继续拒绝。插件角色模型不变，不要求业务插件解析宿主查询路径。
真实 HTTP＋SQL 探针覆盖 READ-only 详情 200、列表 403、其他 ID／域外 403 和无上下文
仓库读取为空。该修复尚待新提交 CI 与组合复验。

### 可复现的机制缺口

固定 BASE 加当前补丁后，TypedRestRbacFilter 对计划中的 operation 逐个调用 gate；
RbacExecutionGate 对 READ、EXECUTE、CREATE 和额外依赖分别调用；NamespaceAccessControl
还缓存 request 内的 query scope。公开单 operation SPI 没有开始／结束评估或传入稳定
句柄。假设策略 V1 只允许 A、V2 只允许 B，在两次调用之间替换策略，逐次读取最新策略
可能允许要求 A+B 的计划，但两个版本都未授予该计划。这是新数据源需求触发的机制
缺口；现有配置策略不变时不构成已证实的线上漏洞。

本仓 `scripts/rbac-evaluation/` 已用正式发布宿主 jar 运行受控 provider：A-only 和 B-only
分别拒绝，切换后 REST、实际 flow 声明 gate、MCP execute 子门混合允许，查询缓存混用
资源版本。主控亲自复跑确认复现与预期失败；证据入口是该目录 README 和运行脚本，
不读取真实插件。这是组件级行为证据，不是 HTTP、SQL、完整 MCP 或组合通过。

主控据此接收必要的评估生命周期激活点，需求编号 REQ-0330。范围覆盖 REST 完整请求、
MCP 单次完整工具操作、实际 flow 声明检查的嵌套评估，以及必要的查询范围缓存与异步
引用传播；不增加角色、revision、数据库、worker 任务执行时授权或队列身份持久化。
只修 REST 而遗漏实际 MCP 工具链不能通过发布门。长时间执行后的输出和流式读取
另建短期读取评估，不无限延长先前允许；具体分段必须在实现测试中列明。

### 最小语义与候选形态

每个完整 REST 计划、MCP 工具计划和 runtime execution 检查拥有独立评估边界。宿主
先开始边界，全部要求及查询缓存使用同一 provider 评估句柄，结束或异常时释放。
runtime 是新的完整检查，不能沿用先前 REST/MCP 的已授权结果。已经开始的评估可以
完成；新边界必须调用 provider 取得新快照，不承诺取消已发生的副作用。

候选为可选的版本化评估生命周期 SPI：provider 在 begin 接收可信主体与来源，返回
不透明句柄，宿主将其传给边界内的单次决策和依赖检查，finally/取消时 close。宿主
不解释句柄，不保存策略 revision；无扩展时保持静态 provider 的现有行为。启用需要
动态一致性的 provider 时，缺生命周期、版本不符、缺／多 provider 或异常必须拒绝，
不得悄悄退回逐 operation 模式。具体签名和兼容探测在最小探针后确定，避免增加一组
与现有 SPI 重复的业务类型。
句柄只保留不可变授权数据，不得持有 JDBC 连接或事务。开始时的读取事务立即结束，
close 负责生命周期资源，不把数据库锁持有到业务请求或队列任务完成。

只增加 List<Operation> 批量方法不能覆盖 repository 查询与动态依赖；ThreadLocal
不能跨可靠的异步边界；按 subject 全局缓存会把不同请求错误合并。因此先验证显式
句柄及必要上下文传播的最小范围，不能直接公开内部 HTTP request、JDBC 事务或完整
PropagatedContext。任务排队后不保留请求句柄，实际执行重新建立边界。

允许开工的条件是：探针复现混合版本问题，评估边界的全部调用路径及释放点已列明，
公共契约版本和旧 provider 兼容规则已明确，差异表与机制同步接收。移除条件为上游
提供等价完整评估生命周期及安全上下文传播；不按插件阶段编号绑定移除条件。

实施契约以版本化 provider.begin(principal, tenant) 返回不透明评估对象为起点，评估对象
消费现有 Operation/Decision 并提供异步 close。显式开关启用一致模式；旧接口保持二进制
兼容且默认不变，新模式缺组件／多组件／begin 失败必须拒绝，不能回退逐 operation。
主体完整属性、tenant 与嵌套边界必须校验；释放由宿主唯一所有者负责，晚到 begin 也要
释放。独立模型已有完成／异常／取消及故障探针；生产必须重新证明这些语义，不把模型
通过当作宿主接入通过。该接收不改变一般 UI patch 禁令或批准目录业务实现。

首版接口名为 AuthorizationEvaluationProviderV1 与 AuthorizationEvaluationV1；begin、
authorize 和 close 均返回 CompletionStage。配置 `kestra.rbac.evaluation.enabled`
默认 false，开启要求统一 RBAC 与 typed 同时开启。评估中缺少上下文不得推断成内部
全域；内部可信调用沿用现有显式标记，不把 HTTP 句柄传播到后台。begin／决策故障和
超时在副作用前拒绝；close 失败记录诊断且不可把拒绝改成允许，响应结束后不能声称
回滚已发生副作用。晚到 begin 继续由原所有者清理，不重试清理或复用已关闭句柄。

宿主独立检查必须包括版本切换 A+B 拒绝、同句柄完成、下个边界重新 begin、查询域
一致、异步传播、异常／超时／取消 close、嵌套执行边界、旧静态 provider 回归和组件
缺失拒绝。部署仓再验证真实数据库修改、两个 JVM、REST/MCP/runtime、新请求撤权、
查询总数与无拒绝副作用。两者都不能用插件单元测试替代。

### UI 项目 scope 选择器（已接收）

`kestra:project-scopes` 是显式 protocol scope，只允许目录登记的第一方 UI client 使用。它展开为该 client 的获批项目 scopes，再与 subject assignment、项目启用状态和用户 consent 求交；selector 不属于 projectScopes，不含本地权限。普通/DCR client 逐名申请实际 scope。未授予请求为 `invalid_scope`；无 assignment 账号可以登录但保持业务零授权。每个实际 project scope 仍必须独立包含完整 ResourceIntent，不因 selector 改变完整权限语义。

### REQ-0362 扩展资源通用授权与 MCP tools/list 失败证据

主控核实 `0340` 的 `UiExtensionController.managementAllowed` 以空 scopes 的 `SYSTEM.EXECUTE` 构造主体，`OssRestOperationAdapter` 默认行政分支也将扩展 API 按 SYSTEM 处理。这不能区分 IDENTITY/LOCAL_POLICY 管理，也会阻断目录 epoch 过期后的本地绑定重新确认。最小宿主修正是通用 `TypedAuthorization.Resource.EXTENSION`：resourceId 为已注册 extensionId；资源发现、装载和只读 API 使用 READ，已注册扩展写 API 使用 UPDATE。路径归宿主适配器和 registry，不加入 RBAC 业务模型。未知 extension、非注册 ID 或不匹配前缀必须拒绝；认证和 CSRF 继续由宿主处理。

manifest 每个 descriptor 单独评估 EXTENSION.READ；扩展 provider 决定其可见性，页面可读不授 API 写权，Controller 仍细分 IDENTITY/LOCAL_POLICY。普通业务无管理意图不暴露页面或资源。旧模式保留失败关闭；新增资源枚举不能放宽旧 provider。应用项目模式的 V2 trusted identity 必须贯通该门。

最新组合证据：根仓 `1cef9d2`、CI `39026951944` 使用正式 overlay digest `1b044df…`。日志先显示 `RBAC COMPOSE ENABLED ALL GREEN`；随后 missing-jar 阶段 `scripts/blackbox-rbac.mjs:287` 失败：REST reader/writer 缺 jar 均 403，writer MCP initialize 200 后 `tools/list` 返回 500。该失败与旧 digest `144de64` 的 reader per-resource 过滤断言失败不同；不能归因正常 provider 列表仍 500，也不得删除断言或只重跑。修复必须保留 fail-closed，将缺组件/授权拒绝转换为稳定 MCP 响应并核对无副作用，同时回归启用正常模式的动态 tools/list 与 tools/call。

### 管理域范围修正（主控冻结）

`IDENTITY` 管理意图是内置 issuer 下的共享身份目录范围，适用于项目创建、scope、成员 client 和 subject 授予；它不授予本地策略或业务实例权限。`LOCAL_POLICY` 与 `BUSINESS_INSTANCE` 才按 project/tenant 范围解释。三域的 `READ` 与 `MANAGE` 必须显式声明，不能按 scope 名称、subject 或 `admin` 字符推断。


### LOCAL_POLICY 显式目标项目（主控接收，实施中、未发布）

消费项目为 `kestra-plugin-rbac`。已核实的失败路径是：唯一 UI client 只属于控制台项目，
`IDENTITY.MANAGE` 可以创建其他应用项目，但原 `LOCAL_POLICY` 只覆盖控制台项目，
无法从同一正式管理页面为新项目建立本地绑定。已有 client membership、selector 和
callback 不提供项目切换；不增加多项目 client，不使用 subject 旁路或隐式全域。

最小公开变更是在 `ApplicationDirectoryV1.ManagementIntent` 增加 `projectIds` 精确集合，
仅 `LOCAL_POLICY` 可以使用非空集合。空集合明确指向该 scope 所属项目，不表示全部。
非空集合只指向列出的项目 ID，不额外包含所属项目；不支持通配、名称推断或跨 issuer。
ID 使用既定项目 ID 语法，管理写入必须验证目标项目存在。创建目标项目后，身份管理员必须创建带新稳定标识的管理 scope，显式列出新目标，
不得扩大既有 scope 的 projectIds 或其他授权语义。先由当前控制台管理 scope 完成本地
完整恢复并增加新 scope 的独立绑定，再显式批准 UI member 和 subject 授予。每次目录
mutation 推进 epoch 后必须重新登录；旧 refresh token 不能用来恢复。取得新 scope 后
完整恢复控制台目录 revision，再创建新目标的本地绑定。共享上界不能自动扩大旧本地 grants。`IDENTITY` 继续是精确 issuer 下的共享身份目录；`BUSINESS_INSTANCE`
仍只覆盖所属项目和 main tenant。三域互不包含，普通业务权限保持逐 scope 完整授权。

插件本地 `managementGrants.projectIds` 采用相同空集合语义，必须被同 scope 的共享
管理意图覆盖。正常管理 API 必须将路径中的目标项目 ID 交给管理授权器；授权器不得
只验证登录项目。首版没有未声明目标的项目创建本地绑定权。请求目标存在与否不能把
一次拒绝变成允许。恢复过期本地绑定时，当前可信管理 scope 必须继续被最新共享上界
覆盖；只恢复明确获准目标项目的完整本地绑定，不开放身份 CRUD 或普通业务资源。

旧两参数 Java 构造保留并等价于空集合；已发布前不得消费新字段。宿主测试覆盖空集合、
精确目标、无效或未知目标、其他管理域非法目标和 epoch 撤权；插件测试覆盖本地扩大、
跨 scope 拼接管理动作与目标、错误 issuer、错误目标及同名 scope 跨项目。
部署验收必须通过真实 UI 完成“创建目标项目、显式授权目标、本地绑定、保存刷新、
未获准项目拒绝”，并检查拒绝写入无副作用。此节不代表生产链或正式发布已经通过。


### 身份目录的不可变授权上界快照（主控接收，实施中、未发布）

消费插件保存和评估时需要同一目录修订的项目、scope 上界及管理可达性。现有逐个
`project/scopes/clients/assignments` 调用各开事务，不能保证同一修订；插件不能读取
宿主内部 `ProjectDirectoryState` 或 IdP 数据表来拼接快照。最小公开读取为
`ApplicationDirectoryV1.policyBoundaries()`，在一个短事务内返回不可变的
`PolicyBoundary` 列表。每项含 project、scopes、audiences、reachableManagementScopes、
protocolScopes。project 包含 revision 与 authorizationVersion；audiences 是该项目
获批有效 client 的精确受众并集，不是通配。reachableManagementScopes 只列仍有真实
active subject 授予且至少有该 subject 可登录的有效获批 client 的 scope；不返回凭据、
subject 名单或用户资料，不评估插件本地 grants。snapshot 不保留连接，不跨请求缓存。

该读取是可信 classpath 扩展的身份目录投影，不提供 HTTP 匿名端点，不授予身份 CRUD。
插件负责按当前管理域和目标项目限制 HTTP 投影，仅把目标 project/scopes 返回恢复页。
插件可以据此验证最后本地管理员：在最新同一快照上，至少有一个完整 scope 同时具有
共享与本地 LOCAL_POLICY.MANAGE、覆盖实际目标且仍可达；不得把一个 scope 的动作与
另一个 scope 的可达性拼接。目录错误、损坏或缺项目失败关闭。身份变更仍先提交 epoch，
本地评估检查版本，跨仓不能原子提交的迁移保持明确失败关闭。

旧公开方法保留兼容；新列表和集合必须不可变、唯一且有上限。宿主测试证明事务一致、
真实 active/owner/firstPartyUi 可达性、关闭功能可读 schema、异常与损坏拒绝。插件在
正式产物发布后消费，不得用内部目录对象或未发布 jar 提前编译。


### 目录修订与撤权 epoch（候选实现，未发布）

`TrustedIdentityV1.directoryRevision` 等于同一目录快照的 `Project.revision`，表示
管理授权所确认的目录修订。`authorizationVersion` 等于 `Project.authorizationVersion`，
表示 token/session 的撤权 epoch。两者是独立概念；即使常规写入同时递增，也不得互换。
独立宿主探针使用 revision=19、epoch=7，分别核对输出；旧 epoch、未知 scope、错误
UI audience 和无请求上下文必须拒绝。MCP 当前请求优先消费 Bearer filter 建立的
认证属性，不能从环境中的 UI cookie 取得另一主体。

`protocolScopes()` 当前是固定标准项与启动配置生成的不可变词汇表，不是数据库中的
动态目录。多次读取不改变目录修订。未来若允许动态修改，必须将它纳入同一修订快照；
当前候选不承诺动态修改。身份目录故障或身份核对不匹配继续失败关闭。

### 应用项目宿主发布状态（2026-10-18）

上述应用项目机制及目录迁移数据源修正已在 `4b017f6` 的正式 CI
[39087229293](https://github.com/ai-specs/kestra-overlay/actions/runs/39087229293) 通过，
镜像已推广为 `sha256:ba19764bf232306e6501c5226af015d3e18d006da75a4e96a55c6baecee457af`。
先前段落中的“候选／未发布”描述提案与实施时状态；本条只确认指定提交的宿主公开机制、
镜像级 MCP/OIDC/浏览器检查和发布，不确认独立插件业务、完整迁移或 Compose 组合。
使用契约与范围以 README 的应用项目章节为准；后续提交须检查自身 CI，不沿用此记录。

### REQ-0365 MCP 调用异常安全诊断（主控接收，本地候选，未发布）

消费项目为 `ai-specs/kestra-plugin-rbac`。2026-10-18 部署仓使用宿主 `d63518c`
及插件 `9715def` 执行真实组合验收：56 项 REST 检查通过，但 security 的
`wrong-project` 允许基线在 `main-tool-call-response` 返回 HTTP 200，JSON-RPC
result 为 `isError:true`、`Failed to execute flow`。这只能证明工具调用链进入异常
fallback，不能证明插件拒绝，也不能据此修改授权。原始证据入口为部署仓本轮
`ego-progress.json` 指向报告中的该 check/step；报告不得包含凭据。

现有 `McpToolService` 最终 `onErrorReturn` 静默替换异常；输入拒绝的 DEBUG 日志和
协议错误映射均不能说明该异常的来源。Logback formatter 会渲染传入的 Throwable，
直接记录异常可能泄露 message、cause 或 suppressed 中的秘密。按既有 R-EE-RBAC
的 MCP 执行激活点缺陷接收最小诊断，不增加 SPI、配置或响应字段。

0170 在原最终异常 fallback 前调用独立安全诊断 helper；0365 只新增 helper 和测试，
发送 WARN 事件 `MCP_TOOL_CALL_FAILED`，记录异常类名及最多 12 个 class/method/line
栈位置。符号限定字符集和长度，不记录
异常 message、Throwable、cause、suppressed、文件名、请求参数、token、输入输出、
Flow 全文或身份。不插入阶段状态，不包装或重构调用链；诊断保持现有授权、队列和通用响应。
宿主负责事件生成与脱敏；插件负责业务策略，部署仓负责真实调用和最终根因裁决。

兼容性不改变公开 Java 契约、MCP schema 或开关。升级时只适配最终异常 fallback 激活点；
上游提供等价安全诊断后移除补丁。异常继续失败关闭，拒绝不增加权限。
宿主独立测试通过完整 handler 注入带恶意 message/cause/suppressed/文件名的异常，
使用真实 Logback formatter 检查事件可定位且秘密不输出，并核对原响应不变。
本地检查不代表 CI 或镜像已发布。正式宿主发布后，部署仓必须重跑允许调用、拒绝分类
和无副作用检查，用实际诊断定位异常；不得把新增诊断本身计为业务修复。

主控已拒绝插入阶段状态的旧候选，收窄为维护 0170 原激活点并新增独立 helper。
旧候选只作为失败检查证据保留，不作为当前实现或发布输入。当前两个补丁必须由各自
真实需求提交生成，并在干净 BASE 上顺序重放及通过结构门；不得豁免重叠规则。

2026-10-18 收窄候选本地检查：诊断、MCP 评估生命周期和执行门共 5 项定向测试通过，
无失败或跳过；结构门无跨补丁重叠，37 个补丁从固定 BASE 顺序应用成功。
相对 `d63518c` 的实际宿主源码只改变最终 fallback 的诊断调用并新增 helper/测试。
这些结果不代表正式 CI、镜像发布或真实 MCP 执行通过。
