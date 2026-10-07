# OSS vs EE 架构能力差异表（kestra-overlay 立身依据）

> **为什么有这张表**：kestra-overlay 的使命是「立足上游具体版本（BASE pin）的架构能力，
> 补足 kestra OSS 相对 EE 故意阉割的**架构扩展能力**」——只补能力骨架（认证、扩展点
> 激活、授权判定挂钩），不复刻 EE 产品功能（审计日志、Kafka 队列等商业件）。
> 每一项补足决策（patch / 扩展仓 / reserved / 不补足）以此表为准；上游升级后必须复扫
> （§5 命令集，扫全仓、非测试面）。
>
> 证据分级：`[src]` = BASE（v2.0.5 @ 172dd0f37）源码证据（file:line）；
> `[docs]` = kestra.io 公开文档宣称（无源码证据）；`[dsh]` = dsh 项目实证；
> `[live]` = 本地 vanilla 实例实测。
> 本表 2026-10-07 由穷尽扫描生成（范围：全仓 24 个模块非测试源码 + ui/src edition 消费点
> + kestra.io/docs/oss-vs-paid），同日使命复审一轮（S9 缝隙类增补等）。
> **同日范围收窄（维护者裁定）：活跃范围仅 ① kestra-oidc-provider（不含 MCP 面）
> ② R-EE-RBAC（docs/r-ee-rbac.md）**。C~I 域（MCP/多租户/治理/运行面/插件治理/AI/产品
> 功能）的行、patch 0010/0020/0021/0022 与 4 条 reserved 已删除——全量调查与删除理由存
> git 历史（收窄前最后全量版本：commit 47b9d98）。重启任一域须按 AGENTS.md §2 入口
> 重新接收（先补本表行 + 客户证据）。

## 1. EE 的交付机制 = overlay 可用的架构缝隙（穷尽列举）

> 各缝隙的**生效原理**（要不要编译/重启/外部 jar）见 `docs/extension-mechanisms.md`（结论矩阵）。
> 结论先行：**EE 与 OSS 同 codebase，EE 以「classpath jar + license key」叠加交付**
> （`[docs]`「加 license 重启即升级」）。OSS 源码里处处是「为 EE 预留的挂接点」——
> 这些挂接点就是本仓与扩展仓的合法通道（上游商业利益保证其稳定：动了它们 EE 自己就挂）。
> 此表是**机制事实**（收窄后整体保留）：当前两个活跃事项都踩在 S6/S8/S9 上。

| # | 缝隙机制 | v2.0.5 源码证据 `[src]` | 当前使用 |
|---|---|---|---|
| S1 | `@Requires(missingClasses="io.kestra.ee.…")`：EE jar 在 classpath 时其 bean 顶替 OSS bean（全仓唯一注解实例） | `webserver/rooting/TenantAliasingRooter.java:19`（`TenantAliasingRooterEE`） | 无（多租户域已出范围；机制留档） |
| S2 | **OSS 桩 bean + EE `@Replaces`**（上游源码内显式文档化的「桩—替换」对）：① `core/tenant/TenantService.java:9` ② `core/runners/DisabledReusableInputsExpander.java:11` ③ `webserver/services/ai/agent/DefaultSystemPromptResolver.java:11` ④ `core/services/ConcurrencyLimitResolver.java:17` ⑤ `core/services/MaintenanceService.java:89`（Noop 桩 :91）⑥ `core/services/NamespaceService.java:22` | 同构通道实证：外部 jar 可 `@Replaces` 桩 bean（`[dsh]` 13/13 安全面全绿即此类） | 无活跃使用（各域已出范围；R-EE-RBAC 若走 Authorizer bean 亦属此类形态） |
| S3 | `EditionProvider` 判定注入（功能按 Edition 分叉） | `KestraContext.java:150`、`PluginAutoInstallService.java:89`、`McpServerController.java:144`、`ProblemFactory.java:39` 等（全部调用点见 §5 命令） | 无（REQ-0010 已随 MCP 面收窄删除，2026-10-07） |
| S4 | **按 distribution 声明的接口 bean**（OSS 明文「各发行版声明自己拥有的路径」） | `webserver/errors/ProblemFormatExclusion.java:12`（"the Model Context Protocol endpoints are Open Source, SCIM is Enterprise"） | 无活跃使用（distribution 声明缝隙的现成范例，留档） |
| S5 | `io.kestra.ee.*` 包名空间与分发过滤 | `PluginController.java:388,400,696`、`Makefile:85`、`core/models/ui/PluginDistribution.java:8` | 不使用（不分发 EE 插件） |
| S6 | **classpath jar 补 bean/过滤器链**（EE 的交付形态本身；框架级能力） | **安全链实证**：`webserver/build.gradle:25` 仅有 `micronaut-security-csrf`——认证过滤器链不在 OSS 构建中，OSS 的认证=自研 `BasicAuthService` cookie；EE 以 jar 补 micronaut-security 链 `[docs]`；dsh fork 的 webserver/build.gradle 对此**零定制**（安全依赖全在其自建 oidc-provider 模块）`[dsh]`；外部 jar 同包 `@Controller`/`@Filter` 可被扫描注册（fork 13/13 安全测试全绿）`[dsh]` | **当前两个活跃事项的主通道**：kestra-oidc-provider 的 webserver 侧认证链 jar + R-EE-RBAC 的 SecurityRule/Authorizer jar。**承载现状**：官方镜像 selfrun `-jar` 模式下外部 jar 只能构建期进 manifest（F1）——承载机制 = R-CLASSPATH-MERGE（§4，选型 b 已裁定，jar 可烤进或运行时挂载、缺席静默休眠）；IdP 进程部分独立成镜像不受影响 |
| S7 | 插件体系（`plugins/` 自动扫描、外部 jar 插件） | `core/plugins/`（RegistryScanner 等）；`PluginClassLoader extends URLClassLoader`（`PluginClassLoader.java:19`）——反射实例化、不进 Micronaut（F3），故 bean jar 装不进此槽 | 无活跃插件客户（注册表 `extensions.tsv`） |
| S8 | `Optional`/`BeanProvider` 注入缺席容忍（EE bean 缺席→OSS 默认行为） | `MiscController.java:72`（`Optional<BasicAuthService>`）、`DefaultStartupHook.java:25-39`、`KestraContext.java:149` | **REQ-0011 依赖此模式**（OIDC 部署下 BasicAuthService 缺席） |
| S9 | **protected 方法覆写点**（OSS javadoc 自述「EE 覆写此方法放行」的显式覆写缝） | ① `core/contexts/KestraBeansFactory.java:112-118` `ensureLogDataStoreAllowed()`（外部日志库门）② `webserver/services/ai/AiServiceManager.java:115-137` `createAiService()`（非 gemini 提供商即抛）③ `core/validations/validator/FlowValidator.java:204`（EE-only inputs；同款 `core/docs/JsonSchemaGenerator.java:170`） | 无活跃使用（日志库/AI 域已出范围；机制留档——同构通道：扩展仓子类 bean `@Replaces` 覆写，经 classpath jar） |

## 2. 能力差异总表（当前活跃范围：认证/身份 + 授权）

### A. 认证与身份（kestra-oidc-provider 主场）

| 能力 | OSS v2.0.5 行为 `[src]` | EE 行为 | 补足方式 | 状态 |
|---|---|---|---|---|
| 认证方式 | 仅自研 Basic Auth（`BasicAuthService` cookie）；**认证过滤器链不在 OSS 构建**（S6 证据） | SSO OIDC + SCIM + 服务账号/API token + impersonation `[docs]` | kestra-oidc-provider（IdP 独立进程 + webserver 侧认证链 jar，S6）+ REQ-0011（UI 引导激活）。**注意**：认证链 jar 的镜像内承载依赖 R-CLASSPATH-MERGE（未落地，见 S6 行与 §4） | 仓已立项；0011 已实施 |
| 登录引导 | `/api/v1/configs`（MiscController `@Controller("/api/v1")` + `@Get("/configs")`）仅暴露 `isBasicAuthInitialized`；Configuration 含 `edition` 字段（vanilla 实测 `edition:"OSS"` `[live]`） | 同端点由 EE 链给出 SSO 状态 | REQ-0011：`oidcAuthEnabled` 字段 + security-enabled 视为已配置 | **已实施** |
| SCIM 目录同步 | 无（`ProblemFormatExclusion.java` javadoc 明言 SCIM 归 EE） | 有 `[src+docs]` | —（EE 产品功能） | 不补足 |
| 服务账号/API token | 无 | 有 `[docs]` | 机器身份走 OIDC JWT（R-EE-RBAC §3 替代路线） | 不补足（不建 EE 式 token 库） |

### B. 授权与访问控制（R-EE-RBAC 主场）

| 能力 | OSS 行为 | EE 行为 | 补足方式 | 状态 |
|---|---|---|---|---|
| 端点级认证门 | 无过滤器链（见 A）；OSS 主源码零授权钩子（webserver/core 无 SecurityRule/intercept-url-map 类，2026-10-07 复扫） | intercept-url-map/规则链 `[docs]` | **部署面**：compose 的 micronaut-security `intercept-url-map`（`/**→isAuthenticated()`）——配置级缝隙，非 patch（fork 同形态 `[dsh]`）；**生效前提 = 认证链 jar 进镜像**（R-CLASSPATH-MERGE 前置） | 部署面（kestra-oidc-provider 侧） |
| RBAC（资源:动作、namespace 级） | **OSS 零授权钩子** + **EE IAM API 面（users/roles/permissions/groups/service-accounts/me）在 vanilla 实例全部 route-miss 404**`[live]`——判定面整体在 EE jar，OSS 无可解禁开关 | 有 `[docs]`（模型：资源×动作×namespace 绑定，五内置角色，三类主体——详见 r-ee-rbac.md §2 参照面） | 扩展仓 jar 提供 micronaut-security 的 SecurityRule/Authorizer bean（S6 通道），**预期零 overlay patch**。**需求已细化立案：[docs/r-ee-rbac.md](r-ee-rbac.md)**（目标能力/非目标/交付分层/验收判据/OQ 清单） | **reserved** R-EE-RBAC |

> **范围收窄移除的域（2026-10-07，墓碑注记）**：C MCP（含 UI edition 门控行）、D 多租户、
> E 治理与合规（policies/assets/可复用输入/审计）、F 可扩展性与运行面（Kafka 队列/维护模式/
> 并发分级/Quota/外部日志库等，含「缝隙开放」改口行）、G 插件治理（auto-install 澄清行）、
> H AI、I 产品功能（Apps/Dashboards/密钥/500 详情）。各域的判定、源码证据与「缝隙开放/
> 不补足」结论存 git 历史（47b9d98 及此前版本）；重启任一域按 AGENTS.md §2 入口重新接收。

## 3. 当前闭环视图（整体考虑）

> **「阶段」的语义**：客户迁移阶段只是**优先级注记**（AGENTS.md §0-3）；一切移除条件/
> 触发条件一律**形态绑定**（如「R-CLASSPATH-MERGE 落地后」）。

```
kestra-oidc-provider（不含 MCP 面）需要：
    认证链（A1←S6 jar，镜像内承载 = R-CLASSPATH-MERGE）
  + 登录引导（A2 = REQ-0011，唯一 patch）
  + 最小端点门（B1 = 部署面 intercept-url-map，生效前提 = 认证链 jar 进镜像）
R-EE-RBAC（docs/r-ee-rbac.md）需要：
    在上述认证层之上叠加 (资源, 动作, namespace) 每请求判定
  —— 交付分层（R-CLASSPATH-MERGE → 认证链+intercept-url-map → SecurityRule jar）
     与验收判据见该文档 §5/§8
```

## 4. reserved 登记簿（manifest.tsv 同步登记）

> 登记**收回规则**：仅「可能成为 overlay patch/构建面动作」的待激活点留在本簿；源码证据
> 表明**零 overlay 动作**即可补足的（纯 S2/S9 缝隙 + 扩展仓 jar）在 §2 对应行记「缝隙开放」
> 即可，不入本簿。触发条件一律形态绑定。

| rid | 扩展点 | 触发条件（形态绑定） | 预期形态 |
|---|---|---|---|
| R-CLASSPATH-MERGE | 通道②的镜像承载机制（EE 同构交付的核心缺口，S6）——**已立案待实施，选型 b 已裁定（2026-10-07 维护者确认）**；JVM 语义三组实证（缺席静默休眠/`.class` 字面量懒解析/主 jar 优先）与设计约束见 `docs/extension-mechanisms.md` §4 | 实施指令（是认证链 jar 与 R-EE-RBAC 的共同前置） | build.sh 构建产物 manifest Class-Path 注入（jar 可烤进镜像或运行时挂载，manifest 条目=镜像↔部署契约）+ OQ2 剩余实证（bean 索引可见性）；零 patch 文件 |
| R-EE-RBAC | 端点/资源级授权：扩展仓 jar 提供 micronaut-security SecurityRule/Authorizer bean | 消费扩展仓指名（kestra-oidc-provider 侧或未来授权扩展仓）+ 行为证据（§2-B 接收标准）+ R-CLASSPATH-MERGE 落地 | 外部 classpath jar（S6）；**预期零 overlay patch**（OSS 无授权钩子可激活，2026-10-07 复扫 + vanilla 实测 IAM API 全 404）；实证含 SecurityRule 从 jar 注册。**展开文档：[docs/r-ee-rbac.md](r-ee-rbac.md)** |

**已收回/移除的登记**（防重新立案，git 历史即归档）：
- `R-MIG-DSH`（2026-10-07 机制收回）：`MigrationRunner` 注入 `Collection<MigrationScript>`
  收集上下文**全部** bean（`core/migration/MigrationRunner.java:47-56`，INIT_SCRIPT_IDS 预留
  `0-init-ee`），扩展仓 classpath jar 自带 bean 即自动注册执行，**overlay 零动作**（机制结论
  见 extension-mechanisms F2）。
- `R-APP-ROUTER`、`R-NFH-ANCHOR`、`R-AI-PROVIDERS`、`R-UI-EDITION-GATE`（2026-10-07
  范围收窄）：apps/AI/UI 域出活跃范围，相应 patch 0010/0020/0021/0022 一并删除。其中
  R-NFH-ANCHOR 的触发对象（UiAppController 排除定制）随 0020 删除而消失。

## 5. 复现命令（证据纪律：结论必须可复现；BASE 树内执行）

```bash
# 在 BASE（patches/BASE 第 2 行 commit）checkout 的上游树内执行：
git grep -n "EditionProvider" -- '*.java' | grep -v /src/test/            # §1-S3 全部调用点
git grep -n "io\.kestra\.ee" | grep -v /src/test/                          # §1-S1/S5 + EE 交付痕迹
git grep -n "missingClasses" -- '*.java' | grep -v /src/test/              # §1-S1 注解实例
git grep -in "enterprise\|EE feature" -- '*.java' | grep -v /src/test/     # §2 源码文档化阉割清单（全量，含已收窄域）
git grep -n "overrides this\|overridden by\|Enterprise.*override" -- '*.java' | grep -v /src/test/  # §1-S9 protected 覆写缝
grep -n "micronaut-security" webserver/build.gradle                        # §1-S6 安全链缺席证据
# [live] vanilla 实例（Basic Auth admin 会话）：
curl -s http://localhost:8080/api/v1/configs | jq .edition                  # "OSS"（注意真实路径无 tenant 段）
for u in users roles permissions groups service-accounts me; do curl -s -o /dev/null -w "%{http_code} /api/v1/$u\n" http://localhost:8080/api/v1/$u; done  # 全 404 = IAM API 面不在 OSS
```

文档侧来源（2026-10-07 抓取）：kestra.io/docs/oss-vs-paid、kestra.io/docs/enterprise（auth/
auth/rbac/auth/service-accounts）。
升级 BASE 后：重跑上述命令 → 更新 §1/§2 → 逐行复审 §3 与 §4 触发条件。
