# kestra-overlay

0384当前公开契约输入为2f2984a：contract.json的overlayCompatibility与内置SDK README
一致，仅支持KsDrawer/KsDialog/KsSelect/KsFilter经公开helper和owned renderer使用。
原始未适配弹层、popover、未列出的复杂下拉和KsPagination仍不支持。新13文件输入
包含公开说明与一致性测试；必须核对对应提交构建、完整矩阵和镜像发布，不复用旧输入。

原生filter锚定正式基线（2026-10-29，`1e3632e`，成功CI `40822882820`）：扩展renderer将当前owned高级筛选
触发器映射到viewport坐标，隔离宿主document同名filter；移动层按实际触发器所属实例
关联。正式基线真实几何36门与原949矩阵已随该版本发布。
业务groupable、字段和AND/OR语义仍由消费扩展配置，本机制不赋予业务权限。

移动filter视口边界增量（2026-10-30，候选未发布）：原36门保留，移动底部/离屏/重开resize新增12门，总48；原949仍须针对最终提交实际执行。移动sheet仅下方空间足够时保持bar+8，否则翻转或视口clamp并维持正滚动高度；desktop本轮不变。须通过本轮最终CI和正式推广后才能消费。

0384提供公开原生组件的最小ShadowRoot portal、焦点、ESC及导航适配，不包含业务模型
或业务UI。消费方必须使用对应正式镜像中的SDK与其精确依赖，并经helper使用已声明
组件；不得将未适配的全局弹层或其他版本推断为支持。规范fullPath/query与可选异步
beforeNavigate只有明确true允许离开，异常/abort失败关闭；安全登录/拒绝路由不受草稿
阻止。具体支持边界见docs/r-ee-rbac.md。实际发布以对应提交CI及镜像推广成功为条件。

2026-10-28历史本地验证：11文件补丁69e11808、build02d12978的完整local-ci、普通
镜像门及Ego/Playwright同949均通过。公开元数据与SDK说明的后续修订产生新输入时，
必须重新验证，不继承该旧hash结果；本地通过不能代替对应提交CI和正式镜像发布。

> 当前应用组协议候选与发布边界见本仓 `docs/r-oidc-server.md`。应用组业务归消费插件；未经正式发布的候选不能作为独立插件的交付编译输入。

协议0380–0383已在64c4498通过正式CI40523539018并推广镜像
`sha256:bebf7a7c06a6205c151ffd35882c54965918357f4e1c71bc0cd2879c3177a22e`。
该正式44补丁版本不包含后续UI SDK兼容扩容；后续SDK须选择另行通过发布门的对应镜像。
本地通过或源码中的公开类型不是插件正式编译输入，不代表插件或部署组合已交付。

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

启用 RBAC 时，站点图标仅对规范 `/favicon.ico` 的 GET/HEAD 使用公开静态资源判定：
必须没有业务方法路由覆盖，且实际静态解析指向镜像内 `root/favicon.ico`。错误或缺失
映射、写方法、编码/穿越路径仍拒绝。匿名、退出、零授权与失效会话可读取图标，不因此
获得业务 API 权限；部署保留上方精确匿名规则，不扩大其他路径的认证范围。
此契约必须对应提交 CI 与正式镜像推广成功后消费，不代表外部扩展或部署组合已验收。

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

当已认证账号获准访问某扩展、但没有业务配置权限时，宿主使用独立扩展壳层提供语言、
主题、获准扩展导航和退出。拒绝页面提供相同的获准扩展入口；返回普通宿主页面仍须
通过其业务权限。此 REQ-0368 行为为当前未发布候选，正式使用须选择通过完整发布门的
对应镜像。配置获准的扩展继续使用完整宿主布局，不改变业务 API 权限。

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
全局CSS；卸载与abort释放监听和副作用。基础按钮、输入和表格继续支持。0384的
overlayCompatibility仅支持KsDrawer/KsDialog/KsSelect/KsFilter经公开helper及owned
renderer使用；原始未适配弹层、popover、未列出的复杂下拉及KsPagination仍不支持。

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

### 账号与 client 凭据（REQ-0380–0382）

本节公开契约已在64c4498发布，不能以源码或开发树替代正式镜像。只有选择包含本契约且通过
全部发布门的镜像，才可用于独立插件正式编译和部署。当前 V1 目录说明继续描述旧公开
输入；组功能开启时新宿主的生产账号变更要求唯一新参与者，旧 guard-only 插件不能
直接作为兼容组合。账号/组业务权限仍由独立扩展实现，宿主不增加业务管理 HTTP API。

`io.kestra.webserver.oidc.UserDirectoryV2` 继承 V1，新增
`createTemporary(username,name,email)` 和 `delete(subject,revision)`。前者返回
`TemporaryUser(user,temporaryPassword)`，宿主生成随机临时密码，仅本次返回且 toString
脱敏；调用方必须 no-store、禁止日志和浏览器存储、关闭页面清内存，不能 GET 重取。
新账号必须首次改密，临时凭据不能建立正常 IdP/UI 会话或取得 code/token。
subject 永远是不可改登录名；删除后持久退役，不可同名重建，不删除历史执行/审计。

空资料公开契约（2026-10-28；仅对应提交 CI 与正式镜像推广成功后可消费）：V2
`createTemporary` 及目录 `update` 的姓名、
邮箱接受 null、空字符串和无控制字符的纯空白，统一存储并由 `find/list` 返回空字符串，
不编造 subject、`@localhost` 或“—”资料。非空字段仍最多256字符、不得带首尾空白或
控制字符；超长或控制字符纯空白仍拒绝。V1 `create` 保留 null 默认显示名/邮箱的既有
行为，不能据此假定 V2 也默认补全。更新空邮箱清除 email_verified，相同非空邮箱保留
该标记，其他邮箱变化清除标记。资料更新只推进目录 revision，不改变登录名、active、
角色、凭据或认证版本；旧 revision 拒绝且不保存。本地完整门通过不替代对应提交 CI、
正式镜像推广或部署仓组合验收。

生产登录以临时密码进入 `/oidc/password`，使用独立 HttpOnly、SameSite=Strict 的
`oidc_password_change` cookie（`/oidc`，10 分钟）。GET 返回主题/语言一致的独立表单。
POST 字段固定为 `csrf`、`password`、`confirmation`（不是 `csfr`）；Origin 必须精确为
issuer 的 scheme://authority。密码沿用至少8字符、最多72 UTF-8字节边界，不能复用临时
密码。成功 303 到 `/oidc/login`，清受限 cookie 并单次消费交互，必须重新生产登录。
同源 CSRF 错误返回403且无凭据字段；非法/不一致密码返回400及可重试表单；过期/已消费
交互返回410、清 cookie 并提供登录入口；存储故障503。全部响应 no-store，不回显密码。
外源请求可能在宿主 CORS 层先被403拒绝；不得为显示表单放宽该规则。公开退出入口
`/oidc/logout` 同时撤销受限交互并清 cookie，不依赖业务导航或管理权限。

`TrustedIdentityV2.current(Connection)` 在调用方可写 READ_COMMITTED 连接重验当前可信
请求，不另开连接，不 commit/rollback/close。已失效的actor/认证版本/可信claim或授予
返回既有生命周期FORBIDDEN；SQL、投影故障或损坏、缺失/重复组件返回UNAVAILABLE。
V1普通身份验证保持原失败契约；分派保留明确拒绝，不将未知运行错误视为权限拒绝。
普通授权评估可以调用`TrustedIdentityV2.currentForAuthorization()`；该default方法默认
委派旧`current()`，旧实现无需改动。宿主覆盖此入口，明确的SQL/连接/投影故障或provider
报告的`io.kestra.webserver.rbac.AuthorizationUnavailableException`通过typed链返回503
固定安全ProblemDetail。异常消息固定为`Authorization dependency is unavailable`，
不携带SQL或cause。未知运行异常、未知路由、独立授权provider缺失/重复保持原拒绝门；
不按异常消息或任意cause搜索分类。新入口使用自己的事务，不借用V2连接入口结束事务。
唯一 `IdentityLifecycleParticipantV1`
实现 `beforeChange(Connection,Change)`，Change 含 contractVersion=1、kind、issuer、
subject/clientId 和宿主重验后的 actor。kind 为 ACCOUNT_DELETE/ACCOUNT_ACTIVATE/
ACCOUNT_DEACTIVATE/PASSWORD_RESET/CLIENT_SECRET_ROTATE。扩展在借用连接中检查管理权、
最后管理员并在删除时清理所有组授予；异常全部回滚。禁止删除当前 actor；缺失/重复
参与者失败关闭。R24 同连接设计为主控裁决，维护者可以复核。

`ClientCredentialsV1.status(clientId)` 返回 clientId、clientType（PUBLIC/CONFIDENTIAL）、
secretSet、maskedHint、credentialRevision、rotationMode（NONE/ONLINE/DEPLOYMENT_MAINTENANCE）。
不返回哈希或旧明文。历史无提示时 maskedHint=null，UI 必须显示“已设置，提示不可用”。
`rotate(clientId,credentialRevision)` 要求唯一生命周期参与者，原子生成新值并保存哈希、
头3 + `••••••••` + 尾4提示和递增修订，返回 `IssuedCredential(status,clientSecret)`，仅
本次下发。public 与配置登录 client 在线轮换拒绝；旧 revision 冲突不自动重试；普通
轮换不改变已有用户 token 有效期。调用控制器自行保证 READ/MANAGE、CSRF 和审计脱敏。

#### 受限维护 CLI

宿主类 `io.kestra.webserver.oidc.cli.OidcClientCredentialsCommand` 提供独立 main，不启动
服务、迁移或真实插件。只操作标准协议表，必须已有完整安装和持久安装凭据。维护者
持有数据库与凭据卷管理权限；CLI 本身不代替这些部署权限。需显式传入环境变量：

| 变量 | 用途 |
|---|---|
| OIDC_MAINTENANCE_JDBC_URL / OIDC_MAINTENANCE_JDBC_USER / OIDC_MAINTENANCE_JDBC_PASSWORD | 同一安装的维护数据库连接；不得写入日志或报告 |
| OIDC_MAINTENANCE_ISSUER | 与安装精确一致的 issuer |
| OIDC_MAINTENANCE_LOGIN_CLIENT_ID | 当前配置登录 client ID；不是普通登记目标 |
| OIDC_MAINTENANCE_RECEIPT_PATH | 容器中可信安装凭据路径，通常 `/app/storage/.oidc-installation` |
| OIDC_MAINTENANCE_MAX_CLIENTS / OIDC_MAINTENANCE_MAX_CLIENTS_PER_USER | 与部署登记限制一致，默认1000/20；范围1–100000/1–1000 |

普通 confidential client 的正式登记入口是 `register-confidential <metadata.json>`，不是
直接 SQL 或内部服务。JSON 只含 clientId、ownerSubject、redirectUris、grantTypes、
protocolScopes；无组/角色/权限字段。owner 必须真实存在且可登录；不覆盖配置登录 client
或同名记录。redirect 至多10个且不重复，仅 HTTPS 或 loopback HTTP，禁止 userinfo、
fragment 和通配符。grantTypes 必须含 authorization_code，只允许附加 refresh_token。
protocolScopes 必须含 openid，仅可含 profile/email/offline_access/mcp:flows:read/
mcp:executions:write。登记不赋予组或资源权限，后续仍走标准 owner consent。

```json
{"clientId":"service-example","ownerSubject":"existing-login-name","redirectUris":["https://client.example/callback"],"grantTypes":["authorization_code","refresh_token"],"protocolScopes":["openid","profile","email"]}
```

在已有部署配置中显式传维护环境变量，使用相同固定镜像和安装凭据卷。以下命令仅
创建一个运行 CLI 的容器，不启动 PostgreSQL 或完整服务，不编译插件 jar 或构建镜像：

```bash
docker compose run --rm --no-deps --entrypoint java \
  -e OIDC_MAINTENANCE_JDBC_URL -e OIDC_MAINTENANCE_JDBC_USER -e OIDC_MAINTENANCE_JDBC_PASSWORD \
  -e OIDC_MAINTENANCE_ISSUER -e OIDC_MAINTENANCE_LOGIN_CLIENT_ID -e OIDC_MAINTENANCE_RECEIPT_PATH \
  -v "$PWD/client-registration.json:/run/client-registration.json:ro" \
  kestra -cp /app/kestra io.kestra.webserver.oidc.cli.OidcClientCredentialsCommand \
  register-confidential /run/client-registration.json
```

成功 stdout 是一次性 JSON，含新 secret，不能写入普通日志/截图/报告；stderr 错误脱敏，
失败退出码1。响应丢失不会补发旧值；普通登记重复失败且不改原值，后续通过公开轮换
取得新版本。`status <clientId>` 返回无敏感字段状态，可先取得维护所需 revision。

配置登录 client 禁止在线重置，使用同一 CLI（上例命令末尾替换为以下参数）：

```text
status <clientId>
prepare <clientId> <当前revision>
cancel <clientId> <当前revision>
activate <clientId> <prepare时revision>
rollback <clientId> <activate后revision>
confirm <clientId> <activate后revision>
```

prepare 只一次性输出待激活 secret，不影响旧登录；cancel 丢弃待激活版本。维护窗口
必须先停止宿主 JVM、同步消费端 secret 配置，再 activate（修订+1），更新 Compose 并
启动 JVM，通过真实生产登录验证。失败时停止 JVM，以专用 rollback（修订再+1）恢复
旧哈希，并恢复旧消费配置后启动；成功后 confirm 清除回退材料。旧哈希不经 HTTP 返回，
不长期同时接受两个值。CLI 不自动证明 JVM 已停止或真实登录已通过，这些是部署验收门。
R25 维护流程为主控裁决，维护者可以复核；未经完整维护回退验收不能宣称 T8 通过。

- [MCP 客户端交互流程与集成约束](docs/mcp-oauth-integration.md)
- [OIDC 服务与首次安装契约](docs/r-oidc-server.md)
- [R-EE-RBAC 扩展边界](docs/r-ee-rbac.md)

## 应用组协议契约

应用组、scope、应用支持登记、用户授予、权限元数据、业务初始化和管理 UI/API 归独立插件。
本仓不提供可写组目录、组业务表、组初始化 CLI 或最后管理员业务判断。旧宿主目录及其
CLI 已从正式64c4498移除，不提供兼容转发。该版本的协议契约已通过正式CI与镜像
推广；不得用相邻源码、候选executable或不含所需契约的旧镜像编译并交付匹配插件。

公开 Java 契约位于 `io.kestra.webserver.oidc`：

| 契约 | 职责 |
| --- | --- |
| `ApplicationGroupProtocolProjectionV1` | 扩展在宿主提供的同一事务连接中，为精确 issuer、tenant、client、subject 和可选 token 组 ID 返回只读协议投影 |
| `ApplicationGroupProtocolProjectionV2` | REQ-0383：同连接返回可为空的精确资源 `resourceAudiences`，不自动补入登录 clientId；V1 语义不变 |
| `OidcProtocolStateV1` | 标准账号/client 状态、有效 pending 登记查询、可登录性、安装前置核对和统一安全锁；不返回凭据或组业务数据 |
| `IdentityLifecycleGuardV1` | 宿主提交账号状态、密码和 client 撤销/删除前调用扩展；扩展判断业务约束，拒绝或异常回滚 |
| `TrustedIdentityV1` | 读取当前已经验证的身份；构造 DTO 不代表认证成功 |
| `ApplicationScopeDeclarationsV1` | 返回应用权限 key/name 元数据，供 consent 展示；不执行资源授权 |

扩展资源授权继续使用 `io.kestra.webserver.rbac.AuthorizationEvaluationProviderV2`，接收可信
身份和 tenant，并返回 `AuthorizationEvaluationV1` 句柄。实际应用权限由扩展自己的策略
决定，不能从 OAuth 协议 scope、角色名称、描述或权限元数据副本推断。

候选开关必须合并到完整 OIDC 配置，不能替代数据库、issuer、凭据、回调和安全过滤配置：

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
    application-groups:
      enabled: true
micronaut:
  security:
    oauth2:
      clients:
        kestra:
          scopes: [openid, profile, email, 'kestra:application-group-scopes']
```

协议保持单一、精确的 issuer 和共享端点。经签名的组 claim 包含组 ID、client ID、组 scope、
协议 scope 和撤权版本，不改写 `iss`。scope key 与应用权限 key 是不同概念；scope 的名称和
说明不作为授权依据。可获得 scope 的上限为应用支持与用户获授的交集，再受请求和 consent
限制。协议 scope 还须位于当前 client 注册上限内，refresh 不能恢复已撤销的范围。

`TrustedIdentityV1.Identity` 中，`issuer/subject/clientId/audiences` 必须来自已验证身份；
`tenant/applicationGroupId/applicationGroupScopes` 必须匹配当前投影。`authenticationVersion`
是账号认证版本，`authorizationVersion` 是组撤权 epoch，`directoryRevision` 表示当前组数据
修订，不能互相替代。UI 要求标准配置登录 client 的精确受众，MCP 要求当前 Bearer 和精确
resource audience。UI selector 不是角色，也不作为最终身份的业务 scope。

REQ-0383 的 V2 使用 `currentResources(Connection, V1.Request)` 返回 V2.Result（版本2）。
Projection 的资源字段为 `resourceAudiences`，其余目标、组版本和 scope 元数据与 V1 相同。
V2 继承 V1 仅用于唯一 provider 发现；其 V1 `current` 默认拒绝，不能当作 V1 投影使用。
只提供一个版本的 provider。V1 保持 approved 非空及包含登录 audience 的既有语义。
V2 允许空资源集合，不补 clientId、不表示全域；ID/UI 仍精确当前 clientId，未请求
resource 的标准 access aud 仍为 clientId，资源 access/MCP 必须精确当前登记的 resource。
普通 client 不会因资源为空获得配置 UI client 资格，普通 access 不能用于 MCP。

V2 签名组 claim 追加 `audience_contract_version=2`，code/refresh 使用
`application-group-v2.<组ID>.<epoch>.` 前缀。带资源 access 另含签名的精确 `resource`。
V1/V2 provider 切换使旧组凭据拒绝，用户必须重新生产登录，不自动转换或扩权。
当前资源收窄后旧带资源 token/refresh 拒绝；空→非空不扩大旧 code/refresh 的资源。
签名、issuer、组、epoch、协议 scope 上界不变。候选未经完整发布门不能用于插件正式编译。

连接属于宿主事务调用方。投影和 guard 不得提交、回滚、关闭该连接或另开连接替代检查。
授权状态变更使用 `READ_COMMITTED`；先取得公开安全锁，再取得扩展目录/策略锁，最后取得
标准账号/client 行锁。宿主账号和 client 生命周期保留各自的标准所有者与版本校验。
缺组件、重复组件、目标不符、异常和存储故障必须失败关闭，不回退旧组目录或角色推断。

缺投影 provider 或业务未初始化时，配置 UI client 可以进行不带组 claim 的标准零授权登录。
该会话不能取得业务权限。provider 恢复后必须重新走生产登录；旧授权码和 refresh 不会
自动增加组身份。已绑定组的凭据也不能在缺 provider 时降格继续使用。退出与换号不依赖
业务权限。业务初始化与管理的公开契约由插件维护，不再执行旧宿主目录 CLI。

普通应用接入时，先通过标准 DCR 取得 pending client，再由插件登记其应用支持范围，随后
进行生产 authorize/owner consent。有效 pending client 只能预览已经登记且用户可获得的
scope；预览不创建 token 或授权码。所有权确认后，绑定与签发必须重新核对当前有效状态，
过期或撤销不能因先前预览通过而继续签发。插件只通过公开 pending 查询验证登记前置。

当前源码、验证范围和发布限制见 `docs/r-oidc-server.md` 的职责纠正及只读接线记录。

### ID 查询域的首版适配范围

| 消费入口 | 受限 resource ID |
|---|---|
| JDBC 通用查询的 FLOW、EXECUTION | 每个 term 独立编译 namespace 与 `id` 条件，分页、total、聚合前过滤 |
| FLOW、EXECUTION 精确资源 predicate | 按完整 `(namespace,id)` term 判断，不做笛卡尔积 |
| JDBC tenant MCP_SERVER 列表 | 用独立 tenant 资源域限制 server ID，不解释 namespace |
| NAMESPACE、LOG、TRIGGER、KV_METADATA、NAMESPACE_FILE_METADATA 的通用 JDBC 查询 | ALL_IDS 按 namespace term 过滤；RESTRICTED_IDS 未适配，明确拒绝 |
| namespace-only predicate、日志 AccessScope 与未适配后端 | 不丢弃 ID 后降级允许；RESTRICTED_IDS 明确拒绝 |

MCP 工具业务仍须同时满足协议能力门和扩展应用的资源授权。以上支持表不意味着其他后端、
全量业务页面或所有 ID 维度已经验收；新增适配必须重新提供真实查询和无泄露证据。


协议 scope 的分类词汇表与 client 注册上界是两件事。宿主通过标准协议查询在同一连接
读取当前有效 client 注册：协议项必须在该上界内，refresh 也重新检查；应用组角色
不重复写入协议注册。UI selector 必须显式注册并匹配标准配置登录 client，不能从
应用组成员的额外身份类别推断。全局 MCP 能力词汇表不能扩大 client 注册范围。

资源查询域的 namespace exact/subtrees 逐值使用 `[A-Za-z0-9_-]+(?:[.][A-Za-z0-9_-]+)*`；
资源 ID 必须非空、不带首尾空白或控制字符。有效 opaque ID 保留原字节，不按冒号、
斜线或其他符号推断资源含义。codec 的结构校验不能替代这些构造边界的语义检查。
