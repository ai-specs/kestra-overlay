# R-EE-RBAC：OSS 上的外部细粒度授权能力（需求文档）

> **状态**：reserved·已细化（2026-10-07 立项细化；正式开工仍需 AGENTS.md §2 入口 B 四要件齐备）。
> **归属**：`docs/oss-ee-gap.md` §2-B 行 / §4 登记簿 R-EE-RBAC 行的展开文档。
> **证据分级**：`[src]` = BASE（v2.0.5 @ 172dd0f37）源码；`[live]` = 2026-10-07 本地 vanilla
> 实例（kestra:v2.0.5-no-plugins，Basic Auth admin 会话）实测；`[docs]` = kestra.io 官方文档。
> **一句话**：让任何下游能以 EE 同构方式（外部组件 + 配置）在 OSS 上获得**每请求
> (资源， 动作， namespace) 级**的授权判定能力——补的是**授权判定钩子**这个架构能力，
> 不复刻 EE IAM 产品面。

## 1. 背景：OSS 实测现状（为什么需要它）

`[live]` 2026-10-07 对 vanilla v2.0.5 实测（API base 先经 `/api/v1/main/flows/search`→200
校准会话有效；`/configs` 真实路径为 `/api/v1/configs`，MiscController `@Controller("/api/v1")`）：

| 探测 | 返回 |
|---|---|
| `GET /ui/main/admin/iam` | EE 推销页（标题+一段介绍+Contact Sales/Learn more→kestra.io/docs/enterprise/auth） |
| `GET /api/v1/configs` | 200：`edition:"OSS"` |
| `GET /api/v1/{users,roles,permissions,groups,service-accounts,me}`（含 `/main/` 变体） | **全部 route-miss 404** problem+json |

`[src]` OSS 主源码**零授权钩子**（webserver/core 无 SecurityRule/intercept-url-map 类，
2026-10-07 复扫）；认证过滤器链不在 OSS 构建（`webserver/build.gradle:25` 仅
micronaut-security-csrf，差异表 §1-S6）。⇒ EE 的 IAM **不是「OSS 有端点但门控 403」**
（区别于 MCP authType 那类点门控），而是**整个控制器/判定面都在 EE jar 里**——OSS 侧
没有可解禁的开关，只能从外部叠加。

## 2. EE 参照面（能力语义的对照基线；本需求**不照抄**其产品语义）

`[docs]` kestra.io/docs/enterprise/auth/rbac（2026-10-07 抓取；`[docs-rbac]` = 该页原文，
`[docs-sa]` = …/auth/service-accounts 子页）。**2026-10-07 官网一致性审核**：资源清单、
动作与无通配符、绑定级联/不可变/「角色须绑定」、五内置角色——四组论断与该页逐项一致；
两处已按审核修正（服务账号细节改标 `[docs-sa]` 归属；管理 REST 与 deny→403 官方页
未写明，已改注为本需求自定行为）。

- **权限原子 = 资源 × 动作**。核心 namespace 级资源：FLOW、EXECUTION、TRIGGER、
  NAMESPACE、KVSTORE、SECRET、CREDENTIAL；tenant 级资源：DASHBOARD、BLUEPRINT、APP、
  TESTSUITE、ASSET、MCP_SERVER、COPILOT、USER、GROUP、ROLE、BINDING、SERVICE_ACCOUNT、
  INVITATION、AUDITLOG、POLICY、SYSTEM_SETTINGS、TENANT_SETTINGS。通用动作
  VIEW/LIST/CREATE/UPDATE/DELETE + 资源专属（如 FLOW:EXECUTE、EXECUTION:KILL/REPLAY/
  ACCESS_OUTPUTS、USER:IMPERSONATE）。**无通配符语法**。
- **绑定（binding）= 角色 ↔ 主体（用户/服务账号/组），scoped 到 namespace 且向子级
  级联**（绑 `prod` 覆盖 `prod.engineering`）；绑定**不可变**（只能删除重建）。
  「角色本身不授予任何东西——必须经绑定附着到主体」。组绑定把权限授予全部成员，
  删组只剥权限、成员保留。
- **内置角色 5 个**（Instance Owner 可另建自定义角色）：Admin（全资源全动作）/
  Developer / Editor / Launcher（执行系动作，无 flow 写）/ Viewer（只读+EXPORT）。
  Instance Owner 是**独立用户类型**（跨 tenant 管理，无 flow/execution 访问）——与
  Admin（tenant 级角色）不是一回事。
- **服务账号**：与用户同等接收角色绑定（「treated as users when binding role
  assignments」`[docs-rbac]`）；「无密码、无 UI、仅 API token 认证」的细节出自
  service-accounts 子页 `[docs-sa]`，非 RBAC 页。
- **SSO 默认角色**：可为经 SSO 新加入的用户配置自动指派的默认角色 `[docs]`
  （对本需求 ③ 层的角色映射设计是直接参照：OIDC claim → 角色可配置化）。
- 管理面：IAM UI / SCIM / Terraform / 流程内 IAM 任务 `[docs-rbac]`（官方 RBAC 页另链
  「Permissions reference」给出资源↔端点映射；**未写明管理 REST 与 deny 的 HTTP 语义**，
  本需求 §3 的 403 problem+json 是自定目标行为，不归因于官方宣称）；
  impersonation（USER:IMPERSONATE，Instance Owner 可对用户执行）用于验证生效权限。

## 3. 目标能力（需求本体）

在 OSS 镜像上（本仓 patch 集 + 扩展仓 jar + 部署配置的组合形态）：

1. 任一**已认证**主体的每个 HTTP 请求（webserver API 面）可被**外部授权组件**按
   **(资源， 动作， namespace)** 判定 allow/deny；
2. deny → **403 problem+json**（复用上游错误管线，不裸 403）；未认证 → 401（API 客户端）
   / 登录重定向（浏览器）——与 EE 语义一致；
3. 判定所需的**角色/权限模型、主体-角色映射由扩展仓自带**（模型自定，不要求复刻 EE
   的五角色/binding/级联语义）；机器身份走 OIDC JWT（差异表 §2-A-3 替代路线），
   不建 EE 式 token 库。

## 4. 非目标（明确不做——AGENTS.md §2 拒绝清单约束）

| 不做 | 理由 |
|---|---|
| 用户/组/服务账号/角色/绑定管理 CRUD（含 REST+UI+邀请流） | EE 产品功能 |
| SCIM 目录同步 | EE 产品功能（差异表 §2-A-4 不补足） |
| 审计日志 | EE 产品功能（差异表 §2-E 不补足） |
| impersonation | EE 产品功能 |
| EE 式 API token 签发/管理 | 机器身份走 OIDC JWT（§2-A-3 已裁定） |
| UI 按钮/菜单按权限隐藏 | ui 面（禁收；归 R-UI-EDITION-GATE 按需，扩展仓前端包路线） |
| 照抄 EE 五内置角色/binding 不可变/级联语义 | 业务语义归扩展仓设计 |

## 5. 交付分层与归属（EE 同构三通道）

| 层 | 内容 | 归属 | 通道 |
|---|---|---|---|
| ① | 扩展 jar 进镜像的承载机制 | **本仓骨架**（R-CLASSPATH-MERGE，已立案待实施，`docs/extension-mechanisms.md` §4） | ② 前置 |
| ② | 认证链（micronaut-security）+ `intercept-url-map` 全局认证门（`/**→isAuthenticated()`） | kestra-oidc-provider jar + 部署配置 | ②+④ |
| ③ | 细粒度判定：micronaut-security `SecurityRule`（或等价 Authorizer）bean，实现 (资源，动作，namespace) → allow/deny | 扩展仓 jar（角色模型在此层） | ② |

依赖链：**①→②→③**，逐层可验收（② 即差异表 §2-B-1 的最小端点门）。

## 6. overlay patch 面

**预期零 patch**（OSS 无授权钩子可激活——§1 证据；判定组件全部经 classpath jar 进入）。
唯一例外条款：实证发现**绕过过滤器链的死角**（webhook 端点、SSE/MCP 流式端点等
不经标准 filter 链的路径）时，按 AGENTS.md §2 入口 B 收**最小激活 patch**（须有消费
扩展仓+行为证据+差异表行）。

## 7. 前置与触发条件（形态绑定，非客户阶段绑定——AGENTS.md §3-6）

- 前置：R-CLASSPATH-MERGE 落地（jar 承载）；
- 触发（开工要件）：① 指名消费扩展仓（plugin-apps-harness 或 kestra-oidc-provider）；
  ② 行为证据（缺授权时哪个端点/页面/流程暴露）；③ 最小面声明；④ 差异表 §2-B 行
  （已存在，本文即其展开）。

## 8. 验收判据（可测；在 ①②③ 全部落地后执行）

```
无 token    curl POST /api/v1/main/flows            → 401（或浏览器 307 登录重定向）
低权限 JWT  curl POST /api/v1/main/flows            → 403 problem+json
低权限 JWT  curl GET  /api/v1/main/flows/search     → 200（只读放行）
高权限 JWT  curl POST /api/v1/main/flows            → 2xx（业务结果）
namespace 边界：低权限对 {ns-allowed} 可写、对 {ns-denied} 403（由扩展仓角色模型定义）
回归：无认证链部署（不装 ②③）行为与 vanilla OSS 逐字节一致（本仓 patch 不引入授权行为）
```

## 9. 风险与开放问题

- **OQ-RBAC-1**：SecurityRule/Authorizer bean 从外部 classpath jar 注册的端到端实证未做
  （随 R-CLASSPATH-MERGE 实施步骤 2 一并闭环；F2：bean 发现=启动期，须带 micronaut
  注解处理索引）。
- **OQ-RBAC-2**：过滤器链死角清单（webhook/SSE/MCP 流）未扫——开工前以 BASE 源码
  `@Filter/@Controller` 路由盘点补齐。
- **OQ-RBAC-3**：与 CSRF/SecurityFilter 顺序（micronaut SecurityFilterPhase）协同未实证。
- EE 未来 release 的 RBAC 语义变化不影响本需求（我们不复刻其语义）；BASE 升级复扫
  仅核对 §1 的「OSS 零钩子」事实是否仍成立（差异表 §5 命令集覆盖）。

## 10. 证据清单（复现）

```bash
# [live] 实测（Basic Auth admin 会话；浏览器或 curl -b）：
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
