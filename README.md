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

**首次引导实施中（REQ-0133）**：下一版以 `/oidc/setup` 初始化 OIDC 用户和 UI client，
或使用 `KESTRA_OIDC_BOOTSTRAP_USERNAME/PASSWORD/EMAIL/NAME` 跳过表单。完成前，
下文 SQL 是当前版本路径；实施完成后会更新本节，不以计划描述已交付能力。

镜像内置 **OIDC 服务器、用户目录和 client 注册能力**，不预装默认账号、密码或
固定 OAuth client。首次启动会创建 PostgreSQL 表，不会自动创建用户/client。
`kestra.oidc.users` 目前只有配置模型，**尚无自动初始化实现，填写它不会生成账号**；
用户/client 管理 API 也尚未交付。当前部署必须在启动迁移后显式初始化数据库。

| 名称 | 含义与约束 |
|---|---|
| OIDC 用户 | `oidc_user.username` 为登录名和 OIDC `sub`；密码在 `oidc_user_auth_method` 中以 bcrypt 保存 |
| `kestra` | 下例的 Micronaut 客户端配置名称，决定 `/oauth/login/kestra` 与 `/oauth/callback/kestra` 路径；不是 client ID |
| `kestra-ui` | 下例为本实例 UI 选用的 client ID，可自定义；必须同时存在于配置与 `oidc_client` 注册表 |
| client secret | 部署方自行生成；配置值与注册表必须一致；当前 client 表保存 secret 原值，应限制数据库访问 |
| redirect URI | 必须精确注册，例如 `http://localhost:8080/oauth/callback/kestra`；含协议、域名、端口和路径 |
| 外部项目 client | 每个应用单独注册 client ID/secret/回调；不要复用 UI client 的凭据与回调 |
| 测试账号 | CI 使用 `tester / Passw0rd!`、`kestra-ui / local-ui-secret`，由测试向真实 PG 写入；不是镜像默认凭据 |

UI 使用 **OIDC Authorization Code + PKCE S256**，服务端 confidential client 换 token，
浏览器用 HttpOnly 认证 cookie。OIDC 模式完全停用 Basic Auth；不在 UI Basic Auth
表单填写 OIDC 用户。当前本机测试账号存在，是此前初始化了本机数据库，不代表新部署自带。

### compose 示例（内置 OIDC + UI）

下例用于本机 `http://localhost:8080`。将 `replace-with-your-client-secret` 替换为部署方
生成的 secret，并使用相同值注册 client。生产部署同时更换公开 URL/issuer/精确回调 URI；
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
              - pattern: /health
                access: [isAnonymous()]
              - pattern: /api/v1/configs/login
                access: [isAnonymous()]
              - pattern: /**
                access: [isAuthenticated()]
            oauth2:
              clients:
                kestra:
                  client-id: kestra-ui
                  client-secret: replace-with-your-client-secret
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

- **认证**：上例启用完整 OIDC 链，关闭 Basic Auth；启动后须按下一节初始化账号/client，
  再访问 `/ui/`。OIDC 未启用时才保留上游 vanilla Basic Auth 行为。
- 主端口 **8080**（API 与原版 UI，入口 `/ui/`）。**8081** 是 management
  端点：缺省不暴露、**无鉴权**，仅开发用途。
- 配置只经 `KESTRA_CONFIGURATION` 环境变量进入；改配置、加插件、挂 jar 都**需重启**。
- 无预装插件：需要插件走 `./plugins` 挂载（重启）或运行期 API 安装（需 `auto-install.enabled: true`）。
- 若使用旧版构建（首启 `AccessDenied: /app/storage/plugins` 崩溃）：镜像缺 `/app/storage`
  预置属主所致——`docker run --rm -v <项目名>_kestra-data:/data alpine chown -R 1000:1000 /data`
  一次性修复，或使用已修复构建（2026-10-09 后）。

### 首次初始化账号与 client

1. 将示例保存为 `compose.yml`，执行 `docker compose up -d`。
2. 等待 `curl --fail http://localhost:8080/.well-known/openid-configuration` 成功，确认迁移完成。
3. 用 bcrypt 工具生成自己密码的 `$2a$` 哈希。下例需要 Python 3 与 `bcrypt` 包
   （`python3 -m pip install bcrypt`），密码通过交互读取：

```bash
python3 -c 'import bcrypt,getpass; print(bcrypt.hashpw(getpass.getpass("OIDC password: ").encode(),bcrypt.gensalt(rounds=10,prefix=b"2a")).decode())'
```

4. 把生成的哈希填入下面占位符，client secret 与 compose 保持一致，再执行：

```bash
docker compose exec -T postgres psql -U kestra -d kestra -v ON_ERROR_STOP=1 \
  -v oidc_username='your-login-name' \
  -v oidc_email='you@example.org' \
  -v oidc_password_hash='replace-with-generated-bcrypt-hash' \
  -v oidc_client_id='kestra-ui' \
  -v oidc_client_secret='replace-with-your-client-secret' \
  -v oidc_callback='http://localhost:8080/oauth/callback/kestra' <<'SQL'
BEGIN;
INSERT INTO oidc_user (username, name, email, roles)
VALUES (:'oidc_username', :'oidc_username', :'oidc_email', '["user"]')
ON CONFLICT (username) DO NOTHING;
INSERT INTO oidc_user_auth_method (user_id, type, credential)
VALUES (:'oidc_username', 'PASSWORD', :'oidc_password_hash')
ON CONFLICT (user_id, type) DO NOTHING;
INSERT INTO oidc_client (client_id, client_secret, redirect_uris, grant_types, scopes)
VALUES (:'oidc_client_id', :'oidc_client_secret', jsonb_build_array(:'oidc_callback'),
        '["authorization_code","refresh_token"]', '["openid","profile","email"]')
ON CONFLICT (client_id) DO NOTHING;
COMMIT;
SQL
```

此命令只补缺失记录，不覆盖已有用户密码或 client 配置；重复执行不是改密/改回调操作。
数据库记录读取即时生效，无需重新构建镜像。配置变更仍需重启。
初始化后访问 `http://localhost:8080/ui/`，在内置 OIDC 页面输入刚注册的用户名与密码。

### 其他项目接入内置 IdP

消费应用从 `http://localhost:8080/.well-known/openid-configuration` 获取协议端点：
authorize `/oidc/authorize`、token `/oidc/token`、JWKS `/oidc/jwks`、userinfo `/oidc/userinfo`。
`localhost` 仅为本机示例；跨容器/跨主机应用使用部署的公开 issuer。

为每个消费应用在 `oidc_client` 单独注册 client 与精确回调，并配置其 SDK：issuer、
client ID、client secret（confidential client）、redirect URI、`openid profile email`、
授权码流及 PKCE S256。public client 的 `client_secret` 为空，强制 S256；不能将 secret
放入浏览器前端。外部应用不需要在 Kestra 的 Micronaut `clients` 中新增配置——该配置
仅用于 Kestra 自身作为消费客户端；服务端注册表才决定哪些外部 client 可以授权。

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
| 内置 OAuth2/OIDC 授权服务器 + 认证链 | **已生效** | REQ-0100~0132：协议端点、PKCE 授权码、内置登录与完整 UI 认证链；无预置用户/client，初始化见上；管理 API/配置自动初始化仍待实施 |
| 外部细粒度授权对接点 | 预留 | SecurityRule/Authorizer bean jar 的对接（契约名见下） |

## 扩展能力 × 集成契约（同一条运行线）

运行时上，能力与契约不分家：契约 jar 挂载进 classpath，能力随之激活。
**允许交叉**：一个契约可以服务多项能力；一项能力可以由多个元素组合；
同一能力半的实现可互换（内置服务器 ↔ 外部 IdP）。当前约定的运行线：

```
R-OIDC-SERVER：内置授权服务器 + 认证链（协议/UI 链已生效；管理与自动初始化待实施）
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
