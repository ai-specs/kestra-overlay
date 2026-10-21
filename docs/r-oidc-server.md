# R-OIDC-SERVER：内置 OAuth2/OIDC 授权服务器（能力契约、实施依据与验收）

## 0. 当前认证裁定与实施门（2026-10-09，优先于旧记录）

### OAuth 错误回调安全处理（REQ-0367，已接收、未发布）

消费方在正式镜像的应用项目迁移中遇到真实 `invalid_scope` 回调返回 500。
Micronaut Security OAuth2 4.15.2 在错误分支先抛出
`AuthorizationErrorResponseException`，既有通用错误控制器将它处理为服务器异常。
0367 新增宿主内部专用错误控制器，不新增公开 SPI，不读取插件策略。

处理器仅接受 RFC 6749 授权错误，要求返回 state 与当前 cookie 中的完整 state 相等，
并调用框架 `StateValidator`。state 绑定的 redirect URI 必须匹配当前 callback；绝对 URI
精确比较 scheme、authority、path，相对 URI 精确比较 path。origin-form 请求使用
`HttpHostResolver` 的完整 origin，遵循部署的 Host/Forwarded 信任配置，不声称默认
resolver 能抵抗任意代理头。注册 redirect URI 的检查保留在发起授权链；处理器不查询
client 目录。UI 注册地址来自 issuer 加 `/oauth/callback/<client-name>`。

只支持已确认的 `CookieStatePersistence`，其他存储返回 400。有效错误返回固定同源
`micronaut.security.redirect.login-failure` 的 303，允许配置 `/oidc/login?error=1`。
只清除临时 state cookie，保留 JWT 和 IdP 会话，不回显 provider 描述或 state。
缺失、错配、未知错误或不安全失败 URL 均拒绝，错配不消耗当前合法 state。
cookie 清除证明正常浏览器重放被拒绝；不提供持有原 cookie 的服务端一次性保证。
成功回调的 PKCE、nonce 和 token 校验路径保持原契约。

源需求提交为 `4b99df01c211dab20af8a961ae2086aec012c72e`，实现关键提交为 `6affe5f`。
宿主独立 HTTP/边界六项已通过且无失败或跳过，最终 BASE 全部 39 个补丁顺序重放通过，
测试源码与重放源码逐字节一致。宿主 CI 和发布尚待通过；部署仓还必须验证真实登录、
错误回调、现有合法会话保留及安全拒绝。

**生产审计修复契约（2026-10-11）**：invalid_scope/resource/owner 等拒绝不能消耗
原 refresh，轮换并发仅一次成功；pending quota 饱和返回 429，数据库故障仍 503。
confidential client 服务端仅保存版本化哈希，UI client 配置仍持原 secret；迁移旧
明文后不回退明文存储，public 空 secret 语义不变。实现和 PG 回归同批。

当前已交付：0150/0160/0170/0180/0190补owner/pending/consent、MCP资源认证、能力门、
OAuth-only与管理/DB限速；详见mcp-oauth-integration.md与README配置/API段。
扩大镜像门覆盖生产创建B用户、真实第二server、撤销后已有session/refresh及RBAC缺bean；
异常 Authorizer 由真实 handler→gate→queue 单元路径验证，非生产外部 jar。
协议、MCP 与两种首次安装浏览器镜像门已通过真实 CI。

**最新用户归属裁定（维护者多轮澄清，优先于下述已交付记录）**：选定“DCR 返回
短期 pending client_id→浏览器登录确认→原子绑定用户 owner→授权码/token→以该
用户调用 MCP”。正式动态 client 不共享、无管理员特例；另一用户不得授权、使用
或管理。拒绝删除 pending，超时清理；额度分 pending 全局与正式用户维度。
完整可行性、标准衔接、抢占边界、数据隔离及实施门见
[面向集成方的 MCP OAuth2 文档](mcp-oauth-integration.md)。历史REQ-0134仅全局public
DCR；当前0150/0190已增加pending/owner/consent与管理，不宣称外部RBAC数据隔离。
MCP 认证面已由维护者重新接收并交付（OAuth2-only，删除 Basic Auth），
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

### 认证页面主题兼容（REQ-0132 / REQ-0310）

本节定义本次修订的实现与验收要求；是否已发布以对应提交 CI 和镜像发布门为准。
独立渲染的 `/oidc/login` 与宿主内的 `/ui/access-denied` 使用宿主的主题选择：
`light`、`dark`、`dark-2`、`syncWithSystem`。登录页在首屏绘制前读取同源
`localStorage.theme`，不改写偏好。拒绝页直接消费宿主语义颜色变量；登录页只携带固定
BASE 设计系统的必要颜色，不装载业务配置、身份或权限数据。

登录页的偏好缺失、值未知或浏览器禁止存储时跟随系统；系统偏好变化时更新配色。
脚本不可用时，CSS 媒体查询提供系统配色。背景、文字、输入框、错误提示、按钮及键盘
焦点必须兼容主题。主题处理不得改变凭据验证、表单提交、回跳检查或会话撤销。
风格统一按页面用途取舍元素；拒绝页不复制登录页的 K 字母标志。

`scripts/auth-theme-cases.mjs` 是本地 Ego 和宿主 CI Chromium 共用的浏览器矩阵。
两种屏幕宽度均检查主题实际颜色、文字对比度、键盘焦点、横向溢出和拒绝页无标志；
登录页另检查偏好缺失、未知值和存储不可用的回退。CI 保留 JSON 报告，既有错误密码、
生产登录、刷新、导航和退出测试继续执行。零授权账号退出换号由部署仓组合验收。

### 认证页面国际化（REQ-0320）

本次修订复用固定 BASE 的 `vue-i18n`、`translations/i18n.ts`、`languages.ts` 和
现有 JSON 翻译目录。拒绝页使用 `errors.403.title`、`errors.403.content` 和 `setup.login`。
独立登录页通过 Vite 入口 `/ui/assets/oidc-login-i18n.js` 装载同一翻译机制，读取宿主保存的
`localStorage.lang`；缺失、不支持或不可读取时使用英文。页面标题、标签、按钮、错误
提示和 HTML 的 BCP 47 语言标记同步更新。表单字段名、提交路径、回跳校验和认证逻辑不变。
入口只翻译页面，不启动业务 UI，不读取业务配置。无脚本时保留可提交的英文表单。

现有 `setup.login_title`、`setup.form.username`、`setup.form.password`、`setup.login`
及 `setup.validation.incorrect_creds` 覆盖登录文案，无需新增翻译键。不得在 Java 中
维护平行翻译表；今后确需新增文案时进入上游同类翻译源、生成和检查流程。
`scripts/auth-i18n-cases.mjs` 由本地与 CI 复用，核对全部 13 种语言在桌面和窄屏的
实际文案、页面标题、语言标记和溢出。测试预期来自固定 BASE 的既有翻译，不作为产品资源。

全量上游翻译检查另发现既有 MCP 定制键 `mcp.built_in_oidc_hint` 缺少非英文翻译，
且它与 `mcp.no_oauth_providers` 的生成指纹未同步。本次页面复用不新增此缺口；
完整检查未通过不得表述为全量国际化检查通过。处理新增翻译需按上游生成机制执行。

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

## 登录账号目录公开契约（2026-10-15）

**状态：REQ-0350 已正式发布（2026-10-15）。** 宿主 `8d46953` 的 CI `38732224758`
全部通过并推广镜像 `sha256:f2b2cb7fc3bb3286148dbdce8a5e6bc70c59e152e74a3d42079e26cd0c169253`。
实际下载的两种首次安装目录 HTTP 报告各 22 项通过，无失败。该结果只证明宿主机制，
不替代插件管理 API 和部署组合验收。消费项目 `ai-specs/kestra-plugin-rbac` 要在自己的
用户管理页面列出、创建、编辑、停用登录账号及重置密码，并单独管理插件授权绑定。
宿主负责账号真实性、凭据和会话；插件负责管理操作授权、页面及角色绑定，不直接访问
宿主目录表。历史 REQ-0140 待项不是发布或本次自动接收的证明。

### 实际缺口与现有机制

固定 BASE `172dd0f37` 加本仓补丁后，`oidc/controllers/` 只有协议、登录、首装、动态
client 注册与 owner 管理控制器，没有用户管理控制器。`services/OidcUserService` 有
list、create、setPassword、updateUserState、delete 等内部方法，发布 executable 也有
这些类，但 README 未定义独立扩展可消费的目录 SPI。内部 `public` 不等于公开契约。
首装完成后 setup 关闭，不能用于后续账号创建；owner client API 不能管理账号。

另一个具体失败路径：当前内部 create 使用 `ON CONFLICT DO NOTHING`，之后独立调用
setPassword。若直接包装为管理创建接口，重复账号可能被更改密码；两个连接也不能保证
用户及凭据原子创建。故不得将该方法直接宣布为已可用管理接口。

本仓 `scripts/directory-probe/` 已直接调用正式发布宿主 jar，并应用 jar 内实际 SQL 到
独立 PostgreSQL：重复 create 改变旧密码，setPassword 后 IdP session 和 access token
仍有效；停用拒绝密码与 access token，但 session subject 仍存在，重新启用恢复旧 token。
主控亲自运行并核对结果。session 查询不是完整 HTTP authorize 证明，UI JWT、refresh
和完整 MCP 链仍须生产测试；本证据不能写成完整认证漏洞或目录交付。已发布基线为
CI `38686689513` 的镜像
`sha256:878be36bcb1a2d15266f6c7c05921f77d836136604bd956a5318671c2f34186c`；此基线
证明协议与首装能力，不证明目录管理交付。

### 候选最小契约与职责

建议新增版本化 `UserDirectory` Java SPI 与稳定 DTO，通过发布镜像取得编译类型，
避免同源 HTTP 回环和跨服务凭据传递。SPI 只提供分页 list、detail、原子 create、
资料 update、active 状态更新、password reset。返回稳定 subject、登录名、显示名、
邮箱、状态、revision 和必要诊断，不返回密码／哈希／token。首期不改登录名、不物理
删除、不提供任意可信 roles 编辑。当前 subject 等于 username，身份复用风险必须在
未来删除／重建能力接收前解决，不能由插件猜测 UUID。

新账号默认不附加 admin 等管理声明，角色绑定留在插件。密码校验复用首装长度／字节
边界，create 与凭据在同一事务中写入，重复登录名返回 conflict 且不改变原账号密码。
修改按 revision 比较，非法状态／不存在／冲突／存储故障有稳定的类型化失败，敏感
错误不回显密码或底层 SQL。不得暴露 storedPasswordHash 一类测试内部方法。

SPI 是服务器内受信 classpath 能力，不代替调用者鉴权。插件控制器必须先经过宿主认证、
CSRF 和统一授权门，插件再要求当前实例管理员。普通用户不得通过可见页面访问目录。
宿主不依赖插件角色模型，不为业务扩展增加匿名 `/oidc/users` 接口。如果后续采用 HTTP
管理面，必须重新明确认证与 CSRF，不能继承 README 的 `/oidc/**` 匿名规则。

停用／密码重置必须定义对既有 UI JWT、IdP 会话、access/refresh token 及 MCP session
的失效语义。建议在持久目录维护认证 revision，校验入口拒绝旧 revision；具体激活点须
先追踪框架 JWT 恢复和所有 token/session 校验路径再裁决。不能只阻止下一次密码登录
就声明账号已停用。宿主只处理认证有效性，插件授权绑定保留并在恢复账号时明确展示。
受保护账号、允许自助修改的范围和最后管理员防锁死均由消费项目授权规则决定。
本目录不得接收角色名、管理员清单或应急账号配置来执行这些业务判断，也不得从
任意调用者传入的字段推断可信身份。消费项目负责鉴权与受保护账号检查，宿主负责
原子写入、revision 冲突和认证失效。没有跨项目数据库事务的承诺。

### 接收、兼容与检查

这是标准协议之外的目录管理面，现有协议基础设施 patch 例外不自动覆盖全部 CRUD。
实施前必须按入口 B 明确接收窄化的公开目录适配能力及必要认证失效激活点；若需要
超出薄适配的业务实现，应收窄提案，不能借用历史 REQ-0140 扩大范围。

主控依据独立目录探针接收 REQ-0350：宿主公开 UserDirectoryV1 与唯一内置 OIDC 适配，
支持分页／详情、原子创建、资料更新、状态变更和重置密码；不暴露管理 HTTP 端点，
不包含授权绑定、受保护账号或业务页面。subject／登录名不可改，重复 create 返回冲突
且不改原密码；资料／状态使用 revision 乐观锁；不得返回密码、哈希或 token。
密码采用与生产首装相同的长度／UTF-8 字节边界，新账号无管理角色。

认证失效先复用已有 ACTIVE 与 token 撤销检查，再补用户认证版本以覆盖 UI ID-token
cookie 和 IdP session：停用或重置原子推进认证版本，旧 token/session 不匹配则拒绝，
重新启用不得复活旧凭据。旧账号迁移默认版本为 0；缺失版本的旧 token 只在账号仍为
版本 0 时兼容，发生认证变更后必须拒绝。资料编辑不撤销登录。外部 issuer 身份不得
错误地当成本地目录账号。必须验证内置正常登录、外部 issuer 兼容范围、关闭 OIDC
回归、数据库异常失败关闭和全部已存在会话链。此接收不增加目录业务授权或一般 UI patch。

本候选与角色／授权管理线路独立。目录 revision、JWT 校验激活点和升级 migration 先
调查已有机制，再明确最小适配面；不能预先认定必须新增认证 revision 列。必须比较
已有账号状态／token 撤销机制与 revision 方案对 UI、IdP、access/refresh 和 MCP 的
覆盖及额外查询成本；缺一条校验链都不能声明账号停用交付。

无消费扩展时不增加用户管理 HTTP 暴露面。没有 provider、多个 provider、版本不符或
数据库异常时失败关闭，插件显示功能不可用，不直接读表或退回旧内部服务。升级保留
已有账号和安装凭据，不重开 setup；新增 revision migration 必须有向前升级和旧 token
处理策略，先发布宿主再由插件独立消费。

宿主独立测试必须覆盖原子创建、重复创建不改密码、并发更新冲突、分页与总数、非法
输入、故障回滚、无敏感字段、账号身份稳定和升级；真实登录后停用／重置，验证既有
UI、IdP、access token、refresh token 和 MCP session 拒绝，新增密码登录行为正确。
插件使用公开测试替身独立验证管理权限和错误转换；部署仓使用发布产物从真实 UI 创建
账号、零授权登录、授权绑定、撤销及退出换号，并比较拒绝前后目录与策略状态。
仅源码有方法、编译成功或原 OIDC CI 通过，都不能替代本契约的发布和组合验收。

### 应用组签发与目录契约重构提案（部分已发布，目标未交付）

消费项目为 `kestra-plugin-rbac`。用户需要按应用组授予用户 scope，并由应用主动登记支持范围；OAuth2 授权页需要展示该应用对 scope 的权限声明名称。旧发布 `ApplicationDirectoryV1.ScopeDefinition` 只有 `scope/description`，`ClientMembership` 只有 `allowedProjectScopes`，签名身份 claim 使用 `kestra_project_v1/project_id/project_scopes`。`0361458` 的正式 CI `39453574911` 已通过，并发布镜像 digest `sha256:f42f4bc98b419e59f165287ea460f0f9900a33ae76562784e9bbe2d5d6e11881`；该版本增加 scope `name`、声明只读 SPI、新 claim 和部分在线复查，但仍保留旧项目对象、意图字段与恢复机制。证据入口为 `patches/webserver/0360-application-project.patch`、`0362-application-project.patch` 和 `0363-application-project.patch`；不能把该镜像描述为应用组目标模型已交付。

裁决：保持单一 issuer、共享 discovery/authorization/token 和标准 `iss` 精确校验。将宿主共享目录的公开身份对象改为应用组、scope `key/name/description`、应用成员支持的 scope key 与用户 scope 授予；签名并验证 `kestra_application_group_v1` 私有 claim。scope 的权限声明 `key/name` 是消费扩展管理的应用元数据，宿主只通过最小只读公开 SPI 在授权页获取展示投影和当前支持范围，不读取插件策略、完整 grants 或数据库表。未安装声明提供者、多个提供者、版本不符、读取异常、未知 scope 或范围外请求都拒绝；不根据声明元数据授予 Kestra 资源访问。`openid` 等协议 scope 按标准机制处理；refresh 重新验证当前成员、授予和支持集合。内置组标识由安装事务持久化，删除和改标识必须拒绝。

兼容与升级：本轮 `new-install` 空库初始化目标 schema，不为旧 `project` API、配置、字段或 claim 建立别名。历史 schema1 和物理回滚只进入显式 `legacy-migration` profile。宿主先独立构建、测试、通过 CI 并发布镜像；插件从正式镜像获取公开类型后独立编译和发布 jar。宿主测试覆盖错误 issuer/audience/client/应用组、签名 claim、防伪造、范围外整体拒绝、撤权/refresh、scope key 不可改和受限删除、组件缺失及关闭回归。根仓以正式镜像和 jar 执行 OAuth2、REST、MCP、真实 UI 与拒绝无副作用组合验收。提案已同步差异表和机制文档；当前发布只证明 scope 名称、受限删除、声明投影 SPI、部分签发与旧凭据在线复查，不能称为目标模型交付。

### 缺声明组件的首方协议登录（已接收、待发布）

消费项目 `kestra-plugin-rbac` 缺失时，部署仓隔离 `new-install` 的 REST `56/56` 通过，随后缺插件用例在生产 `/oauth/login/kestra` 流程循环，报告位于本仓外部署仓 `.work/application-group-acceptance/local-run.log` 对应的隔离报告。失败来自 `OidcTokenService.projectAuthorization` 在取目录成员后要求唯一声明提供者；它把无法签发任何应用组 scope 的情况升级为整个标准 OIDC 登录失败。用户必须能登录后看到受保护业务拒绝并退出换号。

裁决：声明组件缺失或不唯一时，宿主仍可对已批准的首方 UI client 签发标准协议 scope，应用组 scope 集合必须为空。普通应用组 scope 请求仍整体拒绝；签名 claim 中不出现伪造的授权。业务 REST、MCP 和 UI 授权入口继续因缺插件拒绝，不能把零 scope 登录当作资源权限。组件恢复后的新请求按当前登记重新评估，不复活旧 token 的业务 scope。宿主独立测试须覆盖首方无组件协议登录、普通应用组 scope 拒绝、旧 token 复查和关闭功能；部署仓复测缺 jar 的真实登录、拒绝、无副作用与退出。候选源码已加入 `0160`/`0362` 需求补丁及定向测试，正式 CI 和镜像发布尚未通过，不能引用上一镜像作为修复产物。

`dd5f6c3` 的正式镜像通过 CI 后，部署仓隔离组合又发现 `/oauth/callback/kestra` 跳转的 UI 文档返回 401。实际失败路径是宿主 `OidcIdentityLifecycleFilter` 调用 `OidcTrustedIdentity.validate`，后者在声明组件缺失时拒绝已经签发的零应用组 scope 身份。修正的最小边界：可信身份仍逐项验证签名后的 issuer、audience、client、目录成员、用户状态与 epoch；缺声明组件时只接受空应用组 scope，任何非空 scope 整体拒绝。业务评估提供者仍缺席并拒绝全部资源操作。对应 `0362` 测试验证零 scope 身份与非零 scope 拒绝；正式镜像和根仓缺插件组合门仍待重跑。

### 应用组管理授权边界提案（已接收、未实施、未发布）

消费项目仍为 `kestra-plugin-rbac`。目标要求应用组 scope 仅有 `key/name/description`；当前 `ApplicationDirectoryV1.ScopeDefinition` 保存 `resourceIntents/managementIntents`，`JdbcApplicationDirectoryV1.authorize` 和 `hasAdministrator` 依赖这些字段，插件 `ProjectPolicyBoundary` 将其作为 Kestra 实际权限上界。管理员更改 scope 名称或成员登记会推进全组目录修订，插件随后要求“完整项目恢复”。这些是目标模型的实际失败路径；代码入口见 `patches/webserver/0360-application-project.patch`、`0363-application-project.patch` 与插件当前组合失败的待补探针。OSS 没有独立应用组管理授权入口；已发布的 typed 资源授权只接收宿主已解析的资源操作，不能直接替代目录事务内的管理决策。

候选最小契约：宿主目录 CRUD 在原事务内向唯一版本化管理决策 SPI 提交已验证的主体、应用组、client、scope key、目标与动作；插件只返回允许或拒绝，不能改写宿主目录。首次安装由安装凭据和显式批准计划完成，不使用普通 HTTP 决策旁路。最后管理员保护由宿主枚举实际可登录的主体、成员和 scope，交由同一 SPI 判断候选操作后仍有管理员；插件从自身 Kestra 运行时策略读取管理 grant。宿主不保存 Kestra 资源意图、管理意图或插件策略。缺 provider、多实例、版本不符、数据库错误、异常、超时和未解析目标均拒绝，事务回滚且不改变目录或会话。显示名称和说明变化不要求全组人工恢复；撤权仍逐请求检查。候选需要评估共享事务连接的公开边界，避免目录持锁时插件再借连接导致单连接池死锁。

兼容性：新安装只使用新公开契约，不保留旧意图字段、旧全组恢复 API 或项目 claim。宿主独立探针须覆盖同 scope 完整管理权限、READ/MANAGE 分离、最后管理员、并发写入、缺组件、存储故障、候选失败回滚和关闭功能。插件独立测试须证明 Kestra 实际策略是唯一资源授权事实来源；根仓用正式产物复测用户授予、应用支持交集、撤权、refresh、REST/MCP/UI 与无副作用。

主控裁决：接收移除共享意图及完整恢复的最小机制需求。新公开接口在宿主事务中接收已经验证的当前身份、目标应用组、动作和当前目录快照，只返回允许或拒绝；用于最后管理员检查的候选快照必须另设只读方法，不能把候选主体伪装成已登录身份。插件只从自己的已提交 Kestra 实际策略读取管理 grant；声明元数据 `key/name` 不参与决策。宿主先核对 issuer、client、audience、用户状态、scope 授予和应用支持，再调用唯一 provider；provider 不能读取宿主表或调用宿主写 API。跨连接一致性必须用真实 PostgreSQL 并发探针验证，当前没有跨仓共享事务承诺。内置应用组首次激活由安装凭据和批准计划控制，不能调用普通管理授权接口；其后写入缺 provider 时失败关闭。此裁决未冻结 Java 方法签名，须以独立探针确认事务访问路径后再实施。

候选实现进度：验证树已新增 `ApplicationGroupManagementV1` 和目录写入激活点；普通管理写入先由宿主核对可信身份、应用组成员、用户授予和 scope 状态，再要求唯一 provider 返回允许。缺 provider 或拒绝均不写库，独立 PostgreSQL 探针已复现。最后管理员检查已将候选用户、首方 UI 成员和有效 scope 交集交给同一 provider，专门测试证明即使共享 scope 没有 `managementIntents`，最后管理员撤权也被阻止；普通 client 即使登记相同管理 scope，也不能替代首方 UI 管理员。首次安装仍只按安装凭据与结构性首方 owner 判定，不把候选主体当成真实登录。旧 `resourceIntents/managementIntents`、目录上界和完整恢复仍在公开模型中，因此该候选不得发布为完整目标契约。下一步移除共享意图并更新插件独立策略，再执行双方完整构建与组合验收。

组合反馈：正式 `3ee3f8e` 镜像与插件 `e90c590` 通过各自 CI，但根仓空库组合在首个测试账号创建后的完整策略保存返回 409。宿主 `PolicyBoundary.reachableManagementScopes` 曾误调用仅判断 `IDENTITY.MANAGE` 的新 provider，漏报只持 `LOCAL_POLICY.MANAGE` 的策略 scope；插件于是拒绝策略管理员可达性。裁决把该投影恢复为宿主可实际登录、获授且受首方 UI 成员支持的 scope 集合，不在宿主推断该 scope 的管理动作。`IDENTITY.MANAGE` 的正常写入与最后管理员保护继续由新 provider 决策。独立 PostgreSQL 测试验证“可达但非身份管理”的策略 scope 会进入投影；该修正仍须镜像 CI、插件正式输入和根仓组合复测。

### 已接收的 UI 项目 scope 选择器（REQ-0360）

UI 不需要因新增项目 scope 修改 Compose。内置 issuer 只允许目录显式登记的第一方 UI client 申请协议 scope `kestra:project-scopes`。签发事务将该选择器展开为该 client 获批的项目 scope 集合，再与当前 subject assignment、项目 active 状态和用户 consent 求交；选择器本身永远不写入 `projectScopes`，不授予本地权限。UI 第一方可以显式免重复 consent，但不能免 subject 授权。普通 client 与 DCR client 必须逐名申请实际项目 scope，不自动展开。未授予请求返回 `invalid_scope`；没有 assignment 的 UI 用户仍可完成协议登录，但业务 projectScopes 为空。access token 的可信上下文只保存实际 project scopes；ID token 不假定标准 `scope` claim，若服务端 cookie 需要恢复上下文，必须使用同一签发事务产生的版本化私有 claim 并在线检查 project epoch。不得从 `roles` 改名为 scope。

### Compose 与关闭模式边界（REQ-0360）

新 Compose 由部署仓设置 `kestra.rbac.application-projects.enabled` 与 RBAC 开关，并在 UI client scopes 中显式加入 `kestra:project-scopes`；不再使用 `management-admin-subjects`。该配置尚未部署到正式镜像。RBAC/project 模式关闭时，未引导目录不得阻断首次 setup、协议登录或 selector 的协议消费；selector 不授项目 scope。project 模式启用而目录未初始化时，受保护业务必须失败关闭。旧 code/access/refresh/UI/IdP/MCP 凭据只在显式切换工具提交批准计划时失效，重启本身不触发迁移。


### 应用项目候选链与发布前置（未发布）

共享项目、scope 语义上界、成员 client 与 subject assignment 的事实源为宿主 PostgreSQL
目录。插件只消费公开目录投影，不读取宿主表，不向宿主写入本地 grants。

| 路径 | 候选实现与安全边界 |
|---|---|
| 申请与同意 | `OidcProviderController` 在真实登录后调用 `authorizeScopes`；UI selector 只对第一方获批 UI 成员展开，普通 client 逐名申请；实际 scope 再经用户同意收窄 |
| 授权码与签发 | 目录激活后授权码绑定项目 epoch；签发交集为启用项目、启用 scope、获批 member、subject assignment 和 consent；签名 claim 分离 protocol/project scopes |
| UI cookie / REST | ID token 携带与 access token 相同的签名项目 claim；Micronaut callback 完成标准 OIDC 校验；每请求 lifecycle 与可信身份机制核对 issuer、精确配置 UI audience、当前目录和 epoch |
| MCP | resource-bound access token 校验签名、issuer、有效期、持久化记录、账号、client、资源 audience 和 epoch；每次调用消费当前 Bearer 身份，不缓存 initialize 权限 |
| 撤权 | 项目、scope、member 或 assignment 写入推进项目 epoch；提交后新请求拒绝旧 cookie/access token；旧 code/refresh 不能恢复旧授权；已开始的不可变授权评估不混入新修订 |
| 管理引导 | 仅宿主本地 CLI 预览完整计划并核对批准 hash、安装凭据、源修订和源 hash；事务激活后消费一次性引导、撤销旧凭据；正常管理继续要求可信 scope，不提供 subject 永久旁路 |

`directoryRevision` 对应 `Project.revision`；`authorizationVersion` 对应独立的
`Project.authorizationVersion`。二者不得互换。共享 scope 的现有语义只允许收窄；
扩大授权必须新建稳定 scope 标识，并显式完成本地绑定、client 批准、subject 授予与
重新登录。完整新项目管理流程见 `r-ee-rbac.md`，本地策略恢复归消费扩展。

上述为源码与本地独立测试的候选链说明，不能替代正式 HTTP callback、真实浏览器、
双 client 撤权时限与拒绝无副作用组合验收。发布前必须通过宿主 CI、镜像级 OIDC/MCP
黑盒和发布门；消费扩展必须等正式产物后独立编译插件 jar。


协议上界候选修正：全局 protocolScopes 只负责分类，签发和 refresh 必须另外与当前
active client 的真实注册协议 scopes 求交；未注册协议项返回 invalid_scope，不把它
当作项目项继续处理。项目 scope 仍使用获批成员上界，不要求写入旧 client.scopes。
selector 必须显式注册且匹配安装凭据中的第一方 UI client。独立回归通过生产 DCR
注册、owner 同意和目录 membership 复现限制，不以手工 principal 代替签发证据。

### 目录迁移数据源修正（REQ-0364，待镜像验证）

提交 24a2b48 的 CI 39086467333 在 MCP 镜像启动时复现 NoConnectionException。
目录组件接收 Micronaut contextual DataSource，却在无请求连接上下文的迁移中自行开启
事务。组件必须先用宿主已有 DelegatingDataSource.unwrapDataSource 取得实际数据源，
再按自身短事务管理连接。独立测试须调用实际注入的迁移 bean，不能只验证 bean 存在。
此修正不改变目录模型、本地 grants 或启动认证边界；镜像启动仍须再次验证。

### 应用项目宿主发布状态（2026-10-18）

上述应用项目机制及目录迁移数据源修正已在 `4b017f6` 的正式 CI
[39087229293](https://github.com/ai-specs/kestra-overlay/actions/runs/39087229293) 通过，
镜像已推广为 `sha256:ba19764bf232306e6501c5226af015d3e18d006da75a4e96a55c6baecee457af`。
先前段落中的“候选／未发布”描述提案与实施时状态；本条只确认指定提交的宿主公开机制、
镜像级 MCP/OIDC/浏览器检查和发布，不确认独立插件业务、完整迁移或 Compose 组合。
使用契约与范围以 README 的应用项目章节为准；后续提交须检查自身 CI，不沿用此记录。
