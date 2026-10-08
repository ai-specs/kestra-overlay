# kestra-overlay

面向**第三方独立扩展项目**的 kestra 增强镜像与扩展契约提供方。

镜像 = 上游 kestra OSS（版本由 `patches/BASE` pin，当前 **v2.0.5** @ `172dd0f3`）+ 薄 patch。
加固形态（no-plugins 谱系）：镜像不携带任何插件/扩展 jar，插件集由部署侧精确控制。

## 使用镜像

### 下载

```bash
docker pull ghcr.io/ai-specs/kestra-overlay:v2.0.5-no-plugins
```

| tag | 含义 |
|---|---|
| `v2.0.5-no-plugins` | 主 tag = 上游 release + 后缀；升级跟随上游 release |
| `<short-sha>` | 本仓 commit（构建可追溯） |
| `latest` | 滚动便利 tag |

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
      interval: 30s
      retries: 10

  kestra:
    image: ghcr.io/ai-specs/kestra-overlay:v2.0.5-no-plugins
    command: server standalone
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
              enabled: false   # 加固基线：静态插件集（镜像未烤关该开关，由部署侧声明）
    ports:
      - "8080:8080"

volumes:
  kestra-data:
```

运行说明：

- 主端口 **8080**（UI + API）。**8081** 是 management 端点：缺省不暴露、**无鉴权**，仅开发用途。
- 配置只经 `KESTRA_CONFIGURATION` 环境变量进入（selfrun 写入 application.yml）；改配置、加插件、挂 jar 都**需重启**。
- 无预装插件：需要插件就走 `./plugins` 挂载（重启）或运行期 API 安装（需 `auto-install.enabled: true`）。

## 相对上游原始镜像的扩展能力

| 能力 | 状态 | 对集成方的意义 |
|---|---|---|
| OIDC 登录引导字段 | **已生效** | `/api/v1/configs` 暴露 `oidcAuthEnabled`；`micronaut.security.enabled=true` 即视为「已配置认证」；无 BasicAuthService 时相关探测端点兜底。⇒ 外部认证链部署下，UI 不会掉进 Basic Auth 向导 |
| plugins/ 插件槽 | 已生效（同上游） | 挂载 `/app/plugins` + 重启。任务/触发器/Runner 插件面；**bean（@Controller/@Filter 等）装不进此槽** |
| 部署配置通道 | 已生效（同上游） | `KESTRA_CONFIGURATION` 全量可用 |
| classpath jar 承载 | **契约已约定，承载待实施** | 实施后：`/app/libs` 下挂载的契约 jar 进入应用 classpath（见下）。实施前挂载不生效 |
| 内置 OAuth2/OIDC 授权服务器 | 预留（R-OIDC-SERVER） | 将以内嵌 patch 形态随镜像提供，无需外部 IdP |
| 外部细粒度授权对接点 | 预留（R-EE-RBAC） | SecurityRule/Authorizer bean jar 的对接面与验收判据见 `docs/r-ee-rbac.md` |

## 集成契约：classpath jar 怎么约定

| 契约文件名 | 用途 |
|---|---|
| `kestra-auth-chain.jar` | 认证链：micronaut-security 过滤器链 + OIDC 端点 bean |
| `kestra-rbac-authorizer.jar` | 授权判定：SecurityRule/Authorizer bean + 角色模型 |

规则：

- **文件名 = 契约**。镜像构建期会在 executable jar 的 manifest `Class-Path` 声明这些条目
  （镜像 ↔ 部署的唯一契约）；jar 本体一律由部署侧挂载 `/app/libs`，镜像不烤 jar 字节。
  需要新契约名时向本仓登记（`extensions.tsv` 加一行）。
- **构建要求**：jar 必须带 Micronaut 注解处理生成的 bean 索引；编译目标 = 镜像所基上游
  版本（`patches/BASE`，当前 v2.0.5 @ `172dd0f3`）的 Micronaut 平台。
- **行为语义**：挂载 + 重启生效；**缺席 = 静默休眠**（镜像其他功能不受影响）；同 FQN 类
  **不可覆盖**镜像内的类（主 jar 永远优先）——扩展 jar 只加新类；同包
  （`io.kestra.webserver.*`）的 `@Controller`/`@Filter` 可正常注册。
- **当前状态**：承载机制（manifest 注入）待本仓实施（R-CLASSPATH-MERGE）；契约名先行
  约定，集成方可按上述规则先行构建。

## 更多

内部治理（需求接收 / patch 质量法 / 升级 SOP）、机制原理（编译/重启/外部 jar）、
能力差异调查见 `AGENTS.md` 与 `docs/`。
