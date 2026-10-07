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
> + kestra.io/docs/oss-vs-paid）。

## 1. EE 的交付机制 = overlay 可用的架构缝隙（穷尽列举）

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
| S6 | **classpath jar 补 bean/过滤器链**（EE 的交付形态本身；框架级能力） | **安全链实证**：`webserver/build.gradle:25` 仅有 `micronaut-security-csrf`——认证过滤器链不在 OSS 构建中，OSS 的认证=自研 `BasicAuthService` cookie；EE 以 jar 补 micronaut-security 链 `[docs]`；dsh fork 的 webserver/build.gradle 对此**零定制**（安全依赖全在其自建 oidc-provider 模块）`[dsh]`。通用实证：外部 jar 同包 `@Controller`/`@Filter` 可被扫描注册（fork 13/13 安全测试全绿）`[dsh]` | kestra-oidc-provider（认证链 jar）+ plugin-apps-harness（Dsh* 控制器 jar，阶段二） |
| S7 | 插件体系（`plugins/` 自动扫描、外部 jar 插件） | `core/plugins/`（RegistryScanner 等） | plugin-apps-amis / plugin-apps-harness jar 注入（build-extensions.sh） |
| S8 | `Optional`/`BeanProvider` 注入缺席容忍（EE bean 缺席→OSS 默认行为） | `MiscController.java:72`（`Optional<BasicAuthService>`）、`DefaultStartupHook.java:25-39`（`Optional<EditionProvider>`+多个 `BeanProvider`）、`KestraContext.java:149` | REQ-0011 依赖此模式（OIDC 部署下 BasicAuthService 缺席） |

## 2. 能力差异总表（按能力域穷尽；源码证据为主，文档宣称为辅）

### A. 认证与身份（阶段一核心）

| 能力 | OSS v2.0.5 行为 `[src]` | EE 行为 | 阶段一 | 补足方式 | 状态 |
|---|---|---|---|---|---|
| 认证方式 | 仅自研 Basic Auth（`BasicAuthService` cookie）；**认证过滤器链不在 OSS 构建**（S6 证据） | SSO OIDC + SCIM + 服务账号/API token + impersonation `[docs]` | **需要 OIDC** | kestra-oidc-provider（classpath jar 补 micronaut-security 链，S6）+ REQ-0011（UI 引导激活） | 仓已立项；0011 已实施 |
| 登录引导 | `/configs` 仅暴露 `isBasicAuthInitialized`（`MiscController.java:330` 起 Configuration 含 `edition` 字段） | 同端点由 EE 链给出 SSO 状态 | **需要** | REQ-0011：`oidcAuthEnabled` 字段 + security-enabled 视为已配置 | **已实施** |
| SCIM 目录同步 | 无（`ProblemFormatExclusion.java` javadoc 明言 SCIM 归 EE） | 有 `[src+docs]` | 不需要 | — | 不补足 |
| 服务账号/API token | 无 | 有 `[docs]` | 不需要（机器身份走 OIDC JWT） | — | 不补足 |

### B. 授权与访问控制

| 能力 | OSS 行为 | EE 行为 | 阶段一 | 补足方式 | 状态 |
|---|---|---|---|---|---|
| 端点级认证门 | 无过滤器链（见 A） | intercept-url-map/规则链 `[docs]` | **需要（最小形态）** | **部署面**：compose 的 micronaut-security `intercept-url-map`（`/**→isAuthenticated()`）——配置级缝隙，非 patch（fork 同形态 `[dsh]`） | 部署面（kestra-oidc-provider 侧） |
| RBAC（资源:动作、namespace 级） | 无 | 有 `[docs]` | 完整 RBAC 阶段二需要 | DshAdminAuthorizer + DshNativeEndpointGuard（外部 jar，S2 同构） | **reserved** R-EE-RBAC |

### C. MCP（阶段一核心）

| 能力 | OSS v2.0.5 行为 `[src]` | EE 行为 | 阶段一 | 补足方式 | 状态 |
|---|---|---|---|---|---|
| MCP server authType | `core/mcp/models/McpServer.java:74` **源码明文**：「OAUTH 和 API_TOKEN are Enterprise Edition only」+ `McpServerController.java:144` 门控 403 | 可配第三方 OAuth Provider | **需要 OAUTH**（内置 kestra-oidc 为授权服务器） | REQ-0010：OAUTH 解禁 + 服务器侧默认值 + PUT null-合并 | **已实施** |
| API_TOKEN | 同上（403） | 可用 | 不需要（机器身份走 JWT） | — | 不补足 |
| ⚠️ UI 侧 edition 门控 | **UI 按 `/configs.edition==="OSS"` 隐藏 OAUTH 表单**：`ui/src/components/admin/McpServerList.vue:106`、`mcp/tabs/McpEdit.vue:206`、`mcp/useToolFlowCreation.ts:44` | edition=EE 时展示 | **阶段一影响项** | MCP server 配置经 API/配置直载（kestra-oidc-provider 侧），不依赖官方 OSS UI 表单；ui 面归属后续裁定 | **已记录**（行为注记） |

### D. 多租户

| 能力 | OSS 行为 `[src]` | EE 行为 | 阶段一 | 补足方式 | 状态 |
|---|---|---|---|---|---|
| 租户隔离 | `TenantService.java` 桩恒 `main`；`TenantAliasingRooter.java:19` 为 EE 预留 @Requires 缝隙；`StandAloneCommand.java:56` `--tenant` 选项注明 enterprise | 独立 secrets/storage 的租户体系 `[docs]` | 不需要（单租户 main） | —（记录 S1/S2 缝隙形态） | 不补足 |

### E. 治理与合规

| 能力 | OSS 行为 `[src]` | EE 行为 | 阶段一 | 状态 |
|---|---|---|---|---|
| Flow/Task/Trigger 治理策略 | `Flow.java:94`/`Task.java:80`/`AbstractTrigger.java:69`：policies 字段「parsed but ignored in the open-source edition」；`RulePluginInterface.java:15` EE 治理插件标记接口 | REFERENCE 策略链 `[docs]` | 不需要 | 不补足 |
| 资产血缘 | `Task.java:111`：assets 字段「rejected in the open-source edition」；`@EeOnly` inputs（`core/models/flows/input/EeOnly.java`，OSS schema 文档排除 `JsonSchemaGenerator.java:170`） | 资产图谱 `[docs]` | 不需要 | 不补足 |
| 可复用输入 | `DisabledReusableInputsExpander.java:19` 运行期报错「require Kestra Enterprise Edition」（S2 桩—替换对） | 有 `[src]` | 不需要 | 不补足 |
| 审计日志/Log Shipper | 无 | 有 `[docs]` | 不需要（观测走 dsh_metrics，阶段四另判） | 不补足 |

### F. 可扩展性与运行面

| 能力 | OSS 行为 `[src]` | EE 行为 | 阶段一 | 状态 |
|---|---|---|---|---|
| 队列后端 | 内置 JDBC/内存队列；**EE Kafka runner 类名出现在 OSS 日志配置**（`core/src/main/resources/logback/base.xml:21-23` `io.kestra.ee.runner.kafka.services.*`、`cli/BaseCommand.java:45` logger 过滤）→ EE jar 运行期装载 | Kafka+Elasticsearch/Redis/AMQP/PubSub `[docs]` | 不需要（单机 compose） | 不补足（记录 S6 佐证：EE 类运行期从 jar 装载） |
| worker-controller Edition 协议头 | `RequestOrResponseHeaderFactory.java:50`（Edition 映射 proto，EE 侧消费）；worker `GrpcServerEventSender`/`GrpcKVBackend` 等 @Replaces 面向 EE scale-out | HA/Worker Groups `[docs]` | 不需要 | 不补足 |
| 维护模式 | `MaintenanceService.java:89` "EE feature" | 有 `[src+docs]` | 不需要 | 不补足 |
| 并发限制分级 | `ConcurrencyLimitResolver.java:17`：OSS 仅 flow 级；namespace/tenant 级 EE（`ScopedConcurrencyLimit.java:16`） | 分级限流 `[src]` | 不需要 | 不补足 |
| 外部日志库 | `KestraBeansFactory.java:112-118` 配置即显式报错「requires Kestra Enterprise Edition」 | 有 `[src+docs]` | 不需要 | 不补足 |

### G. 插件治理

| 能力 | OSS 行为 `[src]` | EE 行为 | 阶段一 | 状态 |
|---|---|---|---|---|
| 插件自动安装 | `PluginAutoInstallService.java:89`（`!=OSS` 才启用，OSS 强制关） | 启用（Plugin Versioning） | 不需要（overlay 烤 jar） | 不补足 |
| EE 分发可见性 | `PluginController.java:388,400,696`（`io.kestra.ee.*` 过滤 + `PluginDistribution.EE` 白名单） | 可见 | 不需要 | 不补足 |
| PluginManager 存储 | `cli/AbstractCommand.java:116`、`NoDatabaseCommandInterface.java:10`（EE 经 repository 管理） | 有 `[src]` | 不需要 | 不补足 |

### H. AI

| 能力 | OSS 行为 `[src]` | EE 行为 | 阶段一 | 补足方式 | 状态 |
|---|---|---|---|---|---|
| AI 服务 | OSS 有 AiServiceManager/AiController（openai-compatible 可配）；**per-provider 自定义 prompt 是 EE**（`DefaultSystemPromptResolver.java:11` javadoc）；UI copilot 按 edition 走不同 SDK 面（`ui/src/components/ai/copilot/useAiChat.ts:12`） | 完整 AI 面 `[src+docs]` | 阶段二需要（DashScope/OpenAI 启用） | AiServiceManager M patch | **reserved** R-AI-DASHSCOPE |

### I. 产品功能

| 能力 | OSS 行为 | EE 行为 | 阶段一 | 补足方式 | 状态 |
|---|---|---|---|---|---|
| Apps（workflow 变自服务界面） | 无 | 有 `[docs]` | **需要，但自研**（amis 声明式页面，不复刻 EE Apps） | plugin-apps-amis + REQ-0020/0021/0022 | **已实施** |
| Dashboards/自定义仪表盘 | UI 预留 edition 位（`ui/src/components/dashboard/types.ts:38` "schema is Enterprise-only"） | 有 `[src+docs]` | 不需要 | — | 不补足 |
| 密钥管理 | EE secrets groupId 在打包排除清单（`Makefile:85` `io.kestra.ee.secret`）；外部 secrets manager `[docs]` | 有 | 不需要 | — | 不补足 |
| 500 错误详情 | `ProblemFactory.java:39`：OSS 收敛 serverErrorDetail | EE 详细 | 不需要（收敛即安全默认） | — | 不补足 |
| 遥测含 edition | `PosthogService.java:28` | — | 无影响 | — | 仅记录 |

## 3. 阶段一能力闭环视图（整体考虑）

阶段一 = 支撑 **plugin-apps-amis + kestra-oidc-provider** 两仓。以差异表为整体视角：

```
kestra-oidc-provider 需要：认证链（A1←S6 jar）+ 登录引导（A2=REQ-0011）
                          + MCP OAUTH（C1=REQ-0010）+ 最小端点门（B1=部署面配置）
plugin-apps-amis   需要：命名空间承载面（I1：REQ-0020 catch-all + REQ-0021 防探测
                          + REQ-0022 外壳模板；S4/S7 管线与插件缝隙）
阶段一显式不补（影响可接受）：完整 RBAC（B2→阶段二）、AI 面（H→阶段二）、
                          UI edition 门控（C3 行为注记：MCP 配置走 API 直载）、
                          其余 D~G/I 域全部（单机形态/产品功能，无 dsh 需求）
```

阶段切换（新增扩展仓/新 BASE）时：先在此表补行、给出补足方式与状态，再动 patch
（AGENTS.md §2 入口 B 接收标准 ④）。

## 4. reserved 登记簿（待激活扩展点；manifest.tsv 同步登记）

| rid | 扩展点 | 触发条件（何时收） | 预期形态 |
|---|---|---|---|
| R-EE-RBAC | DshAdminAuthorizer/DshNativeEndpointGuard 出仓 + 相应 webserver M 面激活 | plugin-apps-harness 实施时 | 外部 classpath jar（S2/S6）+ 最小 patch |
| R-APP-ROUTER | apps API 面（AppRouterController/AppsFileController/AppsService）；TenantAliasingRooter/ProblemResponseFilter 的 AppRouterController 排除逻辑届时回归 | plugin-apps-harness 实施时 | 同上 |
| R-NFH-ANCHOR | NotFoundHeadersFilter（上游 develop 已有该文件，fork 有 UiAppController 排除一小块定制）：BASE 升到含该文件的 release 后**必须**评估回锚 | 下一次 BASE 升级 | M patch |
| R-MIG-DSH | dsh_metrics migration（**bean + SQL 成对收**——fork 原 SQL-only patch 因缺 Java 注册 bean 从未生效） | harness-kestra-app 实施时（阶段四） | migration patch |
| R-AI-DASHSCOPE | AiServiceManager（DashScope/OpenAI 启用）；注意 H 域 UI copilot 的 edition 分叉 | plugin-apps-harness 实施时（阶段二） | M patch |
| R-UI-EDITION-GATE | OSS UI 按 edition 隐藏的能力面（C3：MCP OAUTH 表单等 3 处 + dashboard/EE-only schema）；若 kestra-oidc-provider 需要官方 UI 表单形态再裁 | 按需（不预设） | ui 面 patch 或扩展仓前端包 |

## 5. 复现命令（证据纪律：结论必须可复现；BASE 树内执行）

```bash
# 在 BASE（patches/BASE 第 2 行 commit）checkout 的上游树内执行：
git grep -n "EditionProvider" -- '*.java' | grep -v /src/test/            # §1-S3 全部调用点
git grep -n "io\.kestra\.ee" | grep -v /src/test/                          # §1-S1/S5 + EE 交付痕迹
git grep -n "missingClasses" -- '*.java' | grep -v /src/test/              # §1-S1 注解实例
git grep -in "enterprise\|EE feature" -- '*.java' | grep -v /src/test/     # §2 源码文档化阉割清单
grep -rn "edition" ui/src --include='*.vue' --include='*.ts' | grep -v route  # §2 UI edition 门控
grep -n "micronaut-security" webserver/build.gradle                        # §1-S6 安全链缺席证据
```

文档侧来源（2026-10-07 抓取）：kestra.io/docs/oss-vs-paid、kestra.io/docs/enterprise。
升级 BASE 后：重跑上述命令 → 更新 §1/§2 → 逐行复审 §3 阶段一闭环与 §4 reserved 触发条件。
