# kestra-overlay

## 定位

Kestra 侧**薄 overlay 构建仓**（浅层兼容层核心）：CI 时克隆上游 kestra-io/kestra（pin 固定 commit）→ apply 薄 patch → 注入扩展仓 jar 产物 → 构建镜像 → push `ghcr.io/ai-specs`。**不携带上游全量代码，不跑上游全量 CI**（只测定制扩展点）。

骨架原则：**基于上游某一版本全新建立，不是 fork 版本的搬运**。镜像形态 = 官方 `kestra-base`（预编译 jar/UI）+ 扩展仓 jar（`locals/plugins` 注入 `/app/plugins`）——**java/ui 源码在本镜像中不编译**，因此 fork 的 webserver/ui/migration 源码 diff 不属于骨架（归各扩展仓承载），骨架只保留**真正在镜像中生效**的唯一源码级修改点。

## 上游扩展对象（Upstream Extension Target）

- **上游仓库**：kestra-io/kestra（BASE pin 见 `patches/BASE`，upstream/develop 固定 commit）
- **扩展对象**（对上游文件的修改，压到最小）：
  - `Dockerfile` — 官方插件 COPY 路径 `plugins/.` → `locals/plugins/.`（扩展 jar 注入点；overlay 镜像里唯一生效的源码级 patch）
- 其余 fork 源码面（webserver 控制器/filter/migration、ui 集成点、cli/build.gradle、core OutputValues、docker-compose、docker-entrypoint）→ **不在骨架**：镜像不编译它们，且它们属于扩展仓业务面（见下）

## 骨架设计（overlay 只做三件事）

1. **克隆上游 pin 版本** → `git apply --check` 全部 patch 一次成功（`--apply-only` 门）。
2. **apply 薄 patch**：仅 `patches/deploy/Dockerfile.patch`（locals/plugins 注入点）。
3. **注入扩展仓产物**（`scripts/build-extensions.sh`，bash 3.2 兼容）：
   - 9 个扩展仓（排除两个 overlay 仓）中，**kestra 侧 4 个**参与 kestra 镜像/镜像族：
     - `plugin-apps-harness` → kestra 插件 jar → `locals/plugins/`（Dsh* 安全面 13/13）
     - `plugin-apps-amis` → kestra 插件 jar → `locals/plugins/`（声明式 Amis apps 触发）
     - `kestra-oidc-provider` → **独立 IdP 镜像**（自己的扩展仓 CI 构建推送，不烤进 kestra 镜像）
     - `plugin-relay-dsh` → **独立联动转发镜像**（同上）
   - jar 源优先级：`EXT_JAR_<NAME>` 环境变量 → `extensions/<name>/`（仓内 checkout）→ `locals/plugins/<name>/`（vendored）
   - 注入清单 `$WORK/.overlay-extensions.json`；骨架状态：`locals/plugins` 携带试点 bootstrap Dsh* jar（plugin-apps-harness 基座），镜像已含安全面
4. **构建镜像**：`docker buildx` 基于 patch 后上游 Dockerfile（官方 base + locals/plugins 合并）→ push `ghcr.io/ai-specs/kestra-overlay:{sha|latest}`

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
