# kestra-overlay

面向**第三方独立扩展项目**的 kestra 增强镜像与扩展契约提供方。

镜像 = 上游 kestra OSS（版本由 `patches/BASE` pin，当前 **v2.0.5** @ `172dd0f3`）+ 薄 patch。
加固形态（no-plugins 谱系）：镜像不携带任何插件/扩展 jar，插件集由部署侧精确控制。

## 使用镜像

### 下载

镜像在 GHCR 公开发布，无需登录直接拉取：

```bash
docker pull ghcr.io/ai-specs/kestra-overlay:v2.0.5-no-plugins
```

多架构：镜像提供 `linux/amd64` 与 `linux/arm64`。

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

## 扩展能力 × 集成契约（同一条运行线）

运行时上，能力与契约不分家：契约 jar 挂载进 classpath，能力随之激活。
**允许交叉**：一个契约可以服务多项能力；一项能力可以由多个元素组合；
同一能力半的实现可互换（内置服务器 ↔ 外部 IdP）。当前约定的运行线：

```
（预留）R-OIDC-SERVER：内置授权服务器 + 认证链（一体化 patch 路线）
                                      → 认证能力：
                                        ① OIDC 登录引导（镜像内置，已生效）
                                        ② 认证链 + ③ 端点门（② 随 R-OIDC-SERVER 实施；
                                           外部 IdP 场景走同一内置链的配置）
                                              ↓ 授权能力叠加在认证层之上
（契约）kestra-rbac-authorizer.jar ────→ 授权能力：每请求 (资源,动作,namespace) 判定

（同上游）./plugins 挂载 ──────────────→ 插件能力（任务/触发器/Runner；bean 不走此槽）
```

| 运行线元素 | 形态 | 交付/参与的能力 | 状态 |
|---|---|---|---|
| OIDC 登录引导字段（`oidcAuthEnabled` 等） | 镜像内置（patch 已实施） | 认证能力·引导半 | **已生效** |
| R-OIDC-SERVER（链一体化） | 预留 patch 扩展点 | 认证能力·链半与 IdP 半；授权能力的前置 | 预留（2026-10-07 前置裁定②） |
| 端点门（`intercept-url-map`） | 配置通道（`KESTRA_CONFIGURATION`） | 认证能力·门半（依赖链半在位） | 同上游可用 |
| R-OIDC-SERVER | 预留 patch 扩展点（内嵌授权服务器） | 认证能力·IdP 半（与外部 IdP 可互换） | 预留 |
| `kestra-rbac-authorizer.jar` | classpath 契约 | 授权能力（对接面与验收判据见 `docs/r-ee-rbac.md`） | 契约已约定，承载待实施 |
| `./plugins` 挂载 | 插件槽 | 插件能力（与上列并行；bean 装不进此槽） | 同上游可用 |

classpath 承载（manifest 注入）实施前，契约 jar 挂载 `/app/libs` **不生效**——契约名先行
约定，集成方可按下列规则先行构建。

## jar 契约的构建与命名规则

规则：

- **文件名 = 契约**。镜像构建期会在 executable jar 的 manifest `Class-Path` 声明这些条目
  （镜像 ↔ 部署的唯一契约）；jar 本体一律由部署侧挂载 `/app/libs`，镜像不烤 jar 字节。
  需要新契约名时向本仓登记（`extensions.tsv` 加一行）。
- **构建要求**：jar 必须带 Micronaut 注解处理生成的 bean 索引；编译目标 = 镜像所基上游
  版本（`patches/BASE`，当前 v2.0.5 @ `172dd0f3`）的 Micronaut 平台。
- **行为语义**：挂载 + 重启生效；**缺席 = 静默休眠**（镜像其他功能不受影响）；同 FQN 类
  **不可覆盖**镜像内的类（主 jar 永远优先）——扩展 jar 只加新类；同包
  （`io.kestra.webserver.*`）的 `@Controller`/`@Filter` 可正常注册。

## 更多

内部治理（需求接收 / patch 质量法 / 升级 SOP）、机制原理（编译/重启/外部 jar）、
能力差异调查见 `AGENTS.md` 与 `docs/`。
