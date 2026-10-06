# patches

`BASE` 记录本批 patch 所基于的上游固定 commit（kestra-io/kestra，develop）。
overlay CI 先 checkout 该 SHA，再 `git apply`，避免上游演进破坏 patch。

| 目录 | 面 | 性质 |
|---|---|---|
| deploy/Dockerfile.patch | 官方插件 COPY 路径 `plugins/.` → `locals/plugins/.` | **镜像中唯一生效的源码级修改**：扩展 jar 注入点（overlay 镜像 = 官方 kestra-base + locals/plugins） |

## 已剔除（fork 残留，不属于骨架）

| 原目录 | 内容 | 理由与去向 |
|---|---|---|
| webserver/ | ErrorController、McpServerController、MiscController、NotFoundHeadersFilter、ProblemResponseFilter、ApiMcpServer、TenantAliasingRooter、UiIndexService、AiServiceManager 等 11 个 patch | 镜像不编译 java 源码（死代码）；业务面归扩展仓（plugin-apps-harness 等） |
| ui/ | routes/main/override/auth/basicAuth/kestraHttp 等 9 个 patch | 镜像不编译 ui 源码（死代码）；且引用 fork 自产组件（UserItem.vue / AppList.vue / csrf.ts，不在 patch 中）——UI 定制面由扩展仓以预编译产物/独立扩展承载 |
| migration/ | 2.0.29~31 dsh-* sql + SqlScriptSplitter（A 类新增） | dsh 业务面（employee/metrics/approval 持久化）→ 扩展仓 jar 内 migration 资源承载 |
| deploy/（部分） | cli/build.gradle（`:oidc-provider` 依赖）、core OutputValues.java、docker-compose.yml、docker-entrypoint.sh | 非扩展点 / fork 构建形态 / 装配归 kestra-oidc-provider 扩展仓 |

> 原则：java/ui 源码在本镜像中不编译 → 源码 diff 一律不进入骨架；真正生效的是扩展仓 jar（`locals/plugins` → `/app/plugins`）。
