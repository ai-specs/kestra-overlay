# OSS vs EE 架构能力差异表（kestra-overlay 立身依据）

> **最新规划裁定**：MCP 认证面重新接收，目标 OAuth2-only + 用户归属动态 client；
> public DCR pending 经用户确认后绑定 owner，token 与资源执行身份一致，不共享
> 用户数据。现有实现不具备这些能力。方案与动刀前证据门见
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
> 1. kestra-oidc-provider，MCP 面除外；
> 2. R-EE-RBAC（docs/r-ee-rbac.md）。
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
> REQ-0133 已接收：首次安装引导/环境变量一次性初始化 OIDC 用户与 UI client，
> 属 R-OIDC-SERVER 认证基础设施；实现与安全验收契约先写入 r-oidc-server.md §0。
> REQ-0133 已实现：网页引导/环境变量初始化共用事务，自动注册 UI client，完成状态
> 持久化；本地空库两路径与浏览器首装登录实测通过，最终以对应新 CI 为准。
> 维护者追加再审：单个数据库标记不足以防删除攻击；安装身份绑定独立持久化凭据，
> 任一存在都不能重开，异常失败关闭。见 r-oidc-server.md §0 加固契约与恢复边界。
> REQ-0134 已接收：RFC7591 标准 public client 动态注册，支持公开 OAuth2 消费方
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
| S6 | classpath jar 补 bean/过滤器链（EE 的交付形态本身） | `webserver/build.gradle:25` 仅有 `micronaut-security-csrf` ⇒ 认证过滤器链不在 OSS 构建；OSS 认证=自研 `BasicAuthService` cookie `[docs]`；外部同包 `@Controller`/`@Filter` 可注册 `[dsh]`（13/13 全绿） | **两个活跃 jar 消费的主通道**：认证链 jar + R-EE-RBAC SecurityRule jar。承载 = R-CLASSPATH-MERGE（构建期仅注入 manifest 条目；jar 一律运行时挂载；缺席静默休眠）。授权服务器不走此通道——R-OIDC-SERVER 为 patch 路线预留扩展点（2026-10-07 裁定） |
| S7 | 插件体系：`plugins/` 扫描 + `PluginClassLoader`（extends URLClassLoader，反射实例化，不进 Micronaut） | `core/plugins/`（RegistryScanner 等）；`PluginClassLoader.java:19` | 无活跃插件客户（`extensions.tsv`） |
| S8 | `Optional`/`BeanProvider` 缺席容忍：EE bean 缺席 ⇒ OSS 默认行为 | `MiscController.java:72`；`DefaultStartupHook.java:25-39`；`KestraContext.java:149` | REQ-0011 依赖此模式（OIDC 部署下 BasicAuthService 缺席） |
| S9 | protected 方法覆写点（javadoc 自述「EE 覆写此方法放行」） | `KestraBeansFactory.java:112-118`；`AiServiceManager.java:115-137`；`FlowValidator.java:204`（同款 `JsonSchemaGenerator.java:170`） | 无（分类学留档：扩展仓子类 bean `@Replaces` 覆写，经 classpath jar） |

## 2. 能力差异总表（活跃范围：认证/身份 + 授权）

### A. 认证与身份（认证线）

| 能力 | OSS 行为 | EE 行为 | 补足方式 | 状态 |
|---|---|---|---|---|
| 认证方式 | 仅自研 Basic Auth（cookie）。认证过滤器链不在 OSS 构建（S6）。 | SSO OIDC + SCIM + 服务账号 `[docs]` | 认证链与授权服务器：**预留扩展点 R-OIDC-SERVER**（patch 路线，2026-10-07 裁定——协议稳定+实现标准 ⇒ 大粒度薄层；前置裁定②：链一体化进 patch，外部 IdP 场景走内置链配置）。加 REQ-0011 做 UI 引导（已实施） | 仓已立项；0011 已实施；R-OIDC-SERVER 已预留 |
| 登录引导 | `/api/v1/configs`（MiscController）只暴露 `isBasicAuthInitialized`。vanilla 实测 `edition:"OSS"` `[live]` | 同端点给出 SSO 状态 | REQ-0011：`oidcAuthEnabled` 字段 + security-enabled 视为已配置 | 已实施 |
| 用户归属 MCP OAuth2 接入 | 维护者报告 MCP Basic Auth/其他认证占位；BASE 逐文件证据与目标客户端版本待闭环，本轮未复测 | 具体产品实现本轮未核验，不作为方案依据 | 标准 DCR pending→用户确认绑定 owner；MCP OAuth2-only 发现/Bearer 与用户资源授权，边界及验收见 mcp-oauth-integration.md | 规划已接收，未实施；消费仓/行为证据/资源权限契约动刀前补齐 |
| SCIM | 无（`ProblemFormatExclusion.java` javadoc 明言归 EE） | 有 `[src+docs]` | —（EE 产品功能） | 不补足 |
| 服务账号/API token | 无 | 有 `[docs]` | 机器身份走 OIDC JWT（R-EE-RBAC §3） | 不补足 |

### B. 授权与访问控制（授权线）

| 能力 | OSS 行为 | EE 行为 | 补足方式 | 状态 |
|---|---|---|---|---|
| 端点级认证门 | 无过滤器链（见 A）。OSS 主源码零授权钩子（无 SecurityRule/intercept-url-map 类，2026-10-07 复扫） | 规则链 `[docs]` | 部署面：micronaut-security `intercept-url-map`（`/**→isAuthenticated()`）。生效前提 = 认证链 jar 进镜像（R-CLASSPATH-MERGE 前置） | 部署面（kestra-oidc-provider 侧） |
| RBAC | OSS 零授权钩子。EE IAM API 面（users/roles/permissions/groups/service-accounts/me）在 vanilla 实例全部 404 `[live]` ⇒ 判定面整体在 EE jar，无可解禁开关 | 资源×动作×namespace 绑定；五内置角色；三类主体（详见 r-ee-rbac.md §2） | 扩展仓 jar 提供 SecurityRule/Authorizer bean（S6）。预期零 overlay patch。需求文档：[docs/r-ee-rbac.md](r-ee-rbac.md) | **reserved** R-EE-RBAC |

## 3. 当前闭环视图

「阶段」只是优先级注记（AGENTS.md §0-3）。一切移除/触发条件形态绑定。

```
认证线（OIDC 部署形态；范围裁定：MCP 面除外）：
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
| R-CLASSPATH-MERGE | 通道② jar 承载机制（S6）。已立案待实施；选型 b + 定位裁定 2026-10-07。JVM 语义三组实证与设计约束见机制文档 §4 | 实施指令（认证链 jar 与 R-EE-RBAC 的共同前置） | 构建期仅注入 manifest Class-Path 条目元数据（jar 一律运行时挂载——构建期零外部扩展 jar）。manifest 条目 = 镜像↔部署契约。加 OQ2 剩余实证（bean 索引可见性）。零 patch 文件 |
| R-EE-RBAC | 端点/资源级授权：扩展仓 jar 提供 SecurityRule/Authorizer bean | 消费仓指名（kestra-oidc-provider 侧或未来授权扩展仓）+ 行为证据 + R-CLASSPATH-MERGE 落地 | 外部 classpath jar（S6）。预期零 overlay patch。实证含 SecurityRule 从 jar 注册。展开文档：[docs/r-ee-rbac.md](r-ee-rbac.md) |
| R-OIDC-SERVER | OAuth2/OIDC 授权服务器（Micronaut 生态标准实现，内嵌 webserver 形态）。**实施中：REQ-0100~0130 已落地本地全绿（2026-10-09）**；2026-10-07 裁定：预留扩展点（patch 路线）——协议稳定性 + 实现标准性 ⇒ 大粒度仍为薄层（新文件为主，BASE 升级冲突面小）；区别于 jar 路线的外部扩展实现；体现「overlay 先行，jar 路线跟随」模式 | 实施指令（维护者；不绑外部时序——基本原则） | patch 集（授权码流/PKCE/discovery/JWKS/token/client 与用户存储等，按 §3 需求对齐拆分）。**前置裁定（2026-10-07）**：② 链一体化进 patch（`kestra-auth-chain` 契约退役；外部 IdP 场景走内置链配置）；③ 持久化 = 同 datasource 新表（postgres 起步，migration 进 patch——源码级 MigrationScript bean，F2 自动执行；h2/mysql 留待需求）。四项前置全部闭合（2026-10-07）：① 宪章修订 ② 链一体化 ③ 新表 postgres ④ 安全清单即验收基准。**展开文档（裁定/证据/剥离清单/安全清单/实施顺序）：[docs/r-oidc-server.md](r-oidc-server.md)**；④ **测试先行门（2026-10-07 增，安全敏感裁定）**——CI 增定向测试步（`:webserver:test --tests` 包前缀过滤，不跑上游全量）+ 镜像级 OIDC 流程黑盒（discovery/授权码+PKCE/token/JWKS/refresh/MCP 动态注册）；安全专项清单（redirect_uri 精确匹配、code 一次性、PKCE、alg=none 与混淆拒绝、JWKS 轮换、secret 哈希存储与日志不泄露、匿名面最小化、vanilla 回归）动刀前先评审；每需求 patch 与其测试同批落仓、门绿为 DoD；`[dsh]` 13/13 安全面测试可作移植底稿 |

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
