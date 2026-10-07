# kestra-overlay

## 定位

Kestra 侧**薄 overlay 构建仓**（浅层兼容层核心）：CI 时克隆上游 kestra-io/kestra（pin 固定 commit）→ apply 薄 patch → 注入扩展仓 jar 产物 → 构建镜像 → push `ghcr.io/ai-specs`。**不携带上游全量代码，不跑上游全量 CI**（只测定制扩展点）。

骨架原则：**基于上游某一版本全新建立，不是 fork 版本的搬运**。fork 栈形态（实证于 app-kestra）：base 镜像只是运行时环境，**webserver 二进制是宿主编译的 executableJar（含全部 webserver M 文件/migration 定制）并拷入镜像 docker/app/kestra**；因此本仓 = **薄源码 patch**（改写上游源码、编译进 webserver jar 的面）+ 扩展 jar 注入（`plugins/` 槽）。**Dockerfile / Dockerfile.base 用上游原样**（不 patch 构建文件）。

## 上游扩展对象（Upstream Extension Target）

- **上游仓库**：kestra-io/kestra（BASE pin 见 `patches/BASE`，upstream/develop 固定 commit）
- **扩展对象**（对上游源码的改写，压到最小）：薄 patch 三类（过渡期 = fork 当前定制原样，行为等价；随扩展仓出仓逐步收窄为激活/注册/占位）：
  - `patches/webserver/`：9 个核心 M 文件（ErrorController、McpServerController、MiscController、NotFoundHeadersFilter、ProblemResponseFilter、ApiMcpServer、TenantAliasingRooter、UiIndexService、AiServiceManager）
  - `patches/migration/`：3 个 dsh migration（2.0.29/2.0.30/2.0.31 新增 sql，挂上游 schema 链）
  - `patches/build/`：settings.gradle（oidc-provider 模块）、cli/build.gradle、core OutputValues.java、docker-entrypoint.sh
- **ui M 文件**（routes/main/i18n/translations/override）→ **本轮不收**：fork 镜像不编译 ui（官方/上游预编译资源），收 patch 不生效；其集成点归扩展仓前端包 + 后续 ui 加载机制决策（目标文档 §3.1 的 ui M → overlay 薄 patch 映射在正式实施阶段处理）

## 骨架设计（overlay 只做三件事）

1. **克隆上游 pin 版本** → `git apply --check` 全部 patch 一次成功（`--apply-only` 门）。
2. **apply 薄 patch**：三组 patch（webserver 9 / migration 3 / build 4），`--check` 先行。
3. **注入扩展仓产物**（`scripts/build-extensions.sh`，bash 3.2 兼容）：
   - 9 个扩展仓（排除两个 overlay 仓）中，**kestra 侧 4 个**参与 kestra 镜像/镜像族：
     - `plugin-apps-harness` → kestra 插件 jar → `$WORK/plugins/`（Dsh* 安全面 13/13）
     - `plugin-apps-amis` → kestra 插件 jar → `$WORK/plugins/`（声明式 Amis apps 触发）
     - `kestra-oidc-provider` → **独立 IdP 镜像**（自己的扩展仓 CI 构建推送，不烤进 kestra 镜像）
     - `plugin-relay-dsh` → **独立联动转发镜像**（同上）
   - jar 源优先级：`EXT_JAR_<NAME>` 环境变量 → `extensions/<name>/`（仓内 checkout）→ 否则跳过（NOT INJECTED）
   - 注入清单 `$WORK/.overlay-extensions.json`；**本仓不 vendored 任何扩展 jar 二进制**——扩展 jar 只来自扩展仓构建产物（env 或 extensions/ 目录），未迁移的扩展自动 NOT INJECTED
4. **编译 webserver**：`./gradlew executableJar`（薄 patch 后的上游源码，Java 25 toolchain）→ 拷入 `$WORK/docker/app/kestra`（镜像运行时二进制）
5. **构建镜像**：`docker buildx` 用**上游 Dockerfile.base/Dockerfile 原样**（FROM temurin-jre25 base + COPY docker/ + plugins bind-mount）→ push `ghcr.io/ai-specs/kestra-overlay:{sha|latest}`

## 明确不属于本仓的内容（fork 残留已剔除）

- `patches/webserver/*`（11 个）、`patches/ui/*`（9 个）、`patches/migration/*`（4 个 + apply.sh）——**全部删除**：镜像不编译 java/ui 源码（死代码），且 ui patch 引用 fork 自产组件（`UserItem.vue` / `AppList.vue` / `csrf.ts`，均不在 patch 中），migration 是 dsh 业务面（employee/metrics/approval 持久化）——**归扩展仓以 jar 内 migration 资源承载**
- `deploy/cli-build.gradle.patch`（依赖不存在的 `:oidc-provider` gradle 项目——装配归 kestra-oidc-provider 扩展仓）
- `deploy/core OutputValues.java.patch`（fork 业务逻辑改上游核心类）
- `deploy/docker-compose.yml.patch`（fork 防呆替换上游 compose——非扩展点）
- `deploy/docker-entrypoint.sh.patch`（fork shadowJar 回退——overlay 用官方 base/官方 entrypoint）

## 构建与 CI

- 工作流 `overlay-build`（2 job）：`patch-verify`（--apply-only 门）→ `build-push`（镜像 + ghcr 推送）
- runner pin `ubuntu-24.04`；无 Node20 弃用告警（checkout@v5 + shell `docker login`）
- CI 时长：patch-verify ~14s / build-push ~28s

## 关联项目

- kestra 侧扩展仓：plugin-apps-amis / plugin-apps-harness / kestra-oidc-provider / plugin-relay-dsh
- `harness-overlay`：harness 侧对应薄 overlay 构建仓
- 目标规格：dsh-monorepo `docs/dsh-compat-layer-target.md`（验收导向）
