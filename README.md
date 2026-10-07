# kestra-overlay

Kestra 侧**薄 overlay 构建仓**：立足上游某一 release（BASE pin）的架构能力，**补足
kestra OSS 相对 EE 故意阉割的架构扩展能力**（能力差异与补足决策见
`docs/oss-ee-gap.md`），并以**需求对齐的薄 patch** + 扩展仓 jar 注入的方式构建镜像：

```
克隆上游 kestra-io/kestra @ BASE（release tag + sha，patches/BASE）
  → 按序应用 patches/webserver/NNNN-*.patch（每 patch = 一个需求，头部注释记录需求背景）
  → 注入扩展仓 jar（scripts/build-extensions.sh，不 vendored 二进制）
  → 编译 webserver executableJar → 上游 Dockerfile 原样构建镜像 → push ghcr.io/ai-specs
```

**不携带上游代码、不跑上游全量 CI（只测定制扩展点）、不承载业务逻辑**（业务逻辑归
扩展仓；上游预留扩展点的激活/注册/占位归本仓 patch——硬边界见 `AGENTS.md` §0）。

## 快速命令

| 命令 | 用途 |
|---|---|
| `./scripts/check-patches.sh` | 质量门（结构校验，秒级；改 patch 后必跑） |
| `./scripts/check-patches.sh --apply-check <上游BASE树>` | 追加顺序应用验证 |
| `./scripts/build.sh --apply-only` | 克隆上游 + apply 全部 patch（apply 门） |
| `./scripts/build.sh` | 全量：apply → 编译 webserver → 镜像 → push ghcr |
| `./scripts/build-extensions.sh <WORK>` | 扩展仓 jar 收集注入（env > extensions/ > 跳过） |

## patch 集（2026-10-07 审计重整后）

阶段一范围 = 支撑 **plugin-apps-amis** 与 **kestra-oidc-provider** 两个扩展仓；
总账与 reserved 待激活点见 `patches/manifest.tsv`（check-patches.sh 强校验一致性）：

| patch | 需求 | 消费扩展仓 | 状态 |
|---|---|---|---|
| 0010-mcp-oauth-on-oss | MCP OAUTH 在 OSS 解禁 + 默认值 + PUT null-合并 | kestra-oidc-provider | core |
| 0011-oidc-login-boot | /configs OIDC 登录引导激活点 | kestra-oidc-provider | core |
| 0020-apps-namespace-catchall | apps 命名空间 catch-all 承载（控制器+路由索引+rooter 探测+405 归一） | plugin-apps-amis | transition |
| 0021-apps-antiprobe-empty404 | apps 防探测空 body 404（标记异常+handler+filter 消费） | plugin-apps-amis | transition |
| 0022-apps-shell-templates | apps.html/apps-editor.html 模板加载渲染 | plugin-apps-amis | core |

> 2026-10-07 审计结论：原 3 个粗粒度 patch（0001/0002/0003）中约 2/3 是**上游 develop
> 内容的回移**（BasicAuthService/RequestUtils/CookiesConfiguration/NotFoundHeadersFilter
> 纯回移，ErrorController/MiscController/UiIndexService 大半回移），已全部剔除——归因
> 方法与教训见 `AGENTS.md` §5.2/§8-6。patch 粒度由文件对齐改为**需求对齐**（维护者裁定）。

## CI（overlay-build）

`patch-verify`（check-patches.sh 结构门 → 上游克隆 → apply 门）→ `build-push`
（编译 webserver + 镜像 + ghcr，主 tag = BASE release 版本）。CI 全绿是唯一通过标志。

## 维护与升级

上游升级（用户只需一句「升级到 vX.Y.Z」）、新需求接收标准、实施流水线、质量法全部在
**`AGENTS.md`**（本仓自治，不依赖外部仓库文件）。OSS↔EE 能力差异与补足决策：
`docs/oss-ee-gap.md`。

## 关联项目

- kestra 侧扩展仓：plugin-apps-amis / plugin-apps-harness / kestra-oidc-provider / plugin-relay-dsh
- harness 侧对应构建仓：harness-overlay
