# kestra-overlay

这是面向第三方独立扩展项目的 Kestra 增强镜像。
本文说明如何部署镜像、接入 OIDC、接入 MCP，以及挂载扩展。

当前镜像基于 **Kestra OSS v2.0.5**，提供后端引擎、API、Web UI、内置 OAuth2/OIDC
及 OAuth2-only MCP。`no-plugins` 变体不预装插件或外部扩展 jar，由部署方控制插件集。

| 你的使用场景 | 从哪里开始 |
|---|---|
| 部署 Kestra 并使用 Web UI | 下方 Compose 示例与首次安装说明 |
| 无人值守部署，启动时创建账号 | 首次安装环境变量 |
| MCP 客户端连接并执行 flow 工具 | MCP 客户端接入与 flow 工具 |
| 自己的应用使用内置 IdP | 外部应用使用 OIDC |
| 增加任务、触发器或 Runner 插件 | 插件与外部授权扩展 |
| 开发外部细粒度授权组件 | 下方 classpath jar 与授权 SPI 契约 |

## 部署镜像

本镜像的 OIDC 模式使用 OAuth2/OIDC。
UI 登录、刷新和退出都使用 OIDC。
未登录用户访问受保护页面时，镜像跳转到 `/oauth/login/kestra`。

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

### 首次安装和登录

镜像内置 OIDC 服务器和用户目录。
镜像不提供默认账号和默认密码。
空数据库首次访问 `/ui/` 时，页面会打开 `/oidc/setup`。
你可以在页面中创建第一个用户，也可以使用环境变量完成初始化。
两种方式都不需要手工执行 SQL。

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
              - pattern: /ui/assets/**
                access: [isAnonymous()]
              - pattern: /ui/manifest.webmanifest
                access: [isAnonymous()]
              - pattern: /favicon.ico
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

- **认证**：首次访问 `/ui/` 时完成安装引导，或使用初始化环境变量跳过表单。
  初始化完成后，使用创建的账号登录。
- 主端口 **8080**（API 与 Web UI，入口 `/ui/`）。**8081** 是 management
  端点：缺省不暴露、**无鉴权**，仅开发用途。
- 配置只经 `KESTRA_CONFIGURATION` 环境变量进入；改配置、加插件、挂 jar 都**需重启**。
- 无预装插件：需要插件走 `./plugins` 挂载（重启）或运行期 API 安装（需 `auto-install.enabled: true`）。

### 首次安装：网页引导或环境变量

首次引导使用双凭据：数据库安装身份与 `/app/storage/.oidc-installation`
共同决定状态，删除单一标记不能重新开放；异常失败关闭。凭据卷须持久化。

网页方式：设置 `KESTRA_OIDC_UI_CLIENT_SECRET`，`docker compose up -d` 后访问 `/ui/`。
空目录进入 `/oidc/setup`，填写用户名、密码（至少 8 字符，最多 72 UTF-8 字节）；
显示名、邮箱可选。提交成功后创建账号、安全密码凭据与 UI client，再进入 OIDC 登录。
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
镜像使用这些字段创建用户、登录凭据、UI client 和安装状态。
镜像不会执行部署方提供的 SQL。
环境变量只跳过安装表单，不跳过登录。

| 环境变量 | 用途 |
|---|---|
| `KESTRA_OIDC_BOOTSTRAP_USERNAME` | 首个 OIDC 登录名。必须与密码一起提供。 |
| `KESTRA_OIDC_BOOTSTRAP_PASSWORD` | 首次密码；服务端安全保存，不保存明文用户密码 |
| `KESTRA_OIDC_BOOTSTRAP_EMAIL` | 可选邮箱 |
| `KESTRA_OIDC_BOOTSTRAP_NAME` | 可选显示名，缺省使用登录名 |
| `KESTRA_OIDC_UI_CLIENT_SECRET` | UI client secret。网页引导和无人值守初始化都需要。 |
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
返回 404，删除用户也不会重新开放匿名引导；账号恢复请使用部署方的备份流程。
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

### 外部应用使用 OIDC

外部应用可以使用本镜像的 OIDC 服务登录用户。
应用需要 issuer、client ID、client secret、redirect URI 和申请的 scope。
授权端点、token 端点、JWKS 端点和 userinfo 端点来自 OIDC discovery。
每个应用使用独立的 client 和 redirect URI。
不要复用 UI client。

应用使用 Authorization Code 和 PKCE S256。
应用使用 access token 访问 API。
ID token 只用于确认用户身份，不用于调用 MCP。

### MCP 客户端使用 OAuth2

MCP 接入提供用户归属、consent、resource Bearer、复合 scope、OAuth-only、
owner 管理和共享注册限速。
外部 RBAC 扩展未包含在本镜像中，因此当前不能宣称具体 flow 或 namespace 数据隔离。
客户端先动态注册取得短期待绑定 client_id，再打开浏览器。
用户登录并同意后，client 绑定该用户。
之后签发的 token 使用该用户身份。
拒绝申请会删除 pending client，未确认的申请会过期清理。
正式 client 不在用户之间共享。

MCP 能力 scope 按资源大类区分 read、write 和 delete。
write 不包含 delete。
当前 scope 是 `mcp:flows:read` 和 `mcp:executions:write`。
用户可以在授权页收窄 scope。
外部 RBAC 启用后，MCP 工具执行的资源操作还必须通过 REST 使用的细粒度授权。

管理界面的 MCP 编辑页在 OAuth 模式下显示“由本实例内置 OIDC 服务器保护”。
页面不要求选择外部 OIDC provider。
PWA 安装提示不会覆盖管理页面的操作控件。

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

MCP 只接受 resource-bound access token。
未启用 OIDC 时，MCP 不可用。普通 REST 认证保留默认行为。
MCP 协议使用 Streamable HTTP。
不声称外部GUI兼容。`kestra.url`是公开资源基址，不从Host/Forwarded推导。
首装自动创建的MCP server id为`default`，地址为`${kestra.url}/api/v1/main/mcp/default`
（基址末尾斜线只保留一个）；`kestra`是默认OAuth客户端配置name，不是MCP server id。
管理API `/api/v1/main/mcp-servers/default` 可核对存在/disabled状态；disabled=true必须
由认证管理API启用后才可连接，空库未创建McpToolTrigger flow时tools/list为空。
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
消费应用从 `http://localhost:8080/.well-known/openid-configuration` 获取协议端点：
authorize `/oidc/authorize`、token `/oidc/token`、JWKS `/oidc/jwks`、userinfo `/oidc/userinfo`。
`localhost` 仅为本机示例；跨容器/跨主机应用使用部署的公开 issuer。

confidential client 需要由部署方预先注册，并使用精确的 redirect URI。
public client 使用上面的动态注册接口，不需要 client secret。
不要把 client secret 放入浏览器前端。
API 使用 Bearer access token；UI 使用 OAuth2 callback 建立登录 cookie。

#### MCP 地址和 flow 工具

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

MCP 只接受 OAuth2 Bearer access token。
MCP 资源 URL 是 `kestra.url` 加 `/api/v1/{tenant}/mcp/{server-id}`。
`kestra.url` 必须是客户端可以访问的稳定绝对 HTTP(S) 地址。

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

## 扩展契约

REQ-0330／0340／0350 已随 `8d46953` 通过 CI `38732224758` 并正式发布，
镜像摘要为 `sha256:f2b2cb7fc3bb3286148dbdce8a5e6bc70c59e152e74a3d42079e26cd0c169253`。
这是宿主机制发布证据；独立插件和部署组合仍须各自验证。

### 插件

任务、触发器和 Runner 插件通过部署侧挂载 `/app/plugins`，重启 Kestra 后生效。镜像不
预装插件，也不在构建时烘焙第三方 jar。插件版本必须与 Kestra `v2.0.5` 兼容；请按
插件项目发布说明选择版本。

```yaml
services:
  kestra:
    volumes:
      - ./plugins:/app/plugins
```

### 外部授权扩展

外部细粒度授权扩展使用契约文件名 `kestra-rbac-authorizer.jar`，部署侧挂载到
`/app/libs/kestra-rbac-authorizer.jar`，重启后加入应用 classpath 与 Micronaut 上下文。
镜像构建只声明 classpath 条目，不包含扩展 jar。
扩展须针对所部署镜像的公开 SPI 构建，并带有 Micronaut 注解处理生成的 bean 索引。

```yaml
services:
  kestra:
    volumes:
      - ./libs:/app/libs:ro
```

启用统一授权时，在现有 `KESTRA_CONFIGURATION` 中合并：

```yaml
kestra:
  rbac:
    enabled: true
```

扩展实现 `io.kestra.webserver.rbac` 下的三个接口：

- `RbacAuthorizer`：消费可信主体与资源、动作，返回授权决定。
- `RestAuthorizationResolver`：在 REST 业务操作前解析完整资源操作计划；查询和批量
  计划必须覆盖实际查询域或全部副作用。
- `McpAuthorizationResolver`：在 REST/MCP 执行前解析实际 flow 输入、输出的额外资源读取。

角色、主体绑定、namespace 规则和支持的业务路径由扩展项目定义。统一开关启用时，
缺组件、组件异常、身份丢失或资源计划无法确定会拒绝请求；REST 拒绝返回
`403 application/problem+json`。MCP 仍独立要求能力 scope 与资源授权同时允许。
未设置统一开关时，不启用该扩展授权门。

镜像、扩展 jar 和部署配置分别发布。先取得通过 CI 的镜像与契约，再由扩展项目独立
构建 jar，最后在部署项目的 Compose 中组合。镜像选择 commit hash 标签或 digest，
扩展选择声明兼容该契约的固定版本；挂载 jar 不代表所有业务路径均已受支持，
具体支持范围和权限配置以扩展项目说明为准。

### 完整授权评估生命周期

以下为 REQ-0330 的新契约，源码及本地测试已存在，正式发布仍须选择包含它且通过全部
发布门的镜像；旧镜像不提供本接口。配置 `kestra.rbac.evaluation.enabled: true` 时，
必须同时开启统一 RBAC 和 typed。默认 false，保留现有静态 provider 行为。

扩展实现 `io.kestra.webserver.rbac.AuthorizationEvaluationProviderV1`：
`begin(RbacAuthorizer.Principal, String tenant)` 返回
`CompletionStage<AuthorizationEvaluationV1>`。评估对象提供
`authorize(TypedAuthorization.Operation)` 与 `close()`，分别返回 Decision 与 Void
的 CompletionStage。主体为宿主认证结果，扩展不得重新解析身份 header 或宿主 URL。

宿主负责 REST 完整业务请求、MCP 单次完整工具操作、实际 Flow 声明的嵌套检查和必要
查询范围的评估边界。扩展 begin 固定不可变策略快照，边界内不混合策略版本；新边界
重新读取当前策略。句柄不得持有 JDBC 连接／事务，不进入队列，不是 worker 每个 task
执行时的授权沙箱。晚到 begin 仍须释放；异常、超时、缺少或多个 provider 均失败关闭，
不得退回逐 operation。旧接口保留，新接口只有 V1 显式启用后才使用。

### OIDC 登录账号目录

以下为 REQ-0350 的公开契约。内置 OIDC 开启时，classpath 扩展可以
注入唯一的 `io.kestra.webserver.oidc.UserDirectoryV1`。它是服务器内受信能力，不提供
匿名或独立管理 HTTP 端点；扩展控制器必须自行要求管理权，并经过宿主认证与 CSRF。
公开目录不识别插件角色、应急管理员或授权绑定。

`list(page,size)` 使用 1 起始页、1–100 页大小；`find(subject)` 返回 Optional。
`create(username,name,email,password)` 原子创建账号及凭据，冲突不改旧密码；新账号无
可信角色。`update`、`setActive`、`resetPassword` 要求当前 revision，返回递增 revision。
账号 DTO 只含 subject、显示名、邮箱、active、revision，不返回凭据、哈希或 token。
subject 等于当前不可修改的登录名；没有改名或物理删除接口。失败用 DirectoryException
的 INVALID／NOT_FOUND／CONFLICT／UNAVAILABLE 区分，调用方映射到自己的稳定 API 错误。

停用、启用与重置会推进认证版本并撤销现有 token，旧 UI/IdP 会话不能通过重新启用复活。
资料更新不撤销会话。旧账号迁移默认版本 0；缺版本旧 token 仅在账号仍为 0 时兼容。
登录、退出及协议端点保留独立校验，失效 UI 会话仍能退出和重新登录；外部 issuer 不按
本地目录身份处理。目录操作失败不改变安装状态，不重开首次 setup。

### 独立管理页面

REQ-0340 的源码和本地测试已存在，正式使用必须选择包含该契约且通过全部发布门的
镜像。Java 入口为 `io.kestra.webserver.ui.UiExtensionProviderV1`，返回 V1 descriptor：
扩展ID、`ui-extensions/<id>` classpath根、ESM入口、styles清单、文件SHA-256/MIME、
语言标题及可选capability API。重复ID、路径歧义、错误版本、缺文件或hash不符拒绝注册。
资源限制为单文件16MiB、单扩展64MiB、注册总128MiB。classpath共享，不宣称来源沙箱。

描述发现为 `/ui-extensions/{tenant}/manifest`，需宿主认证；有普通metadata权限的用户
获得200空列表，显式SYSTEM管理允许时显示管理描述。资源在同一路径的`/{id}/{file}`
下提供，继续经宿主授权；未声明资源返回404，不回退SPA HTML。扩展业务API带实际
tenant时按宿主SYSTEM管理门处理，插件仍须检查自身管理权限；不能靠资源可读或菜单
可见授权保存。关闭统一RBAC时沿用宿主现有认证边界，插件管理接口必须自行保持关闭。

宿主提供 `/ui/{tenant}/extensions/{id}/...` 根路由与独立 Extensions（扩展）菜单组，
与 Resources 下的 Plugins 插件目录入口区分。ESM导出contractVersion=1和
mount(container,context)，返回update／unmount。context提供tenant、根内路径、语言、
解析后主题、styles、assetBase、AbortSignal及导航／同源request函数，不提供Vue、router、
store、i18n实例或token。扩展自有ShadowRoot，只在根内装载styles，不向document注入
全局CSS；卸载与abort释放监听和副作用。初期支持公开基础按钮、输入和表格，复杂弹出
层及KsPagination不在兼容清单内，详情使用路由、确认使用页内区域。

已发布executable中的 `META-INF/kestra/ui-sdk/v1/` 是独立前端消费入口，含协议类型、
组件包精确版本／integrity、13种语言ID／回退与翻译完整性检查工具。插件从兼容正式
镜像提取此目录，npm只消费声明的公开包，不读取相邻宿主源码。组件locale含下划线，
使用SDK声明的别名映射。业务消息按locale包装JSON，运行check-translations.mjs；工具
只检查完整性和占位符，不证明翻译质量，仍须浏览器检查实际文案及主题。

### 独立仓消费边界

第三方扩展仓必须优先依赖稳定的公开契约。overlay 负责适配上游实现细节、提供必要的
激活点和承载能力；扩展仓负责业务模型、授权策略和业务 bean。插件不得解析或复制
`Controller`、`Handler`、URL 路由或 chart YAML。插件只能消费已发布的公开 SPI、类型
和配置契约；上游内部类、内部 URL 和部署模板不是插件接口。

typed 契约与宿主适配见 [R-EE-RBAC](docs/r-ee-rbac.md)。必须选择包含 0250/0260、
通过自身 CI 并完成发布的镜像；候选镜像不得作为插件正式编译输入或部署验收结论。

消费 `TypedAuthorizationResolver` 时同时设置 `kestra.rbac.enabled: true` 和
`kestra.rbac.typed.enabled: true`。插件接收版本化 Operation 并返回 Decision；宿主负责
路由、实际 execution owner、query/filter 与 dashboard datasource 解析。旧 REST resolver
在 typed 模式下不参与请求授权。执行输入/输出依赖继续使用 `McpAuthorizationResolver`。
QueryDomain 的 GLOBAL 必须显式声明；受限空集合为空域，null scope 或未知版本拒绝。
宿主将决定范围与请求域相交，在 SQL 分页、total 和 aggregate 前应用范围。
当前启用开关不增加上游不存在的 EE 页面；具体角色策略与支持行为由扩展发布说明规定。

交付顺序固定为：先构建 overlay 镜像并通过自身 CI，发布镜像并记录实际 commit 与
digest；再由扩展仓使用该已发布产物独立编译插件 jar，并通过扩展仓 CI；最后由部署仓
固定兼容的镜像 digest 和插件产物 hash，执行 Compose 验收。版本标签不能替代 digest
或 commit 证据。扩展仓不得读取相邻源码、patch、开发目录或未发布 jar，也不得触发
overlay 构建。

任何未解析的资源、身份、组件或业务路径都必须失败关闭。异常、缺少组件、契约不匹配
和无法确定资源计划时必须拒绝操作，并检查没有产生不应有的数据库、存储或队列副作用。
错误状态码单独不能证明授权正确。扩展支持范围以扩展仓发布说明为准；挂载 jar 不代表
所有 controller、handler 或 URL 均已支持。

上游升级时，overlay 先按上游版本重新检查公开契约和适配层，再发布新的镜像 digest；
扩展仓随后按新契约独立编译和验收。发现上游细节变化时，优先在 overlay 适配，不要求
插件解析新的内部实现。错误路径回退必须保持失败关闭；不得为恢复旧行为而绕过稳定契约、
放宽授权或回退到未发布接口。

### 配置与边界

Namespace 查询扩展可以替换公开的 `GlobalNamespaceAccessControl` 和
`GlobalLogDataStoreAccessControl` bean。`AccessScope.namespaces(subtrees, exactNamespaces)`
表达子树与精确 namespace 的并集；旧二参构造和单集合工厂保持子树语义。
`namespaceAllowed` predicate 与 JDBC/log 查询使用相同语义，Namespace 合成候选在
分页与计数前过滤。默认 GLOBAL 行为保持原样。角色、可信请求上下文、后台调用策略
和详情/写操作授权由扩展负责；完整契约见 [R-EE-RBAC](docs/r-ee-rbac.md)。

- `KESTRA_CONFIGURATION` 是部署配置入口；配置变更和插件挂载都需要重启。
- `/app/plugins` 只承载插件类型，不承载 Controller、Filter 或其他 Web bean。
- 镜像不烘焙业务扩展 jar；部署方负责扩展文件、版本匹配和运行时挂载。
- 本 README 描述本镜像对第三方的使用契约。

## 更多

- [MCP 客户端交互流程与集成约束](docs/mcp-oauth-integration.md)
- [OIDC 服务与首次安装契约](docs/r-oidc-server.md)
- [R-EE-RBAC 扩展边界](docs/r-ee-rbac.md)

## 应用项目公开契约

本节宿主机制已随 `4b017f6` 通过正式 CI [39087229293](https://github.com/ai-specs/kestra-overlay/actions/runs/39087229293)，
包含 MCP、OIDC 和浏览器镜像黑盒，且已推广发布。镜像摘要为
`sha256:ba19764bf232306e6501c5226af015d3e18d006da75a4e96a55c6baecee457af`。
这是指定提交的宿主发布证据；独立插件与部署组合仍须分别通过验收。消费扩展必须从
兼容正式镜像取得编译输入，不得从相邻开发树或候选 executable 编译正式插件 jar。

宿主只维护共享身份目录与 scope 的语义上界，不保存插件本地 grants。公开 classpath
接口为 `io.kestra.webserver.oidc.ApplicationDirectoryV1`、`TrustedIdentityV1` 和
`io.kestra.webserver.rbac.AuthorizationEvaluationProviderV2`。接口版本为 1、1、2；
V2 provider 接收宿主可信身份和 tenant，返回既有 `AuthorizationEvaluationV1` 句柄。
未发布的独立 QueryDomainV2 已删除；查询使用 `TypedAuthorization.QueryDomain` 的
兼容扩展 `resourceDomains`，每个 term 保留 namespace 与 resource ID 的关联。

启用新模式必须同时配置：

```yaml
kestra:
  oidc:
    enabled: true
  repository:
    type: postgres
  rbac:
    enabled: true
    typed:
      enabled: true
    evaluation:
      enabled: true
    application-projects:
      enabled: true
micronaut:
  security:
    oauth2:
      clients:
        kestra:
          scopes: [openid, profile, email, 'kestra:project-scopes']
```

这段配置须合并到前面的完整 OIDC 配置，不能替代数据库、issuer、凭据、回调和安全
过滤配置。当前宿主目录实现仅支持 PostgreSQL。新模式要求唯一 V2 provider 和唯一
可信身份服务；缺组件、重复组件、身份不匹配或目录故障拒绝操作，不回退 V1、roles
或 subject 授权。关闭新模式保持既有入口语义。

`TrustedIdentityV1.Identity` 的字段语义如下：

| 字段 | 含义与校验 |
|---|---|
| contractVersion | 必须为 1；构造 DTO 不代表身份已经认证 |
| issuer、subject、clientId | 来自已验证的身份；issuer 必须精确匹配内置可信 issuer |
| audiences | 当前 token 的精确受众集合；REST/UI 要求配置的第一方 UI client，MCP 要求精确 resource audience |
| tenant、projectId | 来自当前获批目录成员关系；不得用 client ID 替代项目 ID |
| protocolScopes | 显式登记的协议能力；不生成本地业务权限，不包含 UI selector |
| projectScopes | 签发时经项目启用、scope 启用、member 批准、subject 授予和 consent 求交的项目角色 |
| authenticationVersion | 当前账号认证版本，账号停用或密码重置使旧版本失效 |
| authorizationVersion | `Project.authorizationVersion`，项目 token/session 的撤权 epoch |
| directoryRevision | 同一目录快照的 `Project.revision`，表示目录修订；不得与 epoch 互换，两者可以不同 |

UI ID token 与 access token 携带同源签名项目 claim；UI cookie 后续请求仍检查当前
账号和项目 epoch。MCP 每次请求读取当前 Bearer 身份，不复用 initialize 的授权。
`ApplicationDirectoryV1.policyBoundaries()` 在短事务内返回不可变上界投影，不保留
数据库连接，不提供匿名 HTTP API。协议词汇表当前由标准项与启动配置生成，不是
动态数据库目录。所有扩展 HTTP 管理入口仍须独立检查管理域、目标和 CSRF。

共享管理意图区分 IDENTITY、LOCAL_POLICY 和 BUSINESS_INSTANCE；互不包含。
LOCAL_POLICY 的空 `projectIds` 只表示 scope 所属项目，非空集合只表示精确列出的
目标。既有 scope 只能收窄；扩大含义必须创建新的稳定 scope 标识，重新完成本地绑定、
client 批准、subject 授予和登录，不得给旧名称增加权限后复用旧同意。

新目标项目的分步流程为：创建目标项目；在控制台项目创建新的目标管理 scope；由
仍获准的控制台 manager 完整恢复本地控制台策略并绑定该新 scope；显式批准 UI member
和 subject 授予；重新登录并确认最新控制台修订；再建立目标的本地绑定。修改现有
项目目录会推进 epoch，每次后续写入前可能都需要重新登录。旧 refresh token 不能
恢复旧授权。宿主不替插件执行本地策略恢复，也不承诺跨数据库原子事务。

### 本地 CLI 首次激活计划

`io.kestra.webserver.oidc.projects.ApplicationDirectoryCommand` 只用于宿主本地的受信
维护过程，不提供 HTTP 引导入口。需要已经完成 OIDC 首装的数据库、原安装凭据文件、
已注册 UI client 和真实 active subject。它读取 `KESTRA_CONFIGURATION`，也可读取
`KESTRA_CONFIGURATION_PATH` 指向的 YAML；后者覆盖前者同名项。必须使用与服务一致
的 issuer、数据库、UI client ID、存储路径和安装凭据路径。不要将凭据写入计划。

计划格式为严格 UTF-8 JSON；拒绝未知字段、重复键、重复集合项、尾随文档与 null。
下面仅演示首次建立空共享目录的身份端计划，所有 placeholder 必须替换为实际值。
它不转换插件旧本地 roles、subjects 或 grants。已有本地策略的迁移计划归消费扩展。

```json
{
  "formatVersion": 1,
  "installationId": "<原安装凭据中的UUID，不含文件前缀与换行>",
  "uiClientId": "kestra-ui",
  "sourceRevision": 0,
  "sourceHash": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "projects": [{
    "project": {
      "id": "console", "tenant": "main", "issuer": "https://kestra.example.org",
      "displayName": "Console", "active": true, "revision": 1, "authorizationVersion": 1
    },
    "scopes": [{
      "projectId": "console", "scope": "console-manage-v1", "description": "Console management",
      "active": true, "resourceIntents": [],
      "managementIntents": [
        {"domain": "IDENTITY", "actions": ["READ", "MANAGE"], "projectIds": []},
        {"domain": "LOCAL_POLICY", "actions": ["READ", "MANAGE"], "projectIds": []}
      ],
      "revision": 1
    }],
    "memberships": [{
      "projectId": "console", "clientId": "kestra-ui", "approved": true,
      "audiences": ["kestra-ui"], "allowedProjectScopes": ["console-manage-v1"],
      "firstPartyUi": true, "revision": 1
    }],
    "assignments": [{
      "projectId": "console", "issuer": "https://kestra.example.org", "subject": "<已有管理员登录名>",
      "projectScopes": ["console-manage-v1"], "revision": 1, "authorizationVersion": 1
    }],
    "directoryRevision": 1
  }]
}
```

`sourceHash` 是规范化源目录的 SHA-256，示例值只适用于空列表 `[]`；`sourceRevision`
是源项目 revision 之和。非空目录不得沿用这两个示例值。当前 CLI 没有通用导出命令；
非空源计划必须先通过公开目录读取取得和核对源快照，不得猜测 hash。已消费引导的
目录不能再次 apply。计划最多 8 MiB、嵌套深度最多 32、每个集合最多 1000 项。

在兼容正式镜像中，将计划挂载为 `/work/directory-plan.json`，保留原持久卷和配置，执行：

```bash
java -cp /app/kestra io.kestra.webserver.oidc.projects.ApplicationDirectoryCommand \
  preview /work/directory-plan.json > /work/directory-preview.json
java -cp /app/kestra io.kestra.webserver.oidc.projects.ApplicationDirectoryCommand \
  apply /work/directory-plan.json <预览报告中的approvalHash>
```

先审核预览的完整计划、源修订、源 hash 和 approvalHash，再显式批准 apply。apply 在
同一事务核对原安装身份、注册 UI client、source 与批准 hash；要求至少一个真实可登录
的身份管理员。激活会一次性消费引导、撤销旧 token/code、推进账号认证版本，旧会话
必须重新登录。失败回滚不能开放匿名引导。此命令不创建永久 subject 管理员豁免。
CLI 入口与目录组件已有本地探针；容器内完整 CLI、浏览器引导及最终组合仍须发布验收。

### ID 查询域的首版适配范围

| 消费入口 | 受限 resource ID |
|---|---|
| JDBC 通用查询的 FLOW、EXECUTION | 每个 term 独立编译 namespace 与 `id` 条件，分页、total、聚合前过滤 |
| FLOW、EXECUTION 精确资源 predicate | 按完整 `(namespace,id)` term 判断，不做笛卡尔积 |
| JDBC tenant MCP_SERVER 列表 | 用独立 tenant 资源域限制 server ID，不解释 namespace |
| NAMESPACE、LOG、TRIGGER、KV_METADATA、NAMESPACE_FILE_METADATA 的通用 JDBC 查询 | ALL_IDS 按 namespace term 过滤；RESTRICTED_IDS 未适配，明确拒绝 |
| namespace-only predicate、日志 AccessScope 与未适配后端 | 不丢弃 ID 后降级允许；RESTRICTED_IDS 明确拒绝 |

MCP 工具业务仍须同时满足协议能力门和扩展本地授权。以上支持表不意味着其他后端、
全量业务页面或所有 ID 维度已经验收；新增适配必须重新提供真实查询和无泄露证据。


协议 scope 的分类词汇表与 client 注册上界是两件事。项目模式在同一连接读取当前
active client 的 `oidc_client.scopes`：协议项必须在该上界内，refresh 也重新检查；
项目项只受 member.allowedProjectScopes、subject assignment 和项目启用约束，不要求
重复写入旧 client.scopes。UI selector 除显式注册外，还须匹配第一方成员、system
client 和已消费安装凭据中的 UI client ID。全局 MCP 能力词汇表不能扩大注册范围。

目录 namespace exact/subtrees 逐值使用 `[A-Za-z0-9_-]+(?:[.][A-Za-z0-9_-]+)*`；
资源 ID 必须非空、不带首尾空白或控制字符。有效 opaque ID 保留原字节，不按冒号、
斜线或其他符号推断资源含义。codec 的结构校验不能替代这些构造边界的语义检查。
