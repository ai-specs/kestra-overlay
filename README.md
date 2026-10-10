# kestra-overlay

面向**第三方独立扩展项目**的 kestra 增强镜像与扩展契约提供方。

镜像 = 上游 kestra OSS（版本由 `patches/BASE` pin，当前 **v2.0.5** @ `172dd0f3`）+ 薄 patch。
加固形态（no-plugins 谱系）：镜像不携带任何插件/扩展 jar，插件集由部署侧精确控制。

**镜像内容物**：保留 BASE 的后端引擎、API 与原版 UI。构建先执行上游 UI 的
`npm ci && npm run build`，再打包可执行 jar；8080 同时提供 API 和 `/ui/`。
此前漏打 UI 是构建缺陷，不能将 `/ui/` 的 404 当作正常边界。

## 使用镜像

OIDC 模式统一使用 OAuth2/OIDC，完全关闭 Basic Auth 链。REQ-0132 替换 UI 的
认证守卫、401 跳转和退出；状态由服务端验证，不依赖 Basic Auth cookie/标志。
旧登录/setup 页面在 OIDC 模式不进入凭据流程；用户名密码提交在 `/oidc/login`。
部署与验收以 `docs/r-oidc-server.md` §0 为准，启用 Micronaut Security 并配置
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
| client secret | 部署方自行生成；配置值与注册表必须一致；当前 client 表保存 secret 原值，应限制数据库访问 |
| redirect URI | 必须精确注册，例如 `http://localhost:8080/oauth/callback/kestra`；含协议、域名、端口和路径 |
| 外部项目 client | 每个应用单独注册 client ID/secret/回调；不要复用 UI client 的凭据与回调 |
| 测试账号 | CI 使用 `tester / Passw0rd!`、`kestra-ui / local-ui-secret`，分别通过真实表单/环境变量初始化；不是镜像默认凭据 |

UI 使用 **OIDC Authorization Code + PKCE S256**，服务端 confidential client 换 token，
浏览器用 HttpOnly 认证 cookie。OIDC 模式完全停用 Basic Auth；不在 UI Basic Auth
表单填写 OIDC 用户。当前本机测试账号存在，是此前初始化了本机数据库，不代表新部署自带。

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
      - ./libs:/app/libs         # classpath 契约 jar（重启生效；状态见「扩展能力」表）
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
返回 429。服务端不抓取客户端提供的 URL，仅保存校验后的回调元数据。

```bash
curl --fail-with-body -X POST 'http://localhost:8080/oidc/register' \
  -H 'Content-Type: application/json' \
  -d '{"redirect_uris":["http://127.0.0.1:9999/callback"],"token_endpoint_auth_method":"none","grant_types":["authorization_code","refresh_token"],"response_types":["code"],"scope":"openid profile email","client_name":"Public OAuth client"}'
```

成功返回 201、随机 `client_id` 和确认的元数据，无 `client_secret`。消费方保存 client ID，
每次授权生成新的 verifier/challenge，携带 state/nonce；使用精确注册的回调换 token，
提交 `client_id`、code 和 `code_verifier`，不提交 secret。只允许 HTTPS 回调或 loopback
HTTP（localhost/127.0.0.1/[::1]），禁止 fragment、userinfo、通配符和非 loopback HTTP。
当前仅 public 授权码/refresh 注册；不提供 RFC7592 client 更新/删除管理或 MCP 专属端点。

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
