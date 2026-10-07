# OSS vs EE 架构能力差异表（kestra-overlay 立身依据）

> **为什么有这张表**：kestra-overlay 的使命是「立足上游具体版本（BASE pin）的架构能力，
> 补足 kestra OSS 相对 EE **故意阉割的架构扩展能力**」——只补能力骨架（认证、扩展点
> 激活、路由/错误管线挂钩），不复刻 EE 的产品功能（审计日志、Kafka 队列等商业件）。
> 每一项补足决策（patch / 扩展仓 / reserved / 不补足）以此表为准；上游升级后必须复扫。
>
> 证据分级：`[src]` = BASE 源码证据（file:line，命令见文末，可复现）；
> `[docs]` = kestra.io 公开文档宣称（无源码证据）；`[dsh]` = dsh 项目实证。

## 1. 架构缝隙机制（上游为 EE 预留的挂接点 = overlay/扩展仓的合法通道）

| # | 缝隙机制 | v2.0.5 源码证据 `[src]` | 稳定性依据 | 本仓使用 |
|---|---|---|---|---|
| S1 | `@Requires(missingClasses = "io.kestra.ee.…")` 替换 bean：EE jar 在 classpath 时 EE bean 顶替 OSS bean | `webserver/rooting/TenantAliasingRooter.java:19`（全仓唯一一处显式 EE 类名缺席判定） | EE 与 OSS 同 codebase、EE 以 jar 叠加交付（license key 激活即升级 `[docs]`），该机制是 EE 自身运行前提 | 扩展仓可同法提供替换 bean（阶段二 harness 面候选） |
| S2 | `EditionProvider` 版本判定注入：功能门控按 Edition 分叉 | `core/utils/EditionProvider.java`；消费点见 §2 表 | 同上；判定逻辑可被 patch 改写（本仓 REQ-0010 即此类） | REQ-0010（MCP OAUTH 解禁） |
| S3 | `io.kestra.ee.*` 插件分发过滤 | `webserver/controllers/api/PluginController.java:388,400`（`PluginDistribution.EE` 白名单判定 `:696`） | 同上 | 不使用（不分发 EE 插件） |
| S4 | 插件体系（`plugins/` 目录自动扫描、外部 jar） | `core/plugins/`（RegistryScanner 等）；上游商业利益保证其稳定 | 上游靠插件生态变现，破坏即自伤 | plugin-apps-amis / plugin-apps-harness jar 注入（`build-extensions.sh`） |
| S5 | **外部 classpath jar 同包 `@Controller`/`@Filter` 可被 Micronaut 扫描注册**（EE 的交付形态本身证明该能力） | OSS 不含此类代码；`[dsh]` fork 实证：`io.kestra.webserver.*` 同包外部 jar 的 @Controller 注入 + 烤入镜像后 13/13 安全测试全绿、`:webserver:compileJava` 通过 | EE 以「加 license 重启即升级」交付 `[docs]` ⇒ OSS 架构必须原生支持外部 jar bean 注册，否则 EE 无法工作 | plugin-apps-harness（阶段二，Dsh* 控制器出仓） |
| S6 | `Optional<服务>` 注入缺席容忍：EE 服务缺席时 OSS 默认行为生效 | `webserver/controllers/api/MiscController.java:72`（`Optional<BasicAuthService>`）等 | 上游惯用模式 | REQ-0011 依赖此模式（OIDC 部署下 BasicAuthService 缺席） |

## 2. OSS 门控的能力差异（源码实证，逐处判定）

| 门控点 | v2.0.5 位置 `[src]` | OSS 行为 | EE 行为 | dsh 需要？ | 补足方式 | 状态 |
|---|---|---|---|---|---|---|
| MCP server `authType=OAUTH` 管理 | `webserver/controllers/api/McpServerController.java:198`（OSS 判定，API_TOKEN 仍禁） | OAUTH/API_TOKEN 均 403「requires Enterprise Edition」 | 可配置第三方 OAuth Provider | **需要**（MCP 客户端走内置 kestra-oidc） | REQ-0010 patch：OAUTH 解禁 + 服务器侧默认 provider/scopes | **已实施**（0010） |
| MCP server `authType=API_TOKEN` | 同上 | 403 | 可用 | 不需要 | 不补足（机器身份走 OIDC JWT） | 不补足 |
| 插件自动安装 | `core/plugins/PluginAutoInstallService.java:89`（`!= OSS` 才启用） | 关闭（提示用 Plugin Versioning） | 启用 | 不需要（overlay 烤 jar，不走自动安装） | 不补足 | 不补足 |
| EE 分发插件可见性 | `PluginController.java:696`（OSS 禁 `PluginDistribution.EE`） | EE 插件不可见/不可装 | 可用 | 不需要 | 不补足 | 不补足 |
| 500 错误详情粒度 | `webserver/errors/ProblemFactory.java:39` | OSS 收敛 serverErrorDetail（不泄内部细节） | EE 更详细 | 不需要（收敛即安全默认） | 不补足 | 不补足 |

## 3. 公开文档宣称的 EE 功能清单（`[docs]`，OSS 源码无门控证据——多为 EE jar 内实现）

> 来源：kestra.io/docs/oss-vs-paid、/docs/enterprise（2026-10-07 抓取）。EE = 「OSS 之上的
> additive overlay」同 codebase 加 license key 激活（该表述是 §1-S5 实证链的文档侧佐证）。

| 能力域 | EE 功能 | dsh 需要？ | 补足方式 | 状态 |
|---|---|---|---|---|
| 认证 | SSO OIDC、SCIM、用户邀请 | **OIDC 需要**；SCIM/邀请不需要 | kestra-oidc-provider 扩展仓 + REQ-0011 激活点 | **仓已立项**（阶段一）；0011 已实施 |
| 授权 | RBAC（资源:动作级、namespace 级）、Impersonation、服务账号/API token | **RBAC 需要**（员工边界/管理端）；Impersonation 不需要；API token 不需要（OIDC JWT 替代） | DshAdminAuthorizer + DshNativeEndpointGuard（外部 classpath jar） | **reserved**（plugin-apps-harness 阶段二） |
| 多租户 | 租户隔离（独立 secrets/storage） | 不需要（单租户 main） | — | 不补足 |
| 命名空间治理 | namespace 级访问控制、namespace secrets、allowed plugins、policies 注入 | 部分：员工文件边界走 namespace 文件存储 + 守卫（非 secrets 管理） | plugin-apps-harness（阶段二） | **reserved** |
| 审计 | 审计日志、Log Shipper | 不需要（观测走 dsh_metrics，harness-kestra-app 阶段四） | — | 不补足（阶段四另判） |
| 可扩展性 | Kafka/Redis/AMQP/PubSub 队列、HA、Worker Groups、外部日志库、Maintenance Mode | 不需要（单机 compose 栈） | — | 不补足 |
| 产品功能 | Apps（workflow 变自服务界面）、模板 Blueprints、Custom Dashboards、Kill Switch | **Apps 需要**，但**自研实现**（amis 声明式页面，不复刻 EE Apps） | plugin-apps-amis + REQ-0020/0021/0022 | **已实施**（0010-0022 面） |
| 密钥 | 外部 secrets manager 集成（Vault 等） | 不需要 | — | 不补足 |

## 4. reserved 登记簿（待激活扩展点——manifest 同步登记，实施时转为 patch/扩展仓）

| rid | 扩展点 | 触发条件（何时收） | 预期形态 |
|---|---|---|---|
| R-EE-RBAC | DshAdminAuthorizer/DshNativeEndpointGuard 出仓 + 相应 webserver M 面激活 | plugin-apps-harness 实施时 | 外部 classpath jar（S5）+ 最小 patch |
| R-APP-ROUTER | AppRouterController/AppsFileController/AppsService（apps API 面，TenantAliasingRooter/NotFoundHeadersFilter 的 AppRouterController 排除逻辑届时回归） | plugin-apps-harness 实施时 | 同上 |
| R-NFH-ANCHOR | NotFoundHeadersFilter（上游 develop 已有该文件，fork 有 UiAppController 排除一小块定制）：BASE 升到含该文件的 release 后**必须**评估 fork 定制块是否需以 M patch 回锚 | 下一次 BASE 升级 | M patch（若 catch-all 语义仍需排除） |
| R-MIG-DSH | dsh_metrics migration（**bean + SQL 成对收**——fork 原 SQL-only patch 因缺 Java 注册 bean 从未生效） | harness-kestra-app 实施时（阶段四） | migration patch 组 |
| R-AI-DASHSCOPE | AiServiceManager（DashScope/OpenAI 启用） | plugin-apps-harness 实施时（阶段二） | M patch |

## 5. 复现命令（证据纪律：结论必须可复现）

```bash
# 在 BASE（patches/BASE 第 2 行 commit）checkout 的上游树内执行：
git grep -n "Edition\.OSS\|Edition\.EE\|Edition\.CLOUD" -- '*.java' | grep -v /test/   # §2 门控清单
git grep -n "io\.kestra\.ee" -- '*.java' | grep -v /test/                              # §1-S1/S3 缝隙
git grep -n "missingClasses" -- '*.java' | grep -v /test/                              # @Requires 缝隙总数
```

文档侧来源（2026-10-07 抓取）：kestra.io/docs/oss-vs-paid、kestra.io/docs/enterprise。
升级 BASE 后：重跑上述命令 → 更新 §1/§2 → 逐行复审 §3 判定与 §4 reserved 触发条件。
