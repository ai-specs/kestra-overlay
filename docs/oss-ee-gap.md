# OSS vs EE 架构能力差异表（kestra-overlay 立身依据）

> **为什么有这张表**：kestra-overlay 的使命是「立足上游具体版本（BASE pin）的架构能力，
> 补足 kestra OSS 相对 EE **故意阉割的架构扩展能力**」——只补能力骨架（认证、扩展点
> 激活、路由/错误管线挂钩），不复刻 EE 产品功能（审计日志、Kafka 队列等商业件）。
> 每一项补足决策（patch / 扩展仓 / reserved / 不补足）以此表为准；上游升级后必须复扫
> （§5 命令集，扫全仓、非测试面）。
>
> 证据分级：`[src]` = BASE（v2.0.5 @ 172dd0f37）源码证据（file:line）；
> `[docs]` = kestra.io 公开文档宣称（无源码证据）；`[dsh]` = dsh 项目实证。
> 本表 2026-10-07 由穷尽扫描生成（范围：全仓 24 个模块非测试源码 + ui/src edition 消费点
> + kestra.io/docs/oss-vs-paid）；同日**使命复审**一轮（oss→ee 视角重判：S9 缝隙类增补、
> 「不补足→缝隙开放」改口 4 行、reserved 形态重推导，标注「2026-10-07 复核/复扫」）。

## 1. EE 的交付机制 = overlay 可用的架构缝隙（穷尽列举）

> 各缝隙的**生效原理**（要不要编译/重启/外部 jar）见 `docs/extension-mechanisms.md`（结论矩阵）。
> 结论先行：**EE 与 OSS 同 codebase，EE 以「classpath jar + license key」叠加交付**
> （`[docs]`「加 license 重启即升级」）。OSS 源码里处处是「为 EE 预留的挂接点」——
> 这些挂接点就是本仓与扩展仓的合法通道（上游商业利益保证其稳定：动了它们 EE 自己就挂）。

| # | 缝隙机制 | v2.0.5 源码证据 `[src]` | 本仓/扩展仓使用 |
|---|---|---|---|
| S1 | `@Requires(missingClasses="io.kestra.ee.…")`：EE jar 在 classpath 时其 bean 顶替 OSS bean（全仓唯一注解实例） | `webserver/rooting/TenantAliasingRooter.java:19`（`TenantAliasingRooterEE`） | 扩展仓可同法提供替换 bean |
| S2 | **OSS 桩 bean + EE `@Replaces`**（上游源码内显式文档化的「桩—替换」对） | ① `core/tenant/TenantService.java:9`（"Tenant is an EE feature"，OSS 恒返回 main）② `core/runners/DisabledReusableInputsExpander.java:11` ↔ `ReusableInputsExpander.java:24`（javadoc 明说 "open-source default errors… EE concern"）③ `webserver/services/ai/agent/DefaultSystemPromptResolver.java:11`（javadoc 明说 "EE replaces this bean via @Replaces"）④ `core/services/ConcurrencyLimitResolver.java:17`（OSS 只解析 flow 级；namespace/tenant 级是 EE）⑤ `core/services/MaintenanceService.java:89`（"Maintenance mode is EE feature"）⑥ `core/services/NamespaceService.java:22`（namespace 管理 EE，OSS 恒 false） | 同构通道：DshAdminAuthorizer/DshNativeEndpointGuard（阶段二出仓，`[dsh]`） |
| S3 | `EditionProvider` 判定注入（功能按 Edition 分叉；全部调用点） | `KestraContext.java:150`（context 默认 OSS）、`PluginAutoInstallService.java:89`、`McpServerController.java:144`、`PluginController.java:696`、`ProblemFactory.java:39`、`PosthogService.java:28`、`cli/DefaultStartupHook.java:25`、`worker-controller/RequestOrResponseHeaderFactory.java:50`（proto Edition 头→EE Kafka runner） | REQ-0010（改 McpServerController 判定） |
| S4 | **按 distribution 声明的接口 bean**（OSS 明文「各发行版声明自己拥有的路径」） | `webserver/errors/ProblemFormatExclusion.java:12`（"the Model Context Protocol endpoints are Open Source, SCIM is Enterprise"） | ProblemResponseFilter 已注入 `List<ProblemFormatExclusion>`（REQ-0020/0021 依赖的管线） |
| S5 | `io.kestra.ee.*` 包名空间与分发过滤 | `PluginController.java:388,400`（`PluginDistribution.EE` 白名单 `:696`）、`Makefile:85`（打包排除 `io.kestra.plugin.ee`/`io.kestra.ee.secret` groupId）、`core/models/ui/PluginDistribution.java:8` | 不使用（不分发 EE 插件） |
| S6 | **classpath jar 补 bean/过滤器链**（EE 的交付形态本身；框架级能力） | **安全链实证**：`webserver/build.gradle:25` 仅有 `micronaut-security-csrf`——认证过滤器链不在 OSS 构建中，OSS 的认证=自研 `BasicAuthService` cookie；EE 以 jar 补 micronaut-security 链 `[docs]`；dsh fork 的 webserver/build.gradle 对此**零定制**（安全依赖全在其自建 oidc-provider 模块）`[dsh]`。通用实证：外部 jar 同包 `@Controller`/`@Filter` 可被扫描注册（fork 13/13 安全测试全绿）`[dsh]` | kestra-oidc-provider 的 webserver 侧认证链 jar + plugin-apps-harness 控制器 jar。**承载现状（2026-10-07 统一口径）**：官方镜像 selfrun `-jar` 模式下外部 jar 只能构建期并入（F1，见 extension-mechanisms）——两仓 jar 的镜像内承载**均未落地**，统一依赖 R-CLASSPATH-MERGE（§4）；kestra-oidc-provider 的 IdP 进程部分独立成镜像不受影响 |
| S7 | 插件体系（`plugins/` 自动扫描、外部 jar 插件） | `core/plugins/`（RegistryScanner 等） | plugin-apps-amis / plugin-apps-harness jar 注入（build-extensions.sh） |
| S8 | `Optional`/`BeanProvider` 注入缺席容忍（EE bean 缺席→OSS 默认行为） | `MiscController.java:72`（`Optional<BasicAuthService>`）、`DefaultStartupHook.java:25-39`（`Optional<EditionProvider>`+多个 `BeanProvider`）、`KestraContext.java:149` | REQ-0011 依赖此模式（OIDC 部署下 BasicAuthService 缺席） |
| S9 | **protected 方法覆写点**（OSS javadoc 自述「EE 覆写此方法放行」的显式覆写缝；2026-10-07 复扫实证的第四类缝隙） | ① `core/contexts/KestraBeansFactory.java:112-118` `ensureLogDataStoreAllowed()`（外部日志库门，javadoc 明说 EE 靠覆写放行）② `webserver/services/ai/AiServiceManager.java:115-137` `createAiService()`（非 gemini 提供商即抛 EE 异常）③ `core/validations/validator/FlowValidator.java:204`（EE-only inputs 放行覆写；同款 `core/docs/JsonSchemaGenerator.java:170`） | 同构通道：扩展仓子类 bean `@Replaces` 覆写（与 S2 等价，经 classpath jar）——候选消费：外部日志库（§2-F）、AI 提供商（§2-H） |

## 2. 能力差异总表（按能力域穷尽；源码证据为主，文档宣称为辅）

### A. 认证与身份（阶段一核心）

| 能力 | OSS v2.0.5 行为 `[src]` | EE 行为 | 阶段一 | 补足方式 | 状态 |
|---|---|---|---|---|---|
| 认证方式 | 仅自研 Basic Auth（`BasicAuthService` cookie）；**认证过滤器链不在 OSS 构建**（S6 证据） | SSO OIDC + SCIM + 服务账号/API token + impersonation `[docs]` | **需要 OIDC** | kestra-oidc-provider（IdP 独立进程 + webserver 侧认证链 jar，S6）+ REQ-0011（UI 引导激活）。**注意**：认证链 jar 的镜像内承载依赖 R-CLASSPATH-MERGE（未落地，见 S6 行与 §4） | 仓已立项；0011 已实施 |
| 登录引导 | `/configs` 仅暴露 `isBasicAuthInitialized`（`MiscController.java:330` 起 Configuration 含 `edition` 字段） | 同端点由 EE 链给出 SSO 状态 | **需要** | REQ-0011：`oidcAuthEnabled` 字段 + security-enabled 视为已配置 | **已实施** |
| SCIM 目录同步 | 无（`ProblemFormatExclusion.java` javadoc 明言 SCIM 归 EE） | 有 `[src+docs]` | 不需要 | — | 不补足 |
| 服务账号/API token | 无 | 有 `[docs]` | 不需要（机器身份走 OIDC JWT） | — | 不补足 |

### B. 授权与访问控制

| 能力 | OSS 行为 | EE 行为 | 阶段一 | 补足方式 | 状态 |
|---|---|---|---|---|---|
| 端点级认证门 | 无过滤器链（见 A） | intercept-url-map/规则链 `[docs]` | **需要（最小形态）** | **部署面**：compose 的 micronaut-security `intercept-url-map`（`/**→isAuthenticated()`）——配置级缝隙，非 patch（fork 同形态 `[dsh]`）；**生效前提 = 认证链 jar 进镜像**（R-CLASSPATH-MERGE 前置，intercept-url-map 是 micronaut-security 的配置面） | 部署面（kestra-oidc-provider 侧） |
| RBAC（资源:动作、namespace 级） | **OSS 主源码零授权钩子**（2026-10-07 复扫：webserver/core 无 SecurityRule/intercept-url-map 类）+ **EE IAM API 面（users/roles/permissions/groups/service-accounts/me）在 vanilla 实例全部 route-miss 404**`[live]`——OSS 无预留缝隙，判定面整体在 EE jar | 有 `[docs]` | 完整 RBAC 阶段二需要 | 扩展仓 jar 提供 micronaut-security 的 SecurityRule/Authorizer bean（S6 通道），**预期零 overlay patch**（原「webserver M 面激活」无源码证据支撑，已修正）。**需求已细化立案：[docs/r-ee-rbac.md](r-ee-rbac.md)**（目标能力/非目标/交付分层/验收判据/OQ 清单） | **reserved** R-EE-RBAC（实证待客户实施） |

### C. MCP（阶段一核心）

| 能力 | OSS v2.0.5 行为 `[src]` | EE 行为 | 阶段一 | 补足方式 | 状态 |
|---|---|---|---|---|---|
| MCP server authType | `core/mcp/models/McpServer.java:74` **源码明文**：「OAUTH 和 API_TOKEN are Enterprise Edition only」+ `McpServerController.java:144` 门控 403 | 可配第三方 OAuth Provider | **需要 OAUTH**（内置 kestra-oidc 为授权服务器） | REQ-0010：OAUTH 解禁 + 服务器侧默认值 + PUT null-合并 | **已实施** |
| API_TOKEN | 同上（403） | 可用 | 不需要（机器身份走 JWT） | — | 不补足 |
| ⚠️ UI 侧 edition 门控 | **UI 按 `/configs.edition==="OSS"` 隐藏 OAUTH 表单**：`ui/src/components/admin/McpServerList.vue:106`、`mcp/tabs/McpEdit.vue:206`、`mcp/useToolFlowCreation.ts:44` | edition=EE 时展示 | **阶段一影响项** | MCP server 配置经 API/配置直载（kestra-oidc-provider 侧），不依赖官方 OSS UI 表单；ui 面归属后续裁定 | **已记录**（行为注记） |

### D. 多租户

| 能力 | OSS 行为 `[src]` | EE 行为 | 阶段一 | 补足方式 | 状态 |
|---|---|---|---|---|---|
| 租户隔离 | `TenantService.java` 桩恒 `main`（S2 桩对，2026-10-07 复核）；`TenantAliasingRooter.java:19` 为 EE 预留 @Requires 缝隙；`StandAloneCommand.java:56` `--tenant` 选项注明 enterprise | 独立 secrets/storage 的租户体系 `[docs]` | 不需要（单租户 main） | — | **缝隙开放（S1/S2，零 patch）**：租户体系实现归扩展仓 jar，本仓无需动作 |

### E. 治理与合规

| 能力 | OSS 行为 `[src]` | EE 行为 | 阶段一 | 状态 |
|---|---|---|---|---|
| Flow/Task/Trigger 治理策略 | `Flow.java:94`/`Task.java:80`/`AbstractTrigger.java:69`：policies 字段「parsed but ignored in the open-source edition」；`RulePluginInterface.java:15` EE 治理插件标记接口——**插件类型面已开放**（`PluginScanner.java:136/216` 扫描注册 Rule 插件，2026-10-07 复核），但策略执行链全在 EE 侧、OSS 无挂点 | REFERENCE 策略链 `[docs]` | 不需要 | 不补足（**不可薄 patch 补足**：补执行链=新建架构，超出激活点范畴；规则插件类本身可由扩展仓提供并注册） |
| 资产血缘 | `Task.java:111`：assets 字段「rejected in the open-source edition」（`FlowValidator.java:190` 拒绝）；`@EeOnly` inputs（`core/models/flows/input/EeOnly.java`，OSS schema 文档排除 `JsonSchemaGenerator.java:170`）——EE 放行靠 **S9 覆写缝**（`FlowValidator.java:204`「The Enterprise build overrides this」） | 资产图谱 `[docs]` | 不需要 | 不补足（血缘图谱是产品功能；覆写缝仅放行字段声明，不含图谱实现） |
| 可复用输入 | `DisabledReusableInputsExpander.java:19` 运行期报错「require Kestra Enterprise Edition」（S2 桩—替换对；块存储与解析在 EE `ReusableInputsInput.java:20`） | 有 `[src]` | 不需要 | **缝隙开放（S2，零 patch）**：Expander 替换 bean 归扩展仓；存储/解析实现属 EE 业务件不复刻 |
| 审计日志/Log Shipper | 无 | 有 `[docs]` | 不需要（观测属客户栈另判） | 不补足（产品功能） |

### F. 可扩展性与运行面

| 能力 | OSS 行为 `[src]` | EE 行为 | 阶段一 | 状态 |
|---|---|---|---|---|
| 队列后端 | 内置 JDBC/内存队列；**EE Kafka runner 类名出现在 OSS 日志配置**（`core/src/main/resources/logback/base.xml:21-23` `io.kestra.ee.runner.kafka.services.*`、`cli/BaseCommand.java:45` logger 过滤）→ EE jar 运行期装载 | Kafka+Elasticsearch/Redis/AMQP/PubSub `[docs]` | 不需要（单机 compose） | 不补足（记录 S6 佐证：EE 类运行期从 jar 装载） |
| worker-controller Edition 协议头 | `RequestOrResponseHeaderFactory.java:50`（Edition 映射 proto，EE 侧消费）；worker `GrpcServerEventSender`/`GrpcKVBackend` 等 @Replaces 面向 EE scale-out | HA/Worker Groups `[docs]` | 不需要 | 不补足 |
| 维护模式 | `MaintenanceService.java:89` "EE feature"——接口 + `NoopMaintenanceService` @Singleton 桩（:91-92，S2 桩对，2026-10-07 复核） | 有 `[src+docs]` | 不需要 | **缝隙开放（S2，零 patch）**：Noop 桩可被扩展仓 jar `@Replaces` |
| 并发限制分级 | `ConcurrencyLimitResolver.java:17`：OSS 仅 flow 级；namespace/tenant 级 EE（`ScopedConcurrencyLimit.java:16`）——@Singleton 桩（S2 桩对，2026-10-07 复核） | 分级限流 `[src]` | 不需要 | **缝隙开放（S2，零 patch）**：Resolver 替换 bean 归扩展仓 |
| 配额（quota） | `QuotaService.java:26`：flow 带 quota 即无条件抛「Quotas are an EE feature」（S2 桩类，2026-10-07 复扫新增行） | 有 `[src]` | 不需要 | **缝隙开放（零 patch）**：Service 替换/覆写归扩展仓 |
| 外部日志库 | `KestraBeansFactory.java:112-118` `ensureLogDataStoreAllowed()` **protected + javadoc 自述「EE 覆写此方法放行」**（S9 覆写缝，2026-10-07 复核）；且日志后端走 `LogDataStoreInterfaceFactory`+PluginRegistry——**插件面** | 有 `[src+docs]` | 不需要 | **缝隙开放（S9+插件面，零 patch）**：扩展仓 jar 覆写放行 + LogDataStoreInterface 插件实现即补（原「不补足」系把开放缝隙误记为做不到，已修正） |

### G. 插件治理

| 能力 | OSS 行为 `[src]` | EE 行为 | 阶段一 | 状态 |
|---|---|---|---|---|
| 插件自动安装（运行期 API 装插件，无需重启） | **支持**：显式 `kestra.plugins.auto-install.enabled` 优先；缺省在 `storage.type=local` 单机形态**默认开启**（`PluginAutoInstallService.java:89-99`，dsh 栈即此形态） | **强制关闭**（改用 Plugin Versioning） | 能力已具备（部署面即可用，非 patch 面）；默认仍烤 jar 进镜像（可复现、CI 验证） | **能力澄清**（初版方向读反已修正，AGENTS.md §8-9） |
| EE 分发可见性 | `PluginController.java:388,400,696`（`io.kestra.ee.*` 过滤 + `PluginDistribution.EE` 白名单） | 可见 | 不需要 | 不补足 |
| PluginManager 存储 | `cli/AbstractCommand.java:116`、`NoDatabaseCommandInterface.java:10`（EE 经 repository 管理） | 有 `[src]` | 不需要 | 不补足 |

### H. AI

| 能力 | OSS 行为 `[src]` | EE 行为 | 阶段一 | 补足方式 | 状态 |
|---|---|---|---|---|---|
| AI 服务 | OSS 有 AiServiceManager/AiController；**提供商门控**：`AiServiceManager.createAiService()`（:115-137）`!"gemini".equals(type)` 即抛「require Kestra Enterprise Edition」——与 MCP authType 同类的逐项门控，且方法是 **protected（S9 覆写缝）**；**per-provider 自定义 prompt 是 EE**（`DefaultSystemPromptResolver.java:11` javadoc，S2 桩—替换对）；UI copilot 按 edition 走不同 SDK 面（`ui/src/components/ai/copilot/useAiChat.ts:12`） | 完整 AI 面 `[src+docs]` | 阶段二需要（非 gemini 提供商启用） | 门控解禁**二选一**：overlay patch（M 面改条件，同 REQ-0011 形态）或扩展仓 jar 子类覆写（S9）；**提供商适配器（OpenAI/DashScope 的 AiService 实现）在 EE jar、OSS 无——归扩展仓提供**。prompt 面走 S2 替换 bean 零 patch | **reserved** R-AI-PROVIDERS |

### I. 产品功能

| 能力 | OSS 行为 | EE 行为 | 阶段一 | 补足方式 | 状态 |
|---|---|---|---|---|---|
| Apps（workflow 变自服务界面） | 无 | 有 `[docs]` | **需要，但自研**（amis 声明式页面，不复刻 EE Apps） | plugin-apps-amis + REQ-0020/0021/0022 | **已实施** |
| Dashboards/自定义仪表盘 | UI 预留 edition 位（`ui/src/components/dashboard/types.ts:38` "schema is Enterprise-only"） | 有 `[src+docs]` | 不需要 | — | 不补足 |
| 密钥管理 | EE secrets groupId 在打包排除清单（`Makefile:85` `io.kestra.ee.secret`）；外部 secrets manager `[docs]` | 有 | 不需要 | — | 不补足 |
| 500 错误详情 | `ProblemFactory.java:39`：OSS 收敛 serverErrorDetail | EE 详细 | 不需要（收敛即安全默认） | — | 不补足 |
| 遥测含 edition | `PosthogService.java:28` | — | 无影响 | — | 仅记录 |

## 3. 阶段一能力闭环视图（整体考虑）

> **「阶段」的语义（2026-10-07 澄清）**：本表「阶段一/二/四」是**客户迁移阶段的
> 优先级注记**（AGENTS.md §0-3：客户阶段只影响优先级，不影响 patch 形态与质量标准）。
> 一切移除条件/触发条件一律**形态绑定**（如「R-CLASSPATH-MERGE 落地后」），禁止
> 只写阶段号。

阶段一 = 支撑 **plugin-apps-amis + kestra-oidc-provider** 两仓。以差异表为整体视角：

```
kestra-oidc-provider 需要：认证链（A1←S6 jar，镜像内承载依赖 R-CLASSPATH-MERGE）
                          + 登录引导（A2=REQ-0011）
                          + MCP OAUTH（C1=REQ-0010）+ 最小端点门（B1=部署面配置，
                            生效前提同上）
plugin-apps-amis   需要：命名空间承载面（I1：REQ-0020 catch-all + REQ-0021 防探测
                          + REQ-0022 外壳模板；S4/S7 管线与插件缝隙）
阶段一显式不补（影响可接受）：完整 RBAC（B2，客户实施时实证）、AI 面（H，同）、
                          UI edition 门控（C3 行为注记：MCP 配置走 API 直载）、
                          其余 D~G/I 域全部（单机形态/产品功能，无客户需求）
```

阶段切换（新增扩展仓/新 BASE）时：先在此表补行、给出补足方式与状态，再动 patch
（AGENTS.md §2 入口 B 接收标准 ④）。

## 4. reserved 登记簿（待激活扩展点；manifest.tsv 同步登记）

> 登记**收回规则**（2026-10-07 增补）：仅「可能成为 overlay patch/构建面动作」的待激活点
> 留在本簿；源码证据表明**零 overlay 动作**即可补足的（纯 S2/S9 缝隙 + 扩展仓 jar），
> 在 §2 对应行记「缝隙开放」即可，不入本簿。触发条件一律形态绑定。

| rid | 扩展点 | 触发条件（形态绑定） | 预期形态 |
|---|---|---|---|
| R-CLASSPATH-MERGE | 通道②的镜像承载机制（EE 同构交付的核心缺口，S6）——**已立案待实施**（2026-10-07 使命审查升级；可行性与最小面方案见 `docs/extension-mechanisms.md` §4） | 实施指令（不绑客户阶段；是 R-EE-RBAC/R-APP-ROUTER 与 0020/0021 收窄的共同前置） | build.sh 构建产物后处理（manifest Class-Path 注入，候选 b）+ OQ1/OQ2 实证；零 patch 文件 |
| R-EE-RBAC | 端点/资源级授权：扩展仓 jar 提供 micronaut-security SecurityRule/Authorizer bean | 客户实施并提供行为证据（§2-B 接收标准） | 外部 classpath jar（S6）；**预期零 overlay patch**（OSS 无授权钩子可激活，2026-10-07 复扫 + vanilla 实测 IAM API 全 404）；实证含 SecurityRule 从 jar 注册。**展开文档：[docs/r-ee-rbac.md](r-ee-rbac.md)** |
| R-APP-ROUTER | apps API 面（AppRouterController/AppsFileController/AppsService）；TenantAliasingRooter/ProblemResponseFilter 的 AppRouterController 排除逻辑届时回归 | 客户实施并提供行为证据 + R-CLASSPATH-MERGE 落地（jar 承载前置） | 外部 classpath jar（S6）+ 排除逻辑回归 patch |
| R-NFH-ANCHOR | NotFoundHeadersFilter（上游 develop 已有该文件，fork 有 UiAppController 排除一小块定制）：BASE 升到含该文件的 release 后**必须**评估回锚 | 下一次 BASE 升级（升级 SOP §6-3 强制项） | M patch |
| R-AI-PROVIDERS | AI 提供商门控解禁（§2-H：`AiServiceManager` 非 gemini 即抛）；适配器实现归扩展仓 | 客户实施并提供行为证据 | patch 解禁（M 面改条件）**或** jar 子类覆写（S9）二择一，实施时先验证覆写路径 |
| R-UI-EDITION-GATE | OSS UI 按 edition 隐藏的能力面（C3：MCP OAUTH 表单等 3 处 + dashboard/EE-only schema） | 按需（不预设） | **仅两路**：扩展仓前端包（apps.html 外壳已实证此路）或后端 /configs 字段面 patch；~~ui 面 patch~~（§2 禁收：镜像不编译 ui，收了不生效——2026-10-07 删除该选项） |

**已收回/迁移的登记**（防重新立案，git 历史即归档）：
- `R-MIG-DSH`（原「dsh_metrics migration，bean+SQL 成对收 patch 形态」）→ **收回**：
  `MigrationRunner` 注入 `Collection<MigrationScript>` 收集 Micronaut 上下文**全部** bean
  （`core/migration/MigrationRunner.java:47-56`，INIT_SCRIPT_IDS 还预留 `0-init-ee`），
  扩展仓 classpath jar 自带 MigrationScript bean 即自动注册执行，**overlay 零动作**
  （2026-10-07 源码复核；与 AGENTS.md §2「migration 面归扩展仓」一致化——原登记的
  patch 形态与拒收清单自相矛盾）。端到端实证随 R-CLASSPATH-MERGE 首个客户做。
- `R-AI-DASHSCOPE` → 更名 `R-AI-PROVIDERS`（能力是提供商门控解禁，非特定客户选型）。

## 5. 复现命令（证据纪律：结论必须可复现；BASE 树内执行）

```bash
# 在 BASE（patches/BASE 第 2 行 commit）checkout 的上游树内执行：
git grep -n "EditionProvider" -- '*.java' | grep -v /src/test/            # §1-S3 全部调用点
git grep -n "io\.kestra\.ee" | grep -v /src/test/                          # §1-S1/S5 + EE 交付痕迹
git grep -n "missingClasses" -- '*.java' | grep -v /src/test/              # §1-S1 注解实例
git grep -in "enterprise\|EE feature" -- '*.java' | grep -v /src/test/     # §2 源码文档化阉割清单
git grep -n "overrides this\|overridden by\|Enterprise.*override" -- '*.java' | grep -v /src/test/  # §1-S9 protected 覆写缝
grep -rn "edition" ui/src --include='*.vue' --include='*.ts' | grep -v route  # §2 UI edition 门控
grep -n "micronaut-security" webserver/build.gradle                        # §1-S6 安全链缺席证据
```

文档侧来源（2026-10-07 抓取）：kestra.io/docs/oss-vs-paid、kestra.io/docs/enterprise。
升级 BASE 后：重跑上述命令 → 更新 §1/§2 → 逐行复审 §3 阶段一闭环与 §4 reserved 触发条件。
