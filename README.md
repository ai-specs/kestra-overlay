# kestra-overlay

面向**第三方独立扩展项目**的 kestra 增强镜像与扩展契约提供方。

当前镜像基于 **Kestra OSS v2.0.5**，提供后端引擎、API、Web UI、内置 OAuth2/OIDC
及 OAuth2-only MCP。`no-plugins` 变体不预装插件或外部扩展 jar，由部署方控制插件集。

| 你的使用场景 | 从哪里开始 |
|---|---|
| 部署 Kestra 并使用 Web UI | 下方 Compose 示例与首次安装说明 |
| 无人值守部署，启动时创建账号 | 首次安装环境变量 |
| MCP 客户端连接并执行 flow 工具 | MCP 客户端接入与 flow 工具 |
| 自己的应用使用内置 IdP | OAuth2/OIDC 消费方接入 |
| 增加任务、触发器或 Runner 插件 | 插件与外部授权扩展 |
| 开发外部细粒度授权组件 | jar 契约；先确认 classpath 承载限制 |

## 使用镜像

OIDC 模式统一使用 OAuth2/OIDC，关闭 Basic Auth 链；UI 登录、刷新和退出使用服务端认证。
旧登录/setup 页面在 OIDC 模式不进入凭据流程；用户名密码提交在 `/oidc/login`。
部署时启用 Micronaut Security 并配置
`micronaut.security.redirect.unauthorized.url: /oauth/login/kestra` 与客户端注册。

### 下载

镜像发布在 GHCR **私有包**：先登录，再拉取——

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u <github-username> --password-stdin
docker pull ghcr.io/ai-specs/kestra-overlay:v2.0.5-no-plugins
```

`GITHUB_TOKEN` 需要 `read:packages` 权限（GitHub → Settings → Developer settings →
Personal access tokens → Fine-grained / Classic 均可）。无凭据匿名拉取会被拒绝（403），
这是预期行为。

**访问模型**：本仓库与 GHCR 包同为私有且互相关联——能读到本 README 的 GitHub 账号
（仓库协作者）即拥有镜像拉取权限，用自己的 PAT 登录即可，无需单独申请凭据。

多架构：镜像提供 `linux/amd64` 与 `linux/arm64`。

正式 release/commit/latest tag 仅在 MCP、OIDC 和浏览器镜像验收通过后更新；所有
验收引用同一个不可变候选 digest。基础运行镜像固定于 `patches/IMAGE_BASE` 的
多架构 OCI index digest。候选失败不会覆盖正式部署 tag；旧提交重跑在晋级前
核对 main HEAD，避免覆盖新版本。

### OIDC 账号与 OAuth client 契约

镜像内置 **OIDC 服务器、用户目录和 client 注册能力**，不预装默认账号、密码或
固定 OAuth client。空库首次访问 `/ui/` 会进入 **OIDC 安装引导 `/oidc/setup`**，
设置首个用户名、显示名、邮箱和密码；服务端同时注册配置中的 UI client。
也可以加载下表环境变量跳过引导。两种方式均不需要人工 SQL 创建首个用户/client。
`kestra.oidc.users` 是旧的预留配置模型，不作为初始化入口；使用下述引导/环境变量。

| 名称 | 含义与约束 |
|---|---|
| OIDC 用户 | `oidc_user.username` 为登录名和 OIDC `sub`；密码在 `oidc_user_auth_method` 中以 bcrypt 保存 |
| `kestra` | 下例的 Micronaut 客户端配置名称，决定 `/oauth/login/kestra` 与 `/oauth/callback/kestra` 路径；不是 client ID |
| `kestra-ui` | 下例为本实例 UI 选用的 client ID，可自定义；必须同时存在于配置与 `oidc_client` 注册表 |
| client secret | 部署方自行生成并保留在 OAuth 客户端配置中；授权服务器以独立随机盐的版本化 PBKDF2-HMAC-SHA256 哈希保存，不能从注册表取回原值；旧版本数据库启动时自动迁移，失败则阻止启动 |
| redirect URI | 必须精确注册，例如 `http://localhost:8080/oauth/callback/kestra`；含协议、域名、端口和路径 |
| 外部项目 client | 每个应用单独注册 client ID/secret/回调；不要复用 UI client 的凭据与回调 |

UI 使用 **OIDC Authorization Code + PKCE S256**，服务端 confidential client 换 token，
浏览器用 HttpOnly 认证 cookie。OIDC 模式完全停用 Basic Auth；不在 UI Basic Auth
表单填写 OIDC 用户。新部署没有默认用户名或密码。

### compose 示例（内置 OIDC + UI）

下例用于本机 `http://localhost:8080`。启动前设置部署方生成的
`KESTRA_OIDC_UI_CLIENT_SECRET`；首次初始化会自动按配置注册 UI client。
生产部署同时更换公开 URL/issuer；首次注册的精确回调由 issuer 与客户端名称推导。
公开 issuer 必须可被用户和消费应用访问。数据库密码也由部署方设置。

```yaml
services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_DB: kestra
      POSTGRES_USER: kestra
      POSTGRES_PASSWORD: k3str4
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -d kestra -U kestra"]
      interval: 10s
      retries: 10

  kestra:
    image: ghcr.io/ai-specs/kestra-overlay:v2.0.5-no-plugins
    command: server standalone
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - kestra-data:/app/storage
      - ./plugins:/app/plugins   # 插件 jar（重启生效）
    environment:
      KESTRA_OIDC_UI_CLIENT_SECRET: "${KESTRA_OIDC_UI_CLIENT_SECRET:?Set a UI client secret}"
      KESTRA_OIDC_BOOTSTRAP_USERNAME: "${KESTRA_OIDC_BOOTSTRAP_USERNAME:-}"
      KESTRA_OIDC_BOOTSTRAP_PASSWORD: "${KESTRA_OIDC_BOOTSTRAP_PASSWORD:-}"
      KESTRA_OIDC_BOOTSTRAP_EMAIL: "${KESTRA_OIDC_BOOTSTRAP_EMAIL:-}"
      KESTRA_OIDC_BOOTSTRAP_NAME: "${KESTRA_OIDC_BOOTSTRAP_NAME:-}"
      KESTRA_OIDC_SETUP_ALLOWED: "${KESTRA_OIDC_SETUP_ALLOWED:-true}"
      KESTRA_CONFIGURATION: |
        datasources:
          postgres:
            url: jdbc:postgresql://postgres:5432/kestra
            driverClassName: org.postgresql.Driver
            username: kestra
            password: k3str4
        kestra:
          repository:
            type: postgres
          storage:
            type: local
            local:
              base-path: "/app/storage"
          queue:
            type: postgres
          url: http://localhost:8080/
          plugins:
            auto-install:
              enabled: false   # 加固基线：静态插件集
          oidc:
            enabled: true
            issuer: http://localhost:8080
        micronaut:
          security:
            enabled: true
            authentication: idtoken
            filter:
              enabled: true
            redirect:
              login-success: /ui/
              login-failure: /oidc/login?error=1
              unauthorized:
                url: /oauth/login/kestra
            intercept-url-map:
              - pattern: /oidc/**
                access: [isAnonymous()]
              - pattern: /.well-known/**
                access: [isAnonymous()]
              - pattern: /oauth/**
                access: [isAnonymous()]
              - pattern: /ping
                access: [isAnonymous()]
              - pattern: /api/v1/configs/login
                access: [isAnonymous()]
              - pattern: /**
                access: [isAuthenticated()]
            oauth2:
              clients:
                kestra:
                  client-id: kestra-ui
                  client-secret: $${KESTRA_OIDC_UI_CLIENT_SECRET}
                  scopes: [openid, profile, email]
                  openid:
                    issuer: http://localhost:8080
                    token:
                      url: http://localhost:8080/oidc/token
                    jwks-uri: http://localhost:8080/oidc/jwks
                    end-session:
                      enabled: false
    ports:
      - "8080:8080"

volumes:
  kestra-data:
```

运行说明：

- **认证**：上例启用完整 OIDC 链，关闭 Basic Auth；首次访问 `/ui/` 完成引导，
  或预置初始化环境变量跳过表单。OIDC 未启用时才保留上游 vanilla Basic Auth 行为。
- 主端口 **8080**（API 与原版 UI，入口 `/ui/`）。**8081** 是 management
  端点：缺省不暴露、**无鉴权**，仅开发用途。
- 配置只经 `KESTRA_CONFIGURATION` 环境变量进入；改配置、加插件、挂 jar 都**需重启**。
- 无预装插件：需要插件走 `./plugins` 挂载（重启）或运行期 API 安装（需 `auto-install.enabled: true`）。
- 若使用旧版构建（首启 `AccessDenied: /app/storage/plugins` 崩溃）：镜像缺 `/app/storage`
  预置属主所致——`docker run --rm -v <项目名>_kestra-data:/data alpine chown -R 1000:1000 /data`
  一次性修复，或使用已修复构建（2026-10-09 后）。

### 首次安装：网页引导或环境变量

首次引导使用双凭据：数据库安装身份与 `/app/storage/.oidc-installation`
共同决定状态，删除单一标记不能重新开放；异常失败关闭。凭据卷须持久化。

网页方式：设置 `KESTRA_OIDC_UI_CLIENT_SECRET`，`docker compose up -d` 后访问 `/ui/`。
空目录进入 `/oidc/setup`，填写用户名、密码（至少 8 字符，最多 72 UTF-8 字节）；
显示名、邮箱可选。提交成功后创建账号、bcrypt 凭据与 UI client，再进入 OIDC 登录。
首个用户具有 `admin` 角色声明；细粒度 RBAC 仍由独立授权能力提供，不能将声明当作已交付 RBAC。

无人值守方式：在启动镜像时加载这些环境变量（上例 compose 已接入）：

也可以直接在 compose 的 `kestra.environment` 中填值，无需 `export` 或执行 `psql`。
将下列字段合并到上面的完整服务配置（保留 `KESTRA_CONFIGURATION`）：

```yaml
services:
  kestra:
    environment:
      KESTRA_OIDC_UI_CLIENT_SECRET: "replace-with-your-generated-client-secret"
      KESTRA_OIDC_BOOTSTRAP_USERNAME: "your-login-name"
      KESTRA_OIDC_BOOTSTRAP_PASSWORD: "choose-your-own-password"
      KESTRA_OIDC_BOOTSTRAP_EMAIL: "you@example.org"
      KESTRA_OIDC_BOOTSTRAP_NAME: "Your Name"
      KESTRA_OIDC_SETUP_ALLOWED: "false"
```

然后只需 `docker compose up -d` 和访问 `/ui/`。镜像自身使用生产初始化服务执行
数据库事务，将这些字段写为用户、bcrypt 凭据、UI client 与安装身份；不会执行部署方
提供的任意 SQL。与网页表单共用同一初始化逻辑，只跳过表单，不跳过 OIDC 登录。

| 环境变量 | 用途 |
|---|---|
| `KESTRA_OIDC_BOOTSTRAP_USERNAME` | 首个 OIDC 登录名；与 password 必须成对提供 |
| `KESTRA_OIDC_BOOTSTRAP_PASSWORD` | 首次密码；运行时 bcrypt 后持久化，不保存明文用户密码 |
| `KESTRA_OIDC_BOOTSTRAP_EMAIL` | 可选邮箱 |
| `KESTRA_OIDC_BOOTSTRAP_NAME` | 可选显示名，缺省使用登录名 |
| `KESTRA_OIDC_UI_CLIENT_SECRET` | 示例 compose 的 UI client secret 环境变量，经配置映射给 Micronaut 客户端；引导/无人值守两种方式都需要 |
| `KESTRA_OIDC_SETUP_ALLOWED` | 设为 `false` 时封闭网页首次安装；环境变量初始化仍可用，适合无人值守部署 |

```bash
export KESTRA_OIDC_UI_CLIENT_SECRET="$(openssl rand -hex 32)"
export KESTRA_OIDC_BOOTSTRAP_USERNAME='your-login-name'
export KESTRA_OIDC_BOOTSTRAP_PASSWORD='choose-your-own-password'
export KESTRA_OIDC_BOOTSTRAP_EMAIL='you@example.org'
export KESTRA_OIDC_BOOTSTRAP_NAME='Your Name'
docker compose up -d
```

初始化在首次访问 UI/OIDC 客户端入口时执行；提供环境变量后直接进入登录，不显示安装表单。
首次事务原子创建用户、凭据、UI client 与完成标记；并发安装只允许一次成功。
重启或改 bootstrap 环境变量不会覆盖已有密码/client。完成后 `/oidc/setup` GET/POST
返回 404，删除用户也不会重新开放匿名引导；密码恢复/账号管理不能靠清空表实现。
已有用户部署首次升级保留账号，并关闭引导；若同名 client 与配置冲突，初始化拒绝，
不静默覆盖 secret/回调。不要在后续启动时随机重生成已经注册的 UI secret。

安装身份还保存在独立文件 `/app/storage/.oidc-installation`（权限 `0600`），须保留
示例 `kestra-data` 持久卷；多实例共享同一安装凭据，或由部署侧同步同一可信凭据。
可通过 `kestra.oidc.bootstrap.receipt-path` 指定其他持久化路径。
数据库标记删除时，文件锁存仍阻止 setup 和环境变量重建；文件删除时，数据库只恢复
原身份文件，不创建账号；身份不一致、损坏/符号链接/公开权限时拒绝初始化（500）。
初始化中断留下文件但没有数据库完成记录时也拒绝重试，避免再次激活；管理员须从可信
备份核对和恢复安装身份，不使用删除标记的方式重新安装。
在控制数据库与持久卷的管理权限之外，可进一步在部署配置中设置
`KESTRA_OIDC_SETUP_ALLOWED=false`，防止网页首装暴露。镜像不能判断有权同时重置数据库、
凭据卷和部署配置的管理员是否在重装；这些权限属于部署信任边界。

下例 client 配置名为 `kestra`，client ID 为 `kestra-ui`，精确回调为
`http://localhost:8080/oauth/callback/kestra`。自定义客户端配置名称时设置
`kestra.oidc.bootstrap.client-name`，同时对齐 unauthorized URL 与 callback 路径。

### 其他项目接入内置 IdP

MCP 接入提供用户归属与 consent、resource Bearer、复合 scope、OAuth-only、
owner 管理和共享注册限速，已通过真实 SDK 与浏览器镜像验收。
外部RBAC jar和REST适配未交付，不能宣称具体资源隔离。客户端先动态注册取得短期待绑定
client_id，再打开浏览器；用户登录并明确同意后，client 原子绑定该用户，签发
用户身份的 token，以该用户权限调用 MCP。拒绝删除申请，未确认超时清理；正式
client 不在用户之间共享，其他用户不能使用或管理。这里已验证的是client归属与
能力控制，不是外部RBAC所负责的具体资源/namespace数据隔离。详见
[MCP 客户端交互流程与集成约束](docs/mcp-oauth-integration.md)，含时序图、页面、
缓存失效恢复、PKCE 边界与分阶段验收。下文描述的是当前已交付的 public DCR。

MCP 能力 scope 按资源大类区分 read/write/delete，write 不含删除；当前仅声明
`mcp:flows:read` 与 `mcp:executions:write`，现有flow复合call必须两者均具备。
用户可在授权页进一步收窄。本仓逐工具调用独立强制检查，不依赖外部 RBAC；
外部 RBAC 启用后，现有 MCP 工具内部实际资源操作还必须经过与 REST 相同的
细粒度授权。两层均允许才执行；未接 RBAC 时不声称具体资源/namespace 隔离。
能力 scope 与 MCP-only Authorizer SPI 已实施；外部 RBAC 与 REST 统一适配未交付。

管理界面的 MCP 编辑页在 OAuth 模式下明确显示“由本实例内置 OIDC 服务器保护”，
不要求选择外部 OIDC provider；OAuth 保存请求不会写入空的外部 provider。PWA 安装
提示不会覆盖 `/ui/*/admin/*` 管理页面的操作控件。

支持 RFC7591 动态 **public client** 注册，适用于公开 MCP、桌面及浏览器客户端：
`token_endpoint_auth_method=none`，不生成 client secret，授权码流强制 PKCE S256。
在 `KESTRA_CONFIGURATION` 中设置并重启：

```yaml
kestra:
  oidc:
    registration:
      enabled: true
      max-clients: 1000
```

默认关闭；启用后 discovery 发布 `registration_endpoint`。须先完成生产首次安装。
使用 README 的 `/oidc/**` 匿名规则时注册无需预共享凭据；部署侧应限制注册请求速率。
`max-clients` 是全部 client 的上限（含首装 UI client），并发注册不能突破；达到上限
返回 429；pending 额度与请求速率超限也返回 429，数据库故障返回 503。
服务端不抓取客户端提供的 URL，仅保存校验后的回调元数据。

```bash
curl --fail-with-body -X POST 'http://localhost:8080/oidc/register' \
  -H 'Content-Type: application/json' \
  -d '{"redirect_uris":["http://127.0.0.1:9999/callback"],"token_endpoint_auth_method":"none","grant_types":["authorization_code","refresh_token"],"response_types":["code"],"scope":"openid profile email","client_name":"Public OAuth client"}'
```

成功返回 201、随机临时 `client_id` 和确认的元数据，无 `client_secret`；记录为pending，
默认30分钟过期，未确认不能换token。登录consent原子绑定owner后才成为正式client；
拒绝删除pending，过期须重新注册。消费方保存有效client ID，
每次授权生成新的 verifier/challenge，携带 state/nonce；使用精确注册的回调换 token，
提交 `client_id`、code 和 `code_verifier`，不提交 secret。只允许 HTTPS 回调或 loopback
HTTP（localhost/127.0.0.1/[::1]），禁止 fragment、userinfo、通配符和非 loopback HTTP。
当前仅public授权码/refresh注册；已提供下述owner list/detail/revoke/delete管理，
不是RFC7592注册管理协议，不提供client元数据更新接口。

MCP只接受resource-bound access token，拒绝Basic、ID token与IdP/UI cookie；OIDC关闭时
MCP失败关闭，普通REST认证保留上游模式。SDK基线为Java MCP 1.1.3，实测协议2025-06-18；
不声称外部GUI兼容。`kestra.url`是公开资源基址，不从Host/Forwarded推导。
首装自动创建的MCP server id为`default`，地址为`${kestra.url}/api/v1/main/mcp/default`
（基址末尾斜线只保留一个）；`kestra`是默认OAuth客户端配置name，不是MCP server id。
管理API `/api/v1/main/mcp-servers/default` 可核对存在/disabled状态；disabled=true必须
由认证管理API启用后才可连接，空库未创建McpToolTrigger flow时tools/list为空。
测试fixture显式通过生产API创建flow及`other-server`，不是首装默认资源。
客户端先读取401 WWW-Authenticate中的resource_metadata，再取JSON.resource作为
authorize/token的resource；不可用基址、无tenant路径或自行猜`kestra`别名替代。
`kestra.oidc.mcp-scopes`限定可授权能力（默认上述两项）；`kestra.mcp.execution.enabled=false`
关闭执行。pending TTL为`registration.pending-ttl-minutes`（1–120，默认30），
`max-pending-clients`默认100、`max-clients`默认1000、`max-clients-per-user`默认20。
`kestra.oidc.registration.requests-per-minute`默认60，是共享数据库hard ceiling；
IP/可信入口限速仍是部署责任，数据库异常503，超额429。
owner浏览器会话可GET `/oidc/clients?page=1&size=20`、GET `/oidc/clients/{id}`，
均无secret且只返回owner记录；detail返回五分钟单次interaction（每用户最多20）。
POST `/oidc/clients/{id}/revoke` JSON `{action:"revoke"|"delete",interaction:"..."}`
要求ACTIVE用户、当前IdP会话与同源Origin；interaction原子消费，重放403、他人404。
Origin必须精确为OIDC issuer的`scheme://authority`（不含路径），例如
issuer `https://kestra.example.org` 对应`Origin: https://kestra.example.org`。
管理调用使用浏览器登录IdP cookie、detail返回的interaction与该Origin，JSON提交；
单凭MCP access token不能管理client，curl不得遗漏cookie/Origin/interaction。
管理没有独立UI，也不是RFC7592；撤销立即阻断token、refresh和已有MCPsession后续调用。
`bash scripts/blackbox-mcp-oauth.sh IMAGE /absolute/verify-tree`自建PG、生产首装、
UI cookie+CSRF创建flow，并强制执行SDK正反向、B用户、跨真实server、撤销session/refresh
和RBAC缺bean镜像门；不接受SDK skipped。异常Authorizer零队列副作用另由单元集成路径验证。

消费应用从 `http://localhost:8080/.well-known/openid-configuration` 获取协议端点：
authorize `/oidc/authorize`、token `/oidc/token`、JWKS `/oidc/jwks`、userinfo `/oidc/userinfo`。
`localhost` 仅为本机示例；跨容器/跨主机应用使用部署的公开 issuer。

为每个消费应用在 `oidc_client` 单独注册 client 与精确回调，并配置其 SDK：issuer、
client ID、client secret（confidential client）、redirect URI、`openid profile email`、
授权码流及 PKCE S256。public client 的 `client_secret` 为空，强制 S256；不能将 secret
放入浏览器前端。外部应用不需要在 Kestra 的 Micronaut `clients` 中新增配置——该配置
仅用于 Kestra 自身作为消费客户端；服务端注册表才决定哪些外部 client 可以授权。
首装自动注册本实例 UI confidential client；public 消费方使用上述动态注册；
额外 confidential client 注册管理及账号管理 API 仍待后续交付，
不将手工数据库操作作为本镜像首次安装步骤。

会话边界：`oidc_session` 只用于 IdP 登录及授权流程，不认证 Kestra API。API 使用
Bearer access token；UI 使用 OAuth2 callback 建立的 HttpOnly JWT cookie。

可复现验收入口：`scripts/blackbox-ui-oidc.sh <image>`（实际初始化、UI 链与 token
持久化检查）、`scripts/blackbox-ui-browser.cjs`（CI Chromium 登录/刷新/导航/退出）。

### MCP 客户端接入与 flow 工具

本机默认 MCP 地址是 **`http://localhost:8080/api/v1/main/mcp/default`**。
`main` 是当前 OSS tenant，`default` 是首装自动创建的 server ID；`kestra` 是 OAuth
客户端配置名称，不能替代 server ID。自定义 server 先在 Web UI 的 MCP Servers 中
创建，再使用它的实际 ID。不存在的 server 返回 404，不提供授权发现信息。

连接前登录 Web UI，打开 MCP Servers 中的 `default`，检查 Enabled 开关并保存。
脚本管理方式是先 GET `/api/v1/main/mcp-servers/default`，保留其可编辑字段，再 PUT
同一路径，将 `authType` 设为 `OAUTH`、`disabled` 设为 `false`。管理请求使用有效的
UI 认证 cookie，写请求还须 `X-CSRF-TOKEN`；MCP resource-bound token 不用于管理 REST。

要暴露 flow 工具，在 UI 创建并保存下面的 flow（core 插件包含这些类型）：

```yaml
id: mcp-example
namespace: examples.mcp
tasks:
  - id: result
    type: io.kestra.plugin.core.debug.Return
    format: verified
triggers:
  - id: mcp
    type: io.kestra.plugin.core.trigger.McpToolTrigger
    mcpServer: default
    toolName: run-example
    title: Run example flow
    toolDescription: Execute the example flow and return its result
```

尚未配置工具时 `tools/list` 可以为空；这不等于 token 无效。客户端应从下面的发现
流程取得资源值，不猜基址、尾随斜线或省略 tenant 的别名。

MCP 只接受 OAuth2 Bearer access token；Basic Auth、ID token、IdP/UI cookie 均不能调用
MCP。MCP 资源 URL 为 `kestra.url` 加 `/api/v1/{tenant}/mcp/{server-id}`，部署配置的
`kestra.url` 必须是客户端可访问的稳定绝对 HTTP(S) 地址。当前 MCP SDK 验收基线为
Java `io.modelcontextprotocol.sdk:mcp:1.1.3`、协议 `2025-06-18`；外部 GUI 客户端
兼容性尚未验证。

启用 OAuth2 后，MCP 客户端按下列顺序工作：

1. 向 MCP 地址发送 initialize；未带 Bearer 时收到 `401` 和 RFC9728
   `resource_metadata` 挑战。
2. 从 resource metadata/discovery 获取授权服务器和 MCP resource，调用动态注册取得
   临时 public `client_id`（无 secret）。
3. 生成 PKCE S256 verifier/challenge，打开浏览器授权；用户登录并确认客户端回调、
   申请 scope 和当前用户归属。拒绝或过期会删除 pending client。
4. 使用 authorization code、client ID、精确回调和 verifier 换 resource-bound token。
5. 使用 `Authorization: Bearer <access_token>` 初始化 MCP、列工具和调用工具；客户端
   不保存 client secret。access token、refresh token 和 PKCE verifier 需要由客户端安全保存。

例如上述地址的挑战应指向
`http://localhost:8080/.well-known/oauth-protected-resource/api/v1/main/mcp/default`。
该 URL 必须返回 JSON，其中 `resource` 为完整 MCP 地址；将此值同时传给 authorize
和 token 请求。MCP access token 的 `aud` 必须与其精确匹配。JWT 标准允许 `aud`
是字符串或数组，消费方需要按标准解析；未传 resource 签发的普通 OIDC token 不可调用 MCP。

`POST /oidc/consent` 是浏览器授权交互：除了同一 IdP 会话 cookie 与页面返回的单次
`interaction`，还要求 `Origin` 精确等于 issuer 的 `scheme://authority`，例如
`Origin: http://localhost:8080`（不含路径、末尾斜线）。浏览器提交会自动带上 Origin；
脚本应显式携带，遗漏/跨源返回 403。owner 管理 POST 使用同样的 Origin 要求，
但提交管理 detail 返回的 interaction 和 JSON action；授权 form interaction 不能混用。

当前 flow 工具声明两个能力：`mcp:flows:read`（工具定义与返回输出）和
`mcp:executions:write`（触发执行）；复合调用必须同时获得二者，write 不包含 delete。
用户授权页可以收窄申请范围，服务端不会自动扩权；scope 不足的调用不会创建 execution。
外部 RBAC jar 尚未交付，当前是能力级控制，不能据此宣称具体 flow/namespace 数据隔离。

owner 可以通过 OIDC 会话访问 `/oidc/clients?page=1&size=20` 查看自己的 client，
获取 detail 中的短期管理 interaction，再 POST `/oidc/clients/{client-id}/revoke`
撤销或删除。其他用户返回 404/403；撤销立即阻断 token、refresh 和已有 MCP session。
这些接口不是 RFC7592 管理协议，也没有 secret 返回。

真实可重复验收：

```bash
bash scripts/blackbox-mcp-oauth.sh ghcr.io/ai-specs/kestra-overlay:v2.0.5-no-plugins \
  "$PWD/.work/verify"
```

该门自行启动 PostgreSQL 和 Kestra，执行生产首装、浏览器登录/CSRF、DCR/consent、
resource-bound token、实际 Java MCP SDK initialize/list/call、只读 scope 拒绝、
用户 B 隔离、跨 resource 拒绝、owner 撤销后 session/refresh 拒绝以及 RBAC 缺失时
无 execution 副作用。外部 SDK probe 没有运行环境时会明确 skip，不计作通过。

## 相对上游原始镜像的扩展能力

| 能力 | 状态 | 对集成方的意义 |
|---|---|---|
| OIDC 登录引导字段 | **已生效** | `GET /api/v1/configs/login`（注意：**login 子端点**，非 `/configs`）返回 `oidcAuthEnabled`；`micronaut.security.enabled=true` 时该字段为 true 且 `isBasicAuthInitialized=true`。⇒ 认证链部署下引导逻辑有判定依据 |
| plugins/ 插件槽 | 已生效（同上游） | 挂载 `/app/plugins` + 重启。任务/触发器/Runner 插件面；**bean（@Controller/@Filter）不在此槽**。插件版本线：**core 2.0.5 ↔ 插件 1.x 线**（如 `io.kestra.plugin:plugin-script-shell:1.14.0`；Maven 索引的 0.23.0 是旧 API 线，不兼容） |
| 部署配置通道 | 已生效（同上游） | `KESTRA_CONFIGURATION` 全量可用（含 basic-auth） |
| classpath jar 承载 | **契约已约定，承载待实施** | 实施后：`/app/libs` 挂载的契约 jar 进入应用 classpath（见下）。实施前挂载**不生效** |
| 端点门（intercept-url-map） | **已生效，须配置** | 启用 `micronaut.security.enabled: true` 与 `filter.enabled: true`，按上例配置匿名协议入口及受保护 UI/API |
| 内置 OAuth2/OIDC 授权服务器 + 认证链 | **已生效** | REQ-0100~0133：协议端点、PKCE 授权码、完整 UI 认证与首次引导/环境变量初始化；无预置账号；管理 API 仍待实施 |
| 外部细粒度授权对接点 | 预留 | SecurityRule/Authorizer bean jar 的对接（契约名见下） |

## 扩展能力 × 集成契约（同一条运行线）

运行时上，能力与契约不分家：契约 jar 挂载进 classpath，能力随之激活。
**允许交叉**：一个契约可以服务多项能力；一项能力可以由多个元素组合；
同一能力半的实现可互换（内置服务器 ↔ 外部 IdP）。当前约定的运行线：

```
R-OIDC-SERVER：内置授权服务器 + 认证链（协议/UI/首次引导/环境初始化已生效；管理 API 待实施）
                                      → 认证能力：
                                          ① OIDC 登录引导字段（已生效，/api/v1/configs/login）
                                          ② 认证链 + ③ 端点门（已生效；
                                             外部 IdP 场景走同一配置通道）
                                              ↓ 授权能力叠加在认证层之上
（契约）kestra-rbac-authorizer.jar ────→ 授权能力（每请求 (资源,动作,namespace) 判定）

（同上游）./plugins 挂载 ──────────────→ 插件能力（并行；bean 不走此槽）
```

classpath 承载（manifest 注入）实施前，契约 jar 挂载 `/app/libs` **不生效**——契约名先行
约定，集成方可按下列规则**先行构建**。

## jar 契约的构建与命名规则

### 插件与外部授权扩展

任务/触发器/Runner 插件通过 `/app/plugins` 部署侧挂载，重启后生效；镜像构建期不
烘焙插件或外部 jar。外部细粒度授权组件使用约定的 `kestra-rbac-authorizer.jar`，
但当前 classpath 承载机制仍是契约占位，挂载 `/app/libs` 在承载实现前不会生效。
R-EE-RBAC 组件未来需同时覆盖 REST 与 MCP 实际执行路径；没有组件时 MCP 能力门
仍可限制大类 scope，但不能提供具体资源/namespace 隔离。

| 契约文件名 | 用途 |
|---|---|
| `kestra-rbac-authorizer.jar` | 授权判定：SecurityRule/Authorizer bean + 角色模型 |

规则：

- **文件名 = 契约**。镜像构建期会在可执行 jar 的 manifest `Class-Path` 声明这些条目
  （镜像 ↔ 部署的唯一契约）；jar 本体一律由部署侧挂载 `/app/libs`，镜像不烤 jar 字节。
  需要新契约名时向本仓登记（协作者提 issue/commit 均可）。
- **构建规格（对齐本镜像实际内容物）**：
  - Micronaut 平台：**4.10.28**（micronaut-security 4.15.2）——随 BASE 升级而变，
    以本节为准；可用下文命令从镜像内自证。
  - Java：**release 25**（运行时 JDK 25）。
  - 必须启用 Micronaut 注解处理生成 bean 索引（`META-INF/micronaut/` 下的
    `BeanDefinitionReference` 服务文件）——无索引 bean 不可见。
  - 最小 `pom.xml` 关键段：

    ```xml
    <properties>
      <maven.compiler.release>25</maven.compiler.release>
      <micronaut.version>4.10.28</micronaut.version>
    </properties>
    <dependencies>
      <dependency>
        <groupId>io.micronaut</groupId>
        <artifactId>micronaut-inject</artifactId>
        <scope>provided</scope>
      </dependency>
      <!-- 按需：micronaut-security(provided) 等 -->
    </dependencies>
    <build>
      <plugins>
        <plugin>
          <groupId>org.apache.maven.plugins</groupId>
          <artifactId>maven-compiler-plugin</artifactId>
          <configuration>
            <annotationProcessorPaths>
              <path>
                <groupId>io.micronaut</groupId>
                <artifactId>micronaut-inject-java</artifactId>
                <version>${micronaut.version}</version>
              </path>
            </annotationProcessorPaths>
          </configuration>
        </plugin>
      </plugins>
    </build>
    ```
- **行为语义**：挂载 + 重启生效；**缺席 = 静默休眠**（镜像其他功能不受影响）；同 FQN 类
  **不可覆盖**镜像内的类（主 jar 永远优先）——扩展 jar 只加新类；同包
  （`io.kestra.webserver.*`）的 `@Controller`/`@Filter` 可正常注册。
- **授权对接要点**（原内部文档要点已内联于此）：授权 bean 实现
  `io.micronaut.security.rules.SecurityRule`（或 `@Replaces` 替换 Authorizer），从
  JWT/会话解析主体，按 `(资源, 动作, namespace)` 判定 allow/deny；deny → 403。

### 从镜像内自证构建规格

```bash
docker run --rm --entrypoint sh ghcr.io/ai-specs/kestra-overlay:v2.0.5-no-plugins -c \
  'python3 -c "import zipfile; z=zipfile.ZipFile(\"/app/kestra\"); print(z.read(\"META-INF/maven/io.micronaut/micronaut-inject/pom.xml\").decode()[:400])"'
```

## 更多

内部治理（需求接收 / patch 质量法 / 升级 SOP）、机制原理（编译/重启/外部 jar）、
能力差异调查见 `AGENTS.md` 与 `docs/`（仓库协作者可达）。
