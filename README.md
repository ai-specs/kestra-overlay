# kestra-overlay

## 定位

Kestra 侧**薄 overlay 构建仓**（浅层兼容层核心）：CI 时克隆上游 kestra-io/kestra → apply 扩展点薄 patch（仅激活/注册/占位，不含业务逻辑）→ 烤扩展 jar → 构建镜像 → push ghcr。**不携带上游全量代码，不跑上游全量 CI**（只测定制扩展点）。

## 上游扩展对象（Upstream Extension Target）

- **上游仓库**：kestra-io/kestra
- **扩展对象**（必须改写上游文件的面，压到最小）：
  - webserver 8 个上游 M 文件（ErrorController、McpServerController、MiscController、NotFoundHeadersFilter、ProblemResponseFilter、ApiMcpServer、TenantAliasingRooter、UiIndexService、AiServiceManager 等）——只留激活/注册/占位
  - migration 追加（V2_0_29Dsh*、V2_0_30Dsh*、V2_0_31Dsh*、SqlScriptSplitter）
  - ui 集成点（routes.ts、i18n.ts、main.ts、override/*、kestraHttp.ts 等 M 文件）
  - 构建/部署定制（Dockerfile、docker-compose.yml、docker-entrypoint.sh、.github/workflows/*、cli/build.gradle、core OutputValues.java）

## 内容与来源

- 迁出自：`dsh-monorepo/app-kestra/`（fork 全量克隆 → 降级为薄 patch）
- **归属原则**：扩展点使用 vs 扩展点本身分离；A 类新增文件一律出仓（plugin-apps-harness / kestra-oidc-provider / plugin-relay-dsh / plugin-apps-amis），只有必须改写上游文件的位置才进 overlay

## 构建与 CI

- CI 链：克隆上游 → apply 薄 patch（`git apply --check` 一次成功）→ 烤扩展 jar → 构建镜像 → 测定制扩展点（扩展仓测试 + 一次集成冒烟）→ push ghcr
- CI 时长目标：触发到全绿 ≤ 20 分钟（依赖缓存命中后）

## 关联项目

- kestra 侧扩展仓：plugin-apps-amis / plugin-apps-harness / kestra-oidc-provider / plugin-relay-dsh
- `harness-overlay`：harness 侧对应薄 overlay 构建仓
- 目标规格：dsh-monorepo `docs/dsh-compat-layer-target.md`（验收导向）
