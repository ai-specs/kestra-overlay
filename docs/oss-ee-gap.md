# OSS vs EE 架构能力差异表（kestra-overlay 立身依据）

2026-10-28 接收公开账号空资料修复，归属 R-OIDC-SERVER 的0350/0381目录适配。
消费插件正式组合清空姓名/邮箱返回400；V2临时创建也会编造默认资料。最小修复允许
合法空资料并保留V1 create默认行为、字段边界、CAS和认证状态，不加入插件业务。
真实PG红测已复现；本地完整local-ci后端368项中366通过、2项镜像专用前置跳过，
UI87项通过。新镜像classpath、OIDC35、四份MCP专项及form/env各22/7/26/52/215/14
既有矩阵与新增profile26项通过。正式消费仍须对应提交CI及正式镜像推广成功，
不以本地门声称插件HTTP或根仓实际UI组合通过。
提案、兼容与拒绝语义见r-oidc-server.md空资料节，不能以历史绿色替代新输入。

2026-10-28 接收首次改密协议分类遗漏的最小修复，归属 R-OIDC-SERVER 与 R-EE-RBAC。
正式组合的临时密码登录 303 后 GET 401 已由宿主独立 RBAC+typed HTTP 红测复现。
0230 仅识别实际改密控制器的精确路径、方法与 handler；0381 增强授权启用及无副作用
回归。没有组业务、公开类型或 SDK 变化。正式消费以对应提交全部 CI 和镜像推广成功为条件，必需门和兼容边界见
`r-oidc-server.md` 的首次改密 RBAC 激活点节；不沿用旧 RBAC 关闭镜像门证明修复。
完整 local-ci 与恢复后新镜像的 classpath、OIDC、MCP、两种首装及各 14 项 RBAC 改密门
已通过；历史 Docker 只读失败未计通过。既有镜像或宿主本地成功不证明部署组合通过。

当前0384公开输入为2f2984a/b57b59a8，13文件，UI一致性总门87项。四原生组件经
helper的有条件支持声明与内置README一致；helper/runtime未改。新输入必须独立完成
构建、镜像与双工具同949，实际发布仍以对应提交CI及推广为准。

0384仅提供通用独立扩展原生弹层/筛选的最小ShadowRoot兼容及导航激活机制，不扩大
业务归属。历史11文件69e11808/build02d12978的完整本地门、镜像及双工具同949已通过，
后续元数据修订按新hash重验；消费以对应提交CI和镜像推广成功为条件，不能沿用旧输入。

0380–0383的44补丁已在64c4498通过正式CI40523539018并推广bebf7a7c...177a22e。
该正式版本不含后续SDK扩容。以下带日期的早期调查是历史记录，不将其未运行状态
当作当前发布状态，也不得据宿主机制发布宣称独立插件或部署组合已交付。

## 账号与凭据扩展（64c4498已发布）

消费项目 `kestra-plugin-rbac`：V1 无账号删除/临时密码，内部 client 更新无公开凭据
修订和维护流程。复用 S6/S8、公开安全锁和借用连接 guard，接收最小标准身份机制，
不接收组 CRUD、授予存储或最后管理员业务。完整提案和独立/组合门见
`r-oidc-server.md` 的 REQ-0380–0382。R24/R25 为主控裁决、维护者可以复核设计。

| rid | 最小机制 | 当前状态 |
|---|---|---|
| REQ-0380 | 同连接可信 actor、账号删除与通用事务参与者 | 64c4498正式CI与镜像推广通过；插件业务及组合另验 |
| REQ-0381 | 宿主临时密码及受限首次改密生产流程 | 64c4498正式CI及两种首装强改密码镜像门通过 |
| REQ-0382 | client 凭据状态/轮换、登录 client 维护 CLI、普通 confidential 维护登记 | 64c4498正式CI、真实CLI/PG/HTTP及镜像门通过 |
| REQ-0383 | V2 资源 audience 可为空且与登录 audience 分离；V1 语义不变 | 64c4498正式CI与推广通过；V1语义保留，旧凭据不扩权 |

0383 的最小机制属于 S6/S8 与 R-OIDC-SERVER，不接收组业务模型。V2 的资源空集不补
clientId、不表示全域；ID/UI 与无 resource 标准 access 保持精确 clientId，有 resource
及 MCP 保持精确资源。V1/V2 切换拒绝旧组凭据，必须重新生产登录，不静改 V1 或扩权。
公开 DTO、版本门、拒绝副作用和兼容限制见 `r-oidc-server.md` REQ-0383。

> **最新职责纠正（2026-10-22）**：应用组、scope、支持、用户授予及内置/退役存储属于插件业务。旧宿主可写目录、组业务实现、组 CLI 和组表迁移已从当前候选移除；账号/client生命周期已接入同连接guard。pending登记只读查询及consent预览与最终签发已分开。40补丁重放、57份相关主源码、源码职责门及58项进程内检查通过，20项PostgreSQL仅源码编译。完整构建、网络HTTP/浏览器与发布未通过。当前状态和后续必须门见 `docs/r-oidc-server.md`，下方带日期的旧候选记录不代表当前源码或发布状态。

REQ-0370 接收只读协议投影、事务内标准账号/client/安装状态查询与生命周期 guard。候选已有公开类型和标准查询/事务锁实现，不引入组业务表。42补丁重放、65份相关源码编译及新增11项进程内契约/查询探针通过；真正协议激活和 PostgreSQL 并发尚未通过。发布构建已增加职责边界门，当前重放树仍因旧组业务及调用点被拒绝，不能发布。机制归因、接口清单与剩余测试见同一职责纠正提案。

2026-10-22：签发与可信身份路径已接入只读投影，移除这两个路径中的宿主组目录/组表/首方成员依赖。新增授权与当前身份及异步撤权共25项进程内探针通过；真实 PostgreSQL 的12项签发/协议集成仅源码编译。旧业务目录及账号/client生命周期路径尚未迁移，正式构建职责门仍失败，未发布。

> **删除后的撤权隔离（2026-10-21，候选）**：REQ-0363 在目录事务内持久登记退役组 ID，创建不得复用，以避免新组版本重新匹配旧凭据。公开创建/更新方法同步应用组名称。重放、源码编译及纯契约测试通过，新增 PostgreSQL 持久化/并发探针尚未运行；证据与正式交付限制见 `docs/r-oidc-server.md`。

> **应用组命名候选（2026-10-21）**：目录类型、可信组字段、scope key、目录快照/安装计划及持久化组表已进入统一命名候选；旧字段不兼容。41 个补丁重放、60 份主源码编译和 16 项纯契约测试通过，不等于数据库、完整 CI 或正式发布。边界与证据见 `docs/r-oidc-server.md`，独立扩展必须等待正式镜像。

> **应用组目录候选更新（2026-10-21）**：REQ-0360/0363 接收显式内置组 ID、审批绑定和安装记录外键，以及拒绝内置删除、精确版本与空组约束。补丁已实现候选并从固定 BASE 重放；计划 4 项及源码编译通过。PostgreSQL、并发、完整本地 CI 和正式镜像发布尚未执行，不沿用先前候选的绿色结果。机制和测试边界见 `docs/r-oidc-server.md`，文件数及归属见 `patches/manifest.tsv`。

> **最新规划裁定**：MCP 认证面重新接收，目标 OAuth2-only + 用户归属动态 client；
> public DCR pending 经用户确认后绑定 owner，token 与资源执行身份一致，不共享
> 动态 client。0150–0190 已交付用户归属、授权与资源认证；具体数据隔离仍须外部 RBAC。契约见
> [mcp-oauth-integration.md](mcp-oauth-integration.md)；旧 MCP 除外记述是历史范围。

> 本表回答「补什么」。「怎么生效」见 `docs/extension-mechanisms.md`。
>
> 使命：立足 BASE pin 的上游 release，补足 OSS 相对 EE 故意阉割的**架构扩展能力**。
> 只补能力骨架。不复刻 EE 商业件（审计日志、Kafka 队列等）。
>
> 每个补足决策（patch / 扩展仓 / reserved / 不补足）以此表为准。
> BASE 升级后必须复扫（命令集在 §5）。
>
> 证据分级：`[src]` = BASE（v2.0.5 @ 172dd0f37）源码；`[docs]` = kestra.io 文档；
> `[dsh]` = dsh 项目实证；`[live]` = 本地 vanilla 实例实测。
>
> **当前范围（2026-10-07 收窄裁定）**：两项——
> 1. kestra-oidc-provider，含后续重新接收的 MCP 认证/能力契约面；
> 2. R-EE-RBAC（docs/r-ee-rbac.md）。
>
> 2026-10-18 已接收、未发布：0367 修复框架 OAuth 授权错误被通用控制器处理为 500。
> 内部专用处理器复用 state 校验并使用固定同源失败页；不新增插件 SPI。
> 消费失败与独立检查要求见 `docs/r-oidc-server.md`。
>
> REQ-0368 已接收、未发布：扩展发现委派逐描述授权，扩展获准而业务配置拒绝时使用
> 通用独立壳层。普通页面与 configs 权限不变，见 `docs/r-ee-rbac.md`。
> REQ-0369 已接收、未发布：补齐离开偏好页后的全局系统主题监听，扩展继续消费宿主主题。
>
> **基本原则**：扩展点/占位的充分性由上游架构与机制推导，不依赖外部实现时序
> （AGENTS.md §0·基本原则）。
> 裁定全文与重启规则见 `AGENTS.md` §0。其余域的历史调查存 git 历史。

> **当前认证裁定（2026-10-09，维护者）**：OIDC 模式完整关闭 Basic Auth 链，
> 前端必须消费 OIDC 认证状态并统一登录/退出。允许 R-OIDC-SERVER 最小 UI 认证
> patch（REQ-0132），不伪造 Basic Auth 标志。此前首轮浏览器链全绿不代表刷新与
> 导航已验收；实施与完整测试契约见 docs/r-oidc-server.md §0。
> REQ-0132 已实现 UI 独立 OIDC 认证状态（服务端 configs 验证）、统一 401/退出、
> 旧认证端点拒绝；新增前端定向用例、后端禁用用例与黑盒刷新/导航/退出断言。
> 新版本 DoD 仍以本地重放与对应新 CI 全绿为准。
> REQ-0133 已交付：首次安装引导/环境变量一次性初始化 OIDC 用户与 UI client，
> 属 R-OIDC-SERVER 认证基础设施；实现与安全验收契约先写入 r-oidc-server.md §0。
> REQ-0133 已实现：网页引导/环境变量初始化共用事务，自动注册 UI client，完成状态
> 持久化；本地空库两路径与浏览器首装登录实测通过，最终以对应新 CI 为准。
> 维护者追加再审：单个数据库标记不足以防删除攻击；安装身份绑定独立持久化凭据，
> 任一存在都不能重开，异常失败关闭。见 r-oidc-server.md §0 加固契约与恢复边界。
> REQ-0134 已交付：RFC7591 标准 public client 动态注册，支持公开 OAuth2 消费方
> （包括 MCP 客户端）无 secret + 强制 S256；仅协议基础设施，MCP 业务面仍不接收。
> 先闭合注册开关、回调校验、总量限制和同批首装全链验收，见 r-oidc-server.md §0。

> **2026-10-09 浏览器链验证**：R-OIDC-SERVER 增 REQ-0131（内置 issuer discovery
> 启动适配，外部 issuer 仍走框架 discovery）；REQ-0120/0130 修复授权回跳与 POST 后
> 303。BASE 原版 UI 必须打包。复现：`bash scripts/local-ci.sh`、
> `bash scripts/blackbox-ui-oidc.sh <image>`；后者验收 UI 拦截→框架 OAuth2 客户端→
> 内置用户名密码→PKCE 授权码→真实 token 交换→认证 UI/API。保留原协议黑盒门。

## 1. EE 的交付机制 = overlay 可用的架构缝隙（穷尽列举）

此表是机制事实（缝隙分类学），与域无关。两个活跃事项踩在 S6/S8 上。

| # | 缝隙 | v2.0.5 证据 `[src]` | 当前使用 |
|---|---|---|---|
| S1 | `@Requires(missingClasses="io.kestra.ee.…")`：EE jar 在 classpath ⇒ 其 bean 顶替 OSS bean。全仓唯一注解实例。 | `webserver/rooting/TenantAliasingRooter.java:19` | 无（分类学留档） |
| S2 | OSS 桩 bean + EE `@Replaces`（源码显式文档化的「桩—替换」对） | `core/tenant/TenantService.java:9`；`core/runners/DisabledReusableInputsExpander.java:11`；`webserver/services/ai/agent/DefaultSystemPromptResolver.java:11`；`core/services/ConcurrencyLimitResolver.java:17`；`core/services/MaintenanceService.java:89`；`core/services/NamespaceService.java:22` | 无活跃使用。R-EE-RBAC 的 Authorizer bean 即此形态 |
| S3 | `EditionProvider` 版本判定注入 | `KestraContext.java:150`；`PluginAutoInstallService.java:89`；`McpServerController.java:144`；`ProblemFactory.java:39`（全部调用点见 §5） | 无 |
| S4 | 按 distribution 声明接口 bean（「各发行版声明自己拥有的路径」） | `webserver/errors/ProblemFormatExclusion.java:12` | 无（现成范例留档） |
| S5 | `io.kestra.ee.*` 包名空间与分发过滤 | `PluginController.java:388,400,696`；`Makefile:85`；`core/models/ui/PluginDistribution.java:8` | 不使用（不分发 EE 插件） |
| S6 | classpath jar 补 bean/过滤器链（EE 的交付形态本身） | `webserver/build.gradle:25` 仅有 `micronaut-security-csrf` ⇒ 认证过滤器链不在 OSS 构建；OSS 认证=自研 `BasicAuthService` cookie `[docs]`；外部同包 `@Controller`/`@Filter` 可注册 `[dsh]`（13/13 全绿） | **授权 jar 的承载通道**：消费仓 `ai-specs/kestra-plugin-rbac`；认证链已内置 patch，不再消费外部 jar。承载 = R-CLASSPATH-MERGE（构建期仅注入 manifest 条目；jar 一律运行时挂载；缺席静默休眠）。授权服务器不走此通道——R-OIDC-SERVER 为 patch 路线预留扩展点（2026-10-07 裁定） |
| S7 | 插件体系：`plugins/` 扫描 + `PluginClassLoader`（extends URLClassLoader，反射实例化，不进 Micronaut） | `core/plugins/`（RegistryScanner 等）；`PluginClassLoader.java:19` | 无活跃插件客户（`extensions.tsv`） |
| S8 | `Optional`/`BeanProvider` 缺席容忍：EE bean 缺席 ⇒ OSS 默认行为 | `MiscController.java:72`；`DefaultStartupHook.java:25-39`；`KestraContext.java:149` | REQ-0011 依赖此模式（OIDC 部署下 BasicAuthService 缺席） |
| S9 | protected 方法覆写点（javadoc 自述「EE 覆写此方法放行」） | `KestraBeansFactory.java:112-118`；`AiServiceManager.java:115-137`；`FlowValidator.java:204`（同款 `JsonSchemaGenerator.java:170`） | 无（分类学留档：扩展仓子类 bean `@Replaces` 覆写，经 classpath jar） |

## 2. 能力差异总表（活跃范围：认证/身份 + 授权）

### A. 认证与身份（认证线）

| 能力 | OSS 行为 | EE 行为 | 补足方式 | 状态 |
|---|---|---|---|---|
| 认证方式 | 仅自研 Basic Auth（cookie）。认证过滤器链不在 OSS 构建（S6）。 | SSO OIDC + SCIM + 服务账号 `[docs]` | 认证链与授权服务器：**预留扩展点 R-OIDC-SERVER**（patch 路线，2026-10-07 裁定——协议稳定+实现标准 ⇒ 大粒度薄层；前置裁定②：链一体化进 patch，外部 IdP 场景走内置链配置）。加 REQ-0011 做 UI 引导（已实施） | 仓已立项；0011 已实施；R-OIDC-SERVER 已预留 |
| 登录引导 | `/api/v1/configs`（MiscController）只暴露 `isBasicAuthInitialized`。vanilla 实测 `edition:"OSS"` `[live]` | 同端点给出 SSO 状态 | REQ-0011：`oidcAuthEnabled` 字段 + security-enabled 视为已配置 | 已实施 |
| 用户归属 MCP OAuth2 接入 | BASE MCP route/Basic/SDK1.1.3已核验；0180关闭MCP Basic及商业占位 | 不作为方案依据 | 0150–0190 已交付owner/consent/resource Bearer/scope/管理限速；外部RBAC与数据隔离未交付 | 16 patch 重放与真实 CI 协议/浏览器/SDK 门通过；见mcp-oauth-integration.md |
| SCIM | 无（`ProblemFormatExclusion.java` javadoc 明言归 EE） | 有 `[src+docs]` | —（EE 产品功能） | 不补足 |
| 服务账号/API token | 无 | 有 `[docs]` | 机器身份走 OIDC JWT（R-EE-RBAC §3） | 不补足 |

### B. 授权与访问控制（授权线）

| 能力 | OSS 行为 | EE 行为 | 补足方式 | 状态 |
|---|---|---|---|---|
| 端点级认证门 | 无过滤器链（见 A）。OSS 主源码零授权钩子（无 SecurityRule/intercept-url-map 类，2026-10-07 复扫） | 规则链 `[docs]` | 部署面：micronaut-security `intercept-url-map`（`/**→isAuthenticated()`）。生效前提 = 认证链 jar 进镜像（R-CLASSPATH-MERGE 前置） | 部署面（kestra-oidc-provider 侧） |
| RBAC | OSS 零授权钩子。EE IAM API 面（users/roles/permissions/groups/service-accounts/me）在 vanilla 实例全部 404 `[live]` ⇒ 判定面整体在 EE jar，无可解禁开关 | 资源×动作×namespace 绑定；五内置角色；三类主体（详见 r-ee-rbac.md §2） | 扩展仓 jar 提供角色模型与策略 bean（S6）；overlay 复用 namespace/log 查询 ACL，提供 typed SPI、宿主操作适配与失败关闭激活门。0170/0366 异步来源修复已接收、未发布；不新增 SPI。需求文档：[docs/r-ee-rbac.md](r-ee-rbac.md) | **实施中** R-EE-RBAC |

## 3. 当前闭环视图

「阶段」只是优先级注记（AGENTS.md §0-3）。一切移除/触发条件形态绑定。

```
认证线（OIDC 部署形态，含新接收 MCP OAuth2-only/能力 scope 规划）：
    认证链 + 授权服务器（预留扩展点 R-OIDC-SERVER，patch 路线，内嵌 webserver——
    2026-10-07 裁定 + 前置②链一体化：外部 IdP 场景走内置链配置）
  + 登录引导（A2 = REQ-0011，唯一已实施 patch）
  + 最小端点门（B1 = 部署面 intercept-url-map，前提 = 认证链 jar 进镜像）

授权线（R-EE-RBAC，docs/r-ee-rbac.md）：
    在认证层之上叠加 (资源, 动作, namespace) 每请求判定
    交付分层与验收判据见该文档 §5/§8
```

**扩展点充分性审查（2026-10-07，按基本原则）**：两线占位**具备**，无占位缺失级缺口。
机制面占位 = reserved（R-CLASSPATH-MERGE）+ REQ-0011（已实施）+ 上游原生缝隙；
数据面占位 = `extensions.tsv` classpath 行（`kestra-rbac-authorizer.jar` = 休眠
manifest 条目；认证线无契约——前置裁定②链一体化进 R-OIDC-SERVER）。
缺口均为实施/实证级——R-CLASSPATH-MERGE 实施（承载，两线共同前置）与
OQ-RBAC 1-4（r-ee-rbac.md §9）。

## 4. reserved 登记簿（manifest.tsv 同步登记）

收回规则：只有「可能成为 overlay patch/构建面动作」的待激活点入本簿。
源码证据表明零 overlay 动作即可补足的，在 §2 记「缝隙开放」，不入本簿。
触发条件一律形态绑定。

| rid | 扩展点 | 触发条件（形态绑定） | 预期形态 |
|---|---|---|---|
| R-OIDC-SERVER | OAuth2/OIDC 授权服务器（Micronaut 生态标准实现，内嵌 webserver 形态）。**已交付：0100–0134、0150–0200、0211；真实 CI 全绿（2026-10-12）**；2026-10-07 裁定：预留扩展点（patch 路线）——协议稳定性 + 实现标准性 ⇒ 大粒度仍为薄层（新文件为主，BASE 升级冲突面小）；区别于 jar 路线的外部扩展实现；体现「overlay 先行，jar 路线跟随」模式 | 实施指令（维护者；不绑外部时序——基本原则） | patch 集（授权码流/PKCE/discovery/JWKS/token/client 与用户存储等，按 §3 需求对齐拆分）。**前置裁定（2026-10-07）**：② 链一体化进 patch（`kestra-auth-chain` 契约退役；外部 IdP 场景走内置链配置）；③ 持久化 = 同 datasource 新表（postgres 起步，migration 进 patch——源码级 MigrationScript bean，F2 自动执行；h2/mysql 留待需求）。四项前置全部闭合（2026-10-07）：① 宪章修订 ② 链一体化 ③ 新表 postgres ④ 安全清单即验收基准。**展开文档（裁定/证据/剥离清单/安全清单/实施顺序）：[docs/r-oidc-server.md](r-oidc-server.md)**；④ **测试先行门（2026-10-07 增，安全敏感裁定）**——CI 增定向测试步（`:webserver:test --tests` 包前缀过滤，不跑上游全量）+ 镜像级 OIDC 流程黑盒（discovery/授权码+PKCE/token/JWKS/refresh/MCP 动态注册）；安全专项清单（redirect_uri 精确匹配、code 一次性、PKCE、alg=none 与混淆拒绝、JWKS 轮换、secret 哈希存储与日志不泄露、匿名面最小化、vanilla 回归）动刀前先评审；每需求 patch 与其测试同批落仓、门绿为 DoD；`[dsh]` 13/13 安全面测试可作移植底稿 |

### 本阶段已激活能力（2026-10-13）

以下能力已退出 reserved 登记，镜像与消费仓组合的完成状态分别由本仓 CI 与部署
monorepo 验收确定；这里不跟踪独立扩展仓的业务实现进度。

| rid | 扩展能力 | 接收依据 | 实施形态 |
|---|---|---|---|
| R-CLASSPATH-MERGE | 通道② jar 承载机制（S6）。承载 scripts 已实施、本地 executable 冒烟通过，外部 bean 完整 server 探针通过，真实 CI 待验收；选型 b + 定位裁定 2026-10-07。JVM 语义三组实证与设计约束见机制文档 §4 | 实施指令（认证链 jar 与 R-EE-RBAC 的共同前置） | 构建期仅注入 manifest Class-Path 条目元数据（jar 一律运行时挂载——构建期零外部扩展 jar）。manifest 条目 = 镜像↔部署契约。加 OQ2 剩余实证（bean 索引可见性）。零 patch 文件 |
| R-EE-RBAC | 端点/资源级授权：消费仓 `ai-specs/kestra-plugin-rbac` 已指名，统一授权 SPI 与激活门实施中 | 缺 jar 时 REST 未受控与 MCP 主体角色丢失证据见 r-ee-rbac §11；承载为 R-CLASSPATH-MERGE | 外部 classpath jar（S6）承载业务模型和操作解析；overlay 只补 typed SPI、可信主体传递与失败关闭门。独立插件构建后由 monorepo Compose 组合验收。展开文档：[docs/r-ee-rbac.md](r-ee-rbac.md) |
| REQ-0240 | R-EE-RBAC 查询 scope 最小表达，消费仓 `kestra-plugin-rbac`；入口 B 用户生产要求 | Exact 错授子 namespace；Namespace 父级/system 合成候选进入分页与 total | 三参 AccessScope 保留二参兼容；统一 JDBC/log Exact 翻译；Namespace predicate 分页前过滤；MCP 匹配与缓存兼容。角色与后台策略归插件。上游 OSS 提供等价 Exact scope 和候选过滤时移除 |
| REQ-0300 | R-EE-RBAC 宿主 UI 与查询适配修复，消费仓 `kestra-plugin-rbac` | 登录路径缺 tenant、零授权账号无法换号、usage 使用全局报告、MCP 工具列表未分类；详见 r-ee-rbac 提案 | 复用现有 typed SPI 与 namespace ACL；规范 UI 路径和独立拒绝退出入口；usage 使用 tenant 报告，工具列表按 Flow 查询域；业务 grants 归插件，组合验收归部署仓 |
| REQ-0320 | 定制认证页国际化，消费仓 `kestra-plugin-rbac` | 独立登录页和拒绝页硬编码英文或中英混排，未消费宿主 `lang` | 复用既有 vue-i18n、语言目录、JSON 与文案键；独立登录入口只翻译表单，不启动业务应用；实际发布与组合状态见能力文档和部署仓 |

## 5. 复现命令（BASE 树内执行）

```bash
git grep -n "EditionProvider" -- '*.java' | grep -v /src/test/            # S3 全部调用点
git grep -n "io\.kestra\.ee" | grep -v /src/test/                          # S1/S5 + EE 交付痕迹
git grep -n "missingClasses" -- '*.java' | grep -v /src/test/              # S1 注解实例
git grep -in "enterprise\|EE feature" -- '*.java' | grep -v /src/test/     # 源码文档化阉割清单（全仓）
git grep -n "overrides this\|overridden by\|Enterprise.*override" -- '*.java' | grep -v /src/test/  # S9 覆写缝
grep -n "micronaut-security" webserver/build.gradle                        # S6 安全链缺席证据
```

`[live]` vanilla 实例（Basic Auth admin 会话）：

```bash
curl -s http://localhost:8080/api/v1/configs | jq .edition                  # "OSS"（真实路径无 tenant 段）
for u in users roles permissions groups service-accounts me; do
  curl -s -o /dev/null -w "%{http_code} /api/v1/$u\n" http://localhost:8080/api/v1/$u
done                                                                        # 全 404 = IAM API 面不在 OSS
```

文档源（2026-10-07 抓取）：kestra.io/docs/oss-vs-paid、…/enterprise/auth{,/rbac,/service-accounts}。
升级 BASE 后：重跑上述命令 → 更新 §1/§2 → 复审 §3 与 §4 触发条件。

## 6. 消费反馈提案与接收状态（2026-10-15，均未发布）

以下逐项记录候选与接收裁决，不能整体视为实现登记。REQ-0330 已接收最小实施范围，
实现 patch 与 manifest 同批登记；REQ-0340/0350 的接收范围也逐行列明，不表示接收任意
UI 定制或插件授权业务。所有能力仍须通过实现检查与正式发布门。

| 能力归属 | 消费者与失败行为 | 现有机制／最小候选 | 状态与裁决入口 |
|---|---|---|---|
| REQ-0340：管理页面通用激活 | 静态 jar 在发布宿主实际装载但无菜单／路由，缺资源回退 HTML；ShadowRoot 最小页面已在宿主管理页验证隔离 | 独立 ESM 根挂载／卸载、描述／资源及偏好桥接，发布语言／类型消费入口，不传框架实例；业务页留插件 | 已随 `8d46953` 通过 CI `38732224758` 并正式发布；`r-ee-rbac.md`。标题修复待新 CI，基础控件以外弹出层仍不承诺 |
| REQ-0330：完整授权评估生命周期 | 同一消费项目需要在线改策略；正式宿主组件探针已复现逐 operation 混合允许与 query cache 跨版本 | provider 不透明句柄 begin／传播／close，覆盖完整 REST/MCP/实际 flow gate 与查询边界，不包含策略表、revision 或 worker 排队后重新授权 | 已随 `8d46953` 正式发布；2026-10-17 发现 tools/list 缺边界与缓存可见性问题，0170 修复候选及独立探针已实现，CI／发布／组合待验证；见 `r-ee-rbac.md` |
| REQ-0350：公开账号目录与认证失效 | 正式宿主组件＋独立 PostgreSQL 已复现重复 create 改密码及重置保留旧 token | 目录 SPI、唯一 OIDC 适配、原子生命周期及认证版本检查；业务授权／页面留插件，无管理 HTTP 暴露面 | 已随 `8d46953` 正式发布，两种首次安装各 22 项目录 HTTP 检查通过；`r-oidc-server.md`。真实插件组合仍须验收 |
| 公开组件兼容声明 | 独立管理页需要与发布宿主一致的表格／表单 | 已取得 npm design-system 0.5.0；先验证精确兼容及发布文档，不预设新增整套 UI SDK | 基础按钮、输入、表格及样式准备工具已随 REQ-0340 发布；复杂弹出层不在兼容清单内 |

管理 CRUD 的历史宿主非目标不限制独立插件业务演进。权限细分枚举、插件策略表及策略
热更新存储均不进入宿主；首期管理员 API 优先复用认证、SYSTEM gate 与 CSRF，但外部
控制器稳定分类须先公开确认。目录不判断插件管理员，目录发布不阻塞角色／授权线路。

### REQ-APPLICATION-PROJECTS（2026-10-17，已接收，实施中）

消费项目：`ai-specs/kestra-plugin-rbac`。主控已接收窄边界：内置 issuer 单源；一个 client 只归一个项目；精确 audience 集合；项目 scope 与 protocol scope 显式分类；`ApplicationDirectoryV1`、`TrustedIdentityV1`、`AuthorizationEvaluationProviderV2`；应用开关 `kestra.rbac.application-projects.enabled`，要求 typed/evaluation 且仅 V2，禁止回退旧 roles/subject。

宿主归属：可信身份签发、项目目录、成员 client 审批、subject 项目授予、epoch 在线失效、UI/IdP/access/refresh/MCP 传播、MCP tools/list 每请求重算、TypedAuthorization.QueryDomain.resourceDomains 的 namespace×resourceId 过滤和一次性迁移激活点。插件归属：本地策略绑定、ResourceIntent 子集校验、业务管理页面和 schema1 迁移。部署仓归属：正式镜像、插件 jar 和双 client Compose 验收。

资源 ID 详情/写必须支持；受限 ID 列表、total、统计和聚合必须在 SQL 分页前使用保持 namespace×ID 关联的 V2 域。未适配入口必须明确拒绝，不能全域或先分页后过滤。根仓旧失败 CI `39026310136` 的 `scripts/blackbox-rbac.mjs:269` tools/list per-resource 用例是必需复测入口；旧 digest `144de64` 只作失败证据，先复测正式 `1b044df`。

### REQ-0362 扩展资源授权激活（已接收）

消费项目：`ai-specs/kestra-plugin-rbac`。证据：0340 管理页面使用 SYSTEM.EXECUTE 空 scope；OssRestOperationAdapter 行政默认分支无法表达 extensionId、身份管理与本地管理边界。宿主最小面为通用 `Resource.EXTENSION`、注册 extensionId 的 READ/UPDATE 评估、逐 descriptor manifest 门和旧模式失败关闭；插件 provider 与 Controller 细分管理权，业务模型不进入 overlay。根仓 CI `39026951944` 的 missing-jar tools/list 500（:287）是必需回归证据。


### 应用项目管理目标与查询消费收敛（已接收，实施中、未发布）

消费项目仍为 `ai-specs/kestra-plugin-rbac`。单 UI client 的所属项目与目标项目本地
绑定管理之间缺少明确范围，已接收 `ManagementIntent.projectIds` 最小扩展：仅
LOCAL_POLICY 非空可用，空集合只代表所属项目，非空只代表精确列出的项目，不能通配。
身份端负责共享管理意图上界；插件负责本地收窄、实际目标授权和完整绑定原子恢复。
证据、边界、兼容构造与验收门见 `docs/r-ee-rbac.md` 的 LOCAL_POLICY 末节。

未发布且无生产消费者的独立 QueryDomainV2 已裁决删除。实际关联查询域使用
`TypedAuthorization.QueryDomain.resourceDomains`，显式保留资源范围和 ID 范围；
现有类型保持旧构造兼容。SQL、分页、total 与统计必须消费同一关联域，不能把 DTO
测试当作实际支持。完整语义见 `docs/extension-mechanisms.md` 应用项目机制末节。


### 应用项目候选的安全修正（未发布）

共享 scope 的授权含义只允许收窄；扩大必须创建新稳定标识并显式批准、绑定和授予。
`directoryRevision` 是 Project.revision；authorizationVersion 是独立撤权 epoch。
关联域相交无有效项时必须为空拒绝，不能回退旧 namespace-only 域；TENANT term 与
受限 namespace 外层矛盾时拒绝构造。未适配 ID 的 namespace-only、日志及其他后端
遇 RESTRICTED_IDS 拒绝；ALL_IDS 的 namespace 过滤必须可用。JDBC 首版仅 FLOW、
EXECUTION 通用查询和 tenant MCP_SERVER 列表有 ID 适配；范围表见 README。

目录写入必须在取写连接前取得可信身份，并在同一写事务复核认证版本、目录修订、
epoch、active subject/client、audience 与 scope 授予。token 交换的目录受众、账号版本
及 JWK 签名查询复用同一连接，不能依靠扩大连接池掩盖嵌套借连接。独立回归使用真实
PostgreSQL 与最多一个活动连接的受限 DataSource，不将连接暴露给插件公开接口。


应用项目模式不得丢失真实 client 的协议 scope 注册上界。全局词汇表只作分类；
签发和 refresh 在同一连接核对 active client 注册范围，项目项继续按 member 上界
解释。目录 namespace 与 opaque resource ID 在公开构造边界严格校验，非法共享
意图不得保存后再交由插件拒绝。上述均为未发布候选的必要拒绝语义。

### 应用项目宿主发布状态（2026-10-18）

> 应用组目标已替代旧应用项目模型。`0361458` 已发布 scope 名称、签名应用组 claim 和声明投影 SPI 的部分机制；旧应用项目对象、意图字段和恢复联锁仍未替换。`kestra-plugin-rbac` 的声明实现与新模型组合验收尚未发布，剩余最小面见 `docs/r-oidc-server.md`“应用组签发与目录契约重构提案”。不得将旧 CI 或这次部分宿主发布当作新模型全通过。
> 应用组 scope 不再承载资源或管理意图。目录事务内管理授权的机制缺口已记录在 `docs/r-oidc-server.md`“应用组管理授权边界提案”，状态为已接收、未实施、未发布；当前 patch 的旧意图和恢复机制仍是待替换事实。
> 缺声明组件的首方协议登录失败归宿主签发机制；修复候选与失败证据见 `docs/r-oidc-server.md`“缺声明组件的首方协议登录”。缺插件业务门必须保持失败关闭。
> `ScopeDefinition` 去除共享意图的候选补丁已进入本地结构门；插件策略边界尚未适配，镜像未正式发布。不得以旧全组意图补回应用权限的运行时事实来源。

上述应用项目机制及目录迁移数据源修正已在 `4b017f6` 的正式 CI
[39087229293](https://github.com/ai-specs/kestra-overlay/actions/runs/39087229293) 通过，
镜像已推广为 `sha256:ba19764bf232306e6501c5226af015d3e18d006da75a4e96a55c6baecee457af`。
先前段落中的“候选／未发布”描述提案与实施时状态；本条只确认指定提交的宿主公开机制、
镜像级 MCP/OIDC/浏览器检查和发布，不确认独立插件业务、完整迁移或 Compose 组合。
使用契约与范围以 README 的应用项目章节为准；后续提交须检查自身 CI，不沿用此记录。
