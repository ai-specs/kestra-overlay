# R-OIDC-SERVER：内置 OAuth2/OIDC 授权服务器（需求与实施准备文档）

> **状态**：reserved·实施准备就绪（2026-10-07）。唯一剩余门 = 前置④安全清单定稿。
> **归属**：`docs/oss-ee-gap.md` §2-A/§4 R-OIDC-SERVER 行的展开；宪章依据 AGENTS §0 归属
> 例外、§2 三处例外、§3-7、§4 测试同批。
> **一句话**：以 patch 路线在 webserver 内内置 OAuth2/OIDC 授权服务器 + 认证链（一体化），
> 让 kestra 无需外部 IdP 即具备完整 OIDC 认证；外部 IdP 场景走同一内置链的配置。

## 1. 裁定记录（全部 2026-10-07，维护者）

| # | 裁定 | 依据 |
|---|---|---|
| 路线 | 定位为预留扩展点，**patch 路线**（区别于 jar 路线的外部扩展实现） | 协议稳定 + 实现标准 ⇒ 大粒度仍为薄层；「overlay 先行，jar 路线跟随」 |
| 前置② | **链一体化**：认证链与服务器同进 patch；`kestra-auth-chain.jar` 契约行已退役；外部 IdP 场景由内置链经配置指向 | fork 实证（同模块）；上游 M 面 OIDC 相关仅 MiscController=REQ-0011 |
| 前置③ | **持久化 = 同 datasource 新表（postgres 起步）**；migration 进 patch（源码级 MigrationScript bean + SQL 成对）；h2/mysql 留待需求 | fork 实证（19 个 postgres migration）；Testcontainers 真 PG 测试形态 |
| 前置① | 宪章修订已落地（commit `021ba1b`）：§0 归属例外/§2 三处例外/§3-7/§4 测试同批/§8-1·2 注记 | 防实施期 agent 读旧条款出幻觉 |
| 前置④ | **待定稿**：§5 安全清单评审稿 v1 | 安全敏感功能测试先行 |

## 2. fork 参考协议（会话内维护者解禁，用途限定）

- **路径**：`/Users/xuybin/dsh-monorepo/app-kestra`（仅此子模块；其余 dsh-monorepo 不读）。
- **归因口径**：merge-base `f6dbbb49fe02ac18d2be88419df33083cf8a7256`（相对
  `upstream/develop`）——fork 定制 diff 为唯一事实源（AGENTS §5.2；全量 diff 混上游演进，
  陷阱 #6）。
- **纪律**：只作 `[dsh]` 证据与移植底稿，**不作路线图**；移植后漂移核对（§7）；
  判断依据只落差异表行 + 机制证据。

## 3. fork 证据摘要（R-OIDC-SERVER 实施底稿）

**形态**：顶层 `oidc-provider/` 模块 = 43 主文件（`io.kestra.oidc`：10 controllers +
11 services + 19 migration bean + config）+ 12 测试文件。fork 用 settings.gradle 模块
include 装配——**我们不采用**（trap-#1）：patch 路线直接进 webserver 模块，零 include。

**上游 M 面（OIDC 相关）**：仅 `MiscController` = REQ-0011（本仓已实施）⇒ patch 化的
M 面预估 ≈ 零，全部为新文件。

**类清单**（controllers）：`OidcDiscoveryController`（RFC 8414/discovery）、
`OidcProviderController`（authorize/token）、`OidcLoginController`（UI 登录）、
`OidcUserAdminController`、`OidcAuthorizationExceptionHandler`（未认证→登录重定向）、
`OidcRedirects`；（services）：`OidcAuthorizationCodeService`/`OidcClientService`/
`OidcJwkService`（JWKS）/`OidcSessionService`/`OidcTokenService`/`OidcUserService`/
`NimbusHttpAdapter`。

**依赖清单**（→ webserver/build.gradle 增 ~4 行，宪章 §2 唯一例外）：
`com.nimbusds:oauth2-oidc-sdk:11.38.2`、`org.mindrot:jbcrypt`、
`io.micronaut.security:micronaut-security-oauth2`、`micronaut-security-jwt`。

**持久化**：19 个 postgres migration（用户 schema、client〔含 public/active〕、machine
identities、role assignment、secret schema、多个 redirect 修正）；bean 继承
`AbstractSQLMigrationScript`，bean+SQL 成对。

**测试底稿**（移植核对，缺则补）：`OidcAuthorizationCodeFlowTest`/
`OidcClientCredentialsFlowTest`/`OidcIntrospectionTest`/`OidcJwtSignVerifyTest`/
`OidcClientServiceTest`/`OidcUserServiceTest`/`OidcUserAdminServiceTest`/
`OidcSessionServiceTest`/`OidcBearerAuthFilterTest`/`OidcLoginControllerTest`；基建
`OidcPostgresTestBase`（Testcontainers 真 PG + 施放生产 migration）。
另 webserver 侧 `DshAdminAuthorizerTest`/`DshNativeEndpointGuard*Test` 属授权线
（R-EE-RBAC 未来底稿，不随本项目移植）。

**剥离清单**（不移植，头部「手工适配」须声明）：`DshSecretAdminController`/
`DshSecretService`/`PostgresSecretStore`/`DshNamespaceService`；`OidcRedirects` 的客户
专属 redirect；migration 中 dsh 专属（dsh-ui-redirect/dsh-pc-web×2/nacos-logout/
tailscale-nipio/dsh-secret×2）；**MCP 面（`OidcMcpOAuthController`/
`OidcMcpBearerAuthFilter`——范围裁定 MCP 除外）**；AI 保留面。

## 4. 持久化设计（前置裁定③展开）

须持久：**用户、client 注册、JWKS 签名私钥**（重启换钥 = 已发 token 全失效 + 客户端
JWKS 缓存撕裂；轮换走双钥并存期）。免持久：access token（JWT 无状态）、auth code
（短命，单机内存）。表结构以 fork migration 为底稿，剥离 dsh 专属后按需求拆分。

## 5. 安全专项清单（评审稿 v1——**前置④，待维护者定稿**）

| # | 类别 | 用例 | 来源 |
|---|---|---|---|
| A1 | 协议流 | 授权码流全链（discovery→authorize→token→userinfo） | fork 移植 |
| A2 | 协议流 | PKCE（public client 强制；错 verifier 拒绝） | fork 核对，缺则补 |
| A3 | 协议流 | client 凭证流 | fork 移植 |
| A4 | 协议流 | token introspection | fork 移植 |
| B1 | 密码学 | JWT 签发/验签 | fork 移植 |
| B2 | 密码学 | `alg=none` 拒绝、算法混淆攻击拒绝 | 新增 |
| B3 | 密码学 | JWKS 轮换（双钥并存期，旧 token 不撕裂） | 新增 |
| C1 | 凭证 | client secret 校验失败 401（不泄露存在性） | fork 核对 |
| C2 | 凭证 | 口令 bcrypt 哈希存储（库内无明文断言） | 新增 |
| C3 | 凭证 | 日志与错误响应不泄露 secret/code/token | 新增 |
| D1 | 会话 | auth code 一次性（重放拒绝）+ 短 TTL | fork 核对 |
| D2 | 会话 | session 生命周期 / logout | fork 移植 |
| E1 | 重定向 | `redirect_uri` 精确匹配（开放重定向防护，含子串/后缀伪装变体） | 新增（fork 有 self-redirect 修正 migration，测试固化待核对） |
| F1 | 暴露面 | 匿名可达面最小化（discovery/JWKS/authorize 匿名；token 需 client 认证；管理端点 401） | 新增 |
| F2 | 回归 | 未启用该功能时行为与 vanilla 逐字节一致 | 新增（本仓铁律） |
| F3 | 回归 | REQ-0011 语义保持（内置服务器形态下 `oidcAuthEnabled` 取值） | 新增 |
| G1 | 基建 | 全部测试跑 Testcontainers 真 PG + 生产 migration | fork 基建 |

## 6. 实施顺序（定稿后执行）

1. 临时实施文档（仓外，完成即删）：patch 需求拆分（discovery/授权码流+PKCE/token+
   JWKS/用户与 client 管理/链与登录/M-Face 集成）、文件清单、测试映射、顺序。
2. §5.3 增量提交法逐需求出 patch（依赖行随首个需求 patch；每 patch 头部按 §3-7 四条件）。
3. CI 定向测试门（`--tests` 包前缀）+ apply 链 + 镜像级黑盒；全绿为 DoD。
4. 差异表 §2-A/§4、manifest、README 运行线随实施状态同步。
