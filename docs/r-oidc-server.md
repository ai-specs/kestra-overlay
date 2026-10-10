# R-OIDC-SERVER：内置 OAuth2/OIDC 授权服务器（需求与实施准备文档）

## 0. 当前认证裁定与实施门（2026-10-09，优先于旧记录）

**最新用户归属裁定（维护者多轮澄清，优先于下述已交付记录）**：选定“DCR 返回
短期 pending client_id→浏览器登录确认→原子绑定用户 owner→授权码/token→以该
用户调用 MCP”。正式动态 client 不共享、无管理员特例；另一用户不得授权、使用
或管理。拒绝删除 pending，超时清理；额度分 pending 全局与正式用户维度。
完整可行性、标准衔接、抢占边界、数据隔离及实施门见
[面向集成方的 MCP OAuth2 文档](mcp-oauth-integration.md)。这是待实施方案；现有
REQ-0134 仅全局 public DCR，不具备 owner、确认页或多用户 MCP 隔离。
MCP 认证面已由维护者重新接收为下一阶段范围（OAuth2-only，删除 Basic Auth），
不得将旧“MCP 全面除外”覆盖此裁定；具体动刀仍须消费仓/BASE 行为证据与验收定稿。
**能力/资源授权最新分层**：本仓预制 MCP 资源大类 read/write/delete scope 门，
write 不含 delete，用户二次授权只能收窄，执行门独立于外部 RBAC。R-EE-RBAC
启用后必须覆盖全部现有 MCP 工具/子操作/异步执行，与 REST 统一主体、资源、动作
判定；scope 与 RBAC 同时允许才执行，组件异常失败关闭。具体权限模型留在扩展仓。

**REQ-0134 动态 public client 注册（维护者接收）**：标准 OAuth2 动态注册
RFC7591/OIDC Registration，不新增 MCP 专属端点。公开 MCP/桌面/浏览器消费方
不持有 secret：POST `/oidc/register`，`token_endpoint_auth_method=none`，仅
authorization_code/refresh_token、response_type=code、openid/profile/email，强制
PKCE S256，随机不可预测 client ID，返回 201、无 client_secret，discovery 广播
registration_endpoint。注册以 `kestra.oidc.registration.enabled=true` 显式启用，
默认关闭；允许匿名注册时部署侧限制请求速率，服务端限制元数据长度、回调数和
注册总量（默认 1000，含现存 client，并发不能绕过），不信任客户端角色/租户声明。
回调仅 HTTPS 或 loopback HTTP（localhost/127.0.0.1/[::1]），禁止 fragment、
userinfo、通配符与非 loopback HTTP；精确回调匹配不放宽。元数据不得触发远端抓取。
首次初始化必须完成后才能注册，完成标记异常失败关闭。不交付 RFC7592 管理 API。
验收从生产首装路径开始：注册 public client→S256 登录授权→无 secret 换三件套→
userinfo，缺/错 verifier、空 challenge、非法回调/授权类型、quota/并发与关闭门拒绝。

**第三方验收缺陷收尾**：完成状态过滤器先于 setup body 绑定，空/坏 body 的 POST
统一 404；显式空 code_challenge 返回 400（缺席仍遵守 confidential/public 规则）；
部署白名单健康端点使用 `/ping`；README 区分 IdP oidc_session 与应用 JWT/Bearer。

**REQ-0133 首次安装引导（维护者授权，实施前契约）**：空目录首次访问 UI 进入
`/oidc/setup`，设置用户名、显示名、邮箱和密码；存入 OIDC 用户目录（bcrypt），
同时按配置注册本实例 UI confidential client，随后进入完整 OIDC 登录链。
UI client 名称默认 `kestra`，ID/secret 从 Micronaut OAuth2 客户端配置取得，回调
由公开 issuer + `/oauth/callback/<name>` 推导；不预置公共默认密码或固定 secret。
镜像支持 `KESTRA_OIDC_BOOTSTRAP_USERNAME`、`KESTRA_OIDC_BOOTSTRAP_PASSWORD`、
`KESTRA_OIDC_BOOTSTRAP_EMAIL`、`KESTRA_OIDC_BOOTSTRAP_NAME` 环境变量跳过表单；
username/password 必须成对，email/name 可选。仍须配置 UI client ID/secret/issuer。
变量只用于首次初始化，重复启动不覆盖密码/client；初始化完成状态持久化，即使
删空用户也不重新开放匿名 setup。已有用户部署视为已初始化，保留账号与 client。
初始化事务涵盖账号、bcrypt 凭据、UI client 和完成标记，数据库串行锁防并发首建；
失败回滚、错误不回显密码/secret；已有冲突 client 不可静默覆盖。
表单 POST 必须校验短期 CSRF token 与同源请求，初始化后 setup GET/POST 关闭。
验收同批：空库引导、环境变量跳过、坏/部分配置、并发一次成功、重启不覆盖、
完成后拒绝 setup、真实 OIDC/token/UI 登录与刷新；镜像不得依赖人工 SQL 才能首登。

**REQ-0133 再审加固（维护者追加，实施前）**：首次初始化身份同时绑定数据库标记
与独立持久化安装凭据（默认 `/app/storage/.oidc-installation`，部署侧卷）。二者
任一存在均不得重新创建首个账号；身份不一致、凭据损坏或凭据存在但数据库标记缺失
一律失败关闭，不退回匿名引导。数据库标记存在但凭据缺失时只重建对应凭据，不改账号。
写凭据在数据库提交之前完成；中断遗留凭据表示待人工恢复，不能自动重启初始化。
凭据格式/大小/符号链接/权限检查；CSRF、Origin、并发串行与原子事务继续强制。
可用 `KESTRA_OIDC_SETUP_ALLOWED=false` 显式封闭网页首装（环境变量初始化仍可用）；
完成后必须持久保存独立凭据卷，禁止将删除数据库标记视为重新安装操作。
验收增加：删除数据库标记、删除凭据、损坏/替换凭据、并发重入、完成后重新 POST、
失败事务留下锁存凭据、重启与环境变量再次注入均不激活。仅凭一个可删数据库字段
不得决定安装是否可用。拥有数据库和凭据卷的同时管理权限仍属于部署信任边界，
需由部署权限与显式禁用配置封闭；镜像不能声称能抵抗同时重置全部持久化状态。

维护者裁定：OIDC 模式下完整关闭 Basic Auth 认证链。后端过滤器、凭据登录/退出、
前端路由守卫、401 跳转、setup 引导与退出统一使用 OIDC；不兼容 BASIC_AUTH 或
kestraBasicAuthenticated，不伪造旧登录标志。OIDC 未启用时保留 vanilla 行为。
内置 OIDC 登录页可以复用上游 Basic Auth 页面外观，提交仍验证 OIDC 用户目录，
随后完成真实授权码/PKCE/token/callback。认证主体由服务端验证，前端不得自证登录。

UI patch 例外已写入 AGENTS §2：仅限本认证链替换与登录外观，保留其他 BASE UI。
实施需求 REQ-0132（认证模式替换）；归属 = R-OIDC-SERVER，协议基础设施 patch 路线。
上次 CI 37911602095 全绿仅证明首轮 HTTP 流程，未覆盖刷新/导航；不得引用其作为
完整前端认证已完成的证据。当前问题已证实：BASE UI 忽略 oidcAuthEnabled，
仅检查 Basic Auth 标志；框架重读 ID token 时调用 userinfo 返回 401 也须闭环。

实施顺序：先固定本文/差异表/机制/README/manifest 的新契约，再在 BASE 开发树
按增量提交法实现；实现与验收同批生成 patch；重放全部 patch 后测试与构建。
验收必须包括：匿名 UI/API 拦截、坏凭据拒绝、用户名密码登录、PKCE/state/nonce、
真实 token 签发、首次 UI 渲染、刷新 dashboards、再次导航、认证 API、过期/无效
cookie 后重认证、退出同时清应用与 IdP 会话、退出后 UI/API 拒绝；OIDC 模式
Basic Auth 登录/退出端点不得认证或改变会话，旧 Basic Auth cookie 不得放行。
UI 认证检测通过服务端受保护端点，401 后进入 OIDC 客户端；避免 SPA Basic Auth 登录页。

REQ-0133 实现引导与环境变量一次性初始化；旧 `kestra.oidc.users` 预留模型不使用。
首个 UI client 自动按客户端配置注册，无需人工 SQL。用户管理 API 仍待独立实施。

REQ-0132 实施证据：UI 不再在 OIDC 模式检查旧标志，受保护 `/configs` 成功后
更新内存状态；刷新重新验证，401 进入框架 OAuth2 客户端。旧 API 登录/退出/setup
由服务端拒绝；内置 logout 同时撤销 IdP 会话并清 JWT cookie。新增后端禁用测试，
前端测试验证旧标志不能认证；黑盒覆盖刷新、导航、旧端点、无效 cookie、退出。
ego-browser 已实测无旧标志时 dashboard 刷新、Flows 导航及 API 200；logout 后
重新出现 OIDC 登录表单且 API 401。此前 userinfo 401 是框架对 ID token 尝试
access-token userinfo 验证的回退日志，本轮有效 JWT 刷新实测仍通过，不放宽 userinfo。

> **状态**：首批 patch 已实施并本地全绿（2026-10-09，REQ-0100/0110/0120/0130；
> 8 测试类 36 用例，Testcontainers 真 PG + 验证树 5-patch 重放 + executableJar 全绿）。
> 浏览器链修复（2026-10-09）：REQ-0120 统一 `from` 回跳；REQ-0130 登录 POST 后
> 303 转 GET、浏览器经配置进入框架 OAuth2 客户端；REQ-0131 内置 issuer 的 discovery
> 直接复用生产元数据，避免启动监听前本机 HTTP 请求失败。原版 UI 必须随 jar 打包。
> REQ-0132 本轮全重放：44 后端用例、2 前端用例、UI 构建与 executableJar 全绿。
> 剩余：REQ-0140（用户管理端点 + F1/C3/F2 专项）。浏览器链最终验收以新 CI 为准。
> 本轮本地证据：6-patch BASE 重放、42 定向用例、原版 UI 构建、executableJar，
> 协议黑盒 30 PASS；UI/OIDC HTTP 链黑盒全绿；ego-browser 实测 localhost:8080
> 输入 tester 后显示 Overview，认证 cookie 请求 `/api/v1/configs` 返回 200。
> REQ-0133 同批增加 10 个首装/环境变量/事务并发/CSRF 用例（总 54），镜像黑盒
> 分别从空库走真实安装表单与环境变量跳过；真实 OIDC 登录/刷新/导航/退出/重启
> 验收。CI Chromium 直接填写首装表单，测试不再用 SQL 预置首个用户与 UI client。
> 再审加固后总 61 后端用例：删除数据库标记/用户、删除或替换文件、权限/符号链接、
> 中断事务锁存、显式封闭网页首装。镜像门额外验证容器重建后注入不同初始化账号无效，
> 删除数据库标记返回 500、删除文件只恢复原身份、替换文件失败关闭。
> 维护者追加一致性要求：旧协议镜像黑盒也改为环境变量生产初始化，移除用户/client
> SQL 预置；UI 黑盒分别由 Chromium 安装表单或环境变量从空库初始化。保留的 SQL
> 仅用于读取证据与模拟删标记攻击，不用于绕过首装。README 提供 kestra.environment
> 直接填值示例，不再包含首次手工 psql 指南。
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
| 前置④ | **已闭合**：§5 安全清单即验收基准（测试先行铁律，随各需求同批落地） | 维护者「写好 CI 测试再实施」 |

## 2. fork 参考协议（会话内维护者解禁，用途限定）

- **路径**：`/Users/xuybin/dsh-monorepo/app-kestra`（仅此子模块；其余 dsh-monorepo 不读）。
- **归因口径与用途边界（2026-10-07 修正）**：merge-base `f6dbbb49fe02ac18d2be88419df33083cf8a7256`
  （相对 `upstream/develop`）圈定 fork 定制面。**两基分叉**（v2.0.5 @ 172dd0f3 与该
  merge-base 互不为祖先，基间 webserver/core/cli/jdbc 演进 278 文件 +10595/-1628）⇒
  定制 diff **只作规格参考**（端点/职责/表结构/测试语义），**禁止直接 diff 成 patch**
  ——移植走 AGENTS §5.2「跨基移植规则」（漂移清单 + BASE 重写 + 逐文件核对，陷阱 #9）。
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

**依赖清单**（→ webserver/build.gradle 增 5 行，宪章 §2 唯一例外；漂移清单核定后由 4 行上调）：
`com.nimbusds:oauth2-oidc-sdk:11.38.2`、`org.mindrot:jbcrypt`、
`io.micronaut.security:micronaut-security-oauth2`、`micronaut-security-jwt`、
`io.micronaut.data:micronaut-data-connection-jdbc`（migration 走 DelegatingDataSource，
fork webserver/build.gradle 同款加法）。

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
`OidcMcpBearerAuthFilter`——首批移植时排除，后续 MCP 认证重新接收须重新推导）**；AI 保留面。

## 3.5 API 漂移清单（动刀前第一工件，2026-10-07 完成——方法见 §2 跨基规则）

**类级**（剥离 MCP/Secret/Namespace 面后，剩余移植面的上游依赖仅 3 类）：

| 依赖类 | v2.0.5 | 档 |
|---|---|---|
| `io.kestra.jdbc.migration.AbstractSQLMigrationScript`（19 个 migration bean 的基类） | 存在（jdbc 模块在用） | ✅ 直接可用 |
| `io.kestra.core.tenant.TenantService` | 存在（S2 桩，恒 `main`） | ✅ 可用（桩语义已知） |
| `io.kestra.core.serializers.JacksonMapper` | 存在 | ✅ 可用 |

归因注：`EncryptionService`/`EncryptionConfig`/`FlowMetaStoreInterface`/
`DefaultNamespaceService`/`QueryFilter`/`ArrayListTotal`/`McpServer(Cache)` 的引用
**全部来自剥离面**（`PostgresSecretStore`/`DshSecretService`/`DshNamespaceService`/
`OidcMcp*`）——剥离后不进入移植面。

**框架级**：

| 轴 | fork（develop 基） | v2.0.5 | 档 |
|---|---|---|---|
| Micronaut 平台 | 5.1.5 | **4.10.18** | ⚠️ 代际适配轴（主要注意力所在） |
| Jackson | 平台是 Jackson 3，但**本模块 import 全部为 Jackson 2**（`com.fasterxml`，零 `tools.jackson`，实测计数 5+4） | Jackson 2 | ✅ 同代，无需改写 |
| micronaut-security import | 仅 3 个：`Authentication`/`AuthorizationException`/`JwtTokenGenerator` | 4.x 均有 | ✅ 稳定 API |
| micronaut-data | `DelegatingDataSource`/`Pageable` | 需加 `micronaut-data-connection-jdbc` 依赖（已入依赖清单） | ⚠️ 随依赖行解决 |
| 其余 Micronaut import | http/context/core/scheduling 稳定面（Controller/Filter/@Replaces/@Requires 等） | 4.x 同名 | ✅ |

**结论**：无 ❌ 档（无需替代实现）。主要适配注意力 = Micronaut 4↔5 的**行为差异**
（注解处理/bean 装配细节），由双锚验证兜底（§6 步骤 4：测试全过 + 逐文件漂移核对）。

## 4. 持久化设计（前置裁定③展开）

须持久：**用户、client 注册、JWKS 签名私钥**（重启换钥 = 已发 token 全失效 + 客户端
JWKS 缓存撕裂；轮换走双钥并存期）。免持久：access token（JWT 无状态）、auth code
（短命，单机内存）。表结构以 fork migration 为底稿，剥离 dsh 专属后按需求拆分。

## 5. 安全专项清单（**已闭合 = 验收基准**；各用例随所属需求 patch 同批落地，门绿为准）

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

1. ~~API 漂移清单~~ **已完成**（见 §3.5：类级全 ✅、框架级仅 Micronaut 4↔5 代际轴 ⚠️，
   无 ❌ 档；依赖清单由此定为 5 行）。
2. ~~临时实施文档~~ 见 `.work/impl-plan.md`（仓外，完成即删）。
3. **开发树重写**：`.work/dev` 树（v2.0.5）按 §5.3 增量提交法逐需求重写
   （来源标注：「参考 fork 实现逻辑重写（跨基）」；依赖行随首个需求 patch；
   头部按 §3-7 四条件）。
4. **本地全链循环到完美**：`scripts/local-ci.sh` 在 `.work/verify` 树重放 patch →
   定向测试（Testcontainers 真 PG，需 Docker）→ executableJar；双锚验证：安全清单 §5
   全用例过 + **逐文件**漂移核对（diff 归因于基差或剥离项，不留抽样）。
5. 本地全绿 → 组织 patch 提交推送 → 真 CI（定向门 + apply 链 + 镜像 + 镜像级黑盒）
   全绿为 DoD；差异表 §2-A/§4、manifest、README 运行线随实施状态同步。
