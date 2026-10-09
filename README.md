# kestra-overlay

面向**第三方独立扩展项目**的 kestra 增强镜像与扩展契约提供方。

镜像 = 上游 kestra OSS（版本由 `patches/BASE` pin，当前 **v2.0.5** @ `172dd0f3`）+ 薄 patch。
加固形态（no-plugins 谱系）：镜像不携带任何插件/扩展 jar，插件集由部署侧精确控制。

**当前镜像内容物边界（务必先读）**：本镜像只包含**后端引擎与 API**。上游 UI 前端资产
**不在镜像内**（`/ui/` 返回 404 是预期，不是故障）——API/UI 混排的完整形态属后续交付，
当前一切接入走 API。8080 端口 = API。

## 使用镜像

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

### compose 示例

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
          server:
            basic-auth:
              enabled: true
              username: admin@local.test      # 须为合法 email 形态
              password: Admin1234!            # 至少 8 位，含大写与数字
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
    ports:
      - "8080:8080"

volumes:
  kestra-data:
```

运行说明：

- **认证（重要）**：上游 OSS ≥0.24 **默认强制 basic auth**——不配 `kestra.server.basic-auth`
  则一切 `/api/v1/*` 返回 401。上例已内嵌最小凭据配置，改密后即可用。
- 主端口 **8080**（API；UI 资产不在镜像内，`/ui/` 404 属预期）。**8081** 是 management
  端点：缺省不暴露、**无鉴权**，仅开发用途。
- 配置只经 `KESTRA_CONFIGURATION` 环境变量进入；改配置、加插件、挂 jar 都**需重启**。
- 无预装插件：需要插件走 `./plugins` 挂载（重启）或运行期 API 安装（需 `auto-install.enabled: true`）。
- 若使用旧版构建（首启 `AccessDenied: /app/storage/plugins` 崩溃）：镜像缺 `/app/storage`
  预置属主所致——`docker run --rm -v <项目名>_kestra-data:/data alpine chown -R 1000:1000 /data`
  一次性修复，或使用已修复构建（2026-10-09 后）。

## 相对上游原始镜像的扩展能力

| 能力 | 状态 | 对集成方的意义 |
|---|---|---|
| OIDC 登录引导字段 | **已生效** | `GET /api/v1/configs/login`（注意：**login 子端点**，非 `/configs`）返回 `oidcAuthEnabled`；`micronaut.security.enabled=true` 时该字段为 true 且 `isBasicAuthInitialized=true`。⇒ 认证链部署下引导逻辑有判定依据 |
| plugins/ 插件槽 | 已生效（同上游） | 挂载 `/app/plugins` + 重启。任务/触发器/Runner 插件面；**bean（@Controller/@Filter）不在此槽**。插件版本线：**core 2.0.5 ↔ 插件 1.x 线**（如 `io.kestra.plugin:plugin-script-shell:1.14.0`；Maven 索引的 0.23.0 是旧 API 线，不兼容） |
| 部署配置通道 | 已生效（同上游） | `KESTRA_CONFIGURATION` 全量可用（含 basic-auth） |
| classpath jar 承载 | **契约已约定，承载待实施** | 实施后：`/app/libs` 挂载的契约 jar 进入应用 classpath（见下）。实施前挂载**不生效** |
| 端点门（intercept-url-map） | 依赖认证链 | 属 micronaut-security 配置面：**须先 `micronaut.security.enabled: true`** 才生效（只配 map 不开总开关 = 静默不生效）；认证链半落地后即为完整可用 |
| 内置 OAuth2/OIDC 授权服务器 + 认证链 | 预留（实施中） | R-OIDC-SERVER：协议端点（discovery/authorize/token/JWKS）与登录链将随镜像提供 |
| 外部细粒度授权对接点 | 预留 | SecurityRule/Authorizer bean jar 的对接（契约名见下） |

## 扩展能力 × 集成契约（同一条运行线）

运行时上，能力与契约不分家：契约 jar 挂载进 classpath，能力随之激活。
**允许交叉**：一个契约可以服务多项能力；一项能力可以由多个元素组合；
同一能力半的实现可互换（内置服务器 ↔ 外部 IdP）。当前约定的运行线：

```
（预留）R-OIDC-SERVER：内置授权服务器 + 认证链（实施中）
                                      → 认证能力：
                                          ① OIDC 登录引导字段（已生效，/api/v1/configs/login）
                                          ② 认证链 + ③ 端点门（随 R-OIDC-SERVER 落地；
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
