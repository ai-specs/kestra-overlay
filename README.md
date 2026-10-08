# kestra-overlay

kestra 侧**薄 overlay 构建仓**。CI 流程：

```
克隆上游 kestra-io/kestra（BASE pin，patches/BASE）
  → 按序应用 patches/webserver/ 薄 patch
  → 编译 webserver executable jar
  → 构建镜像，推 ghcr.io/ai-specs
```

本仓不携带上游代码、不跑上游全量 CI、不承载业务逻辑。
业务逻辑归扩展仓；上游预留扩展点的激活/注册/占位归本仓 patch（硬边界见 `AGENTS.md` §0）。

## 定位

- **使命（北极星）**：OSS→EE 方向的架构能力扩展层。差异表定「补什么」
  （`docs/oss-ee-gap.md`），机制原理定「怎么生效」（`docs/extension-mechanisms.md`）。
- **基本原则**：只对上游架构与扩展机制负责——交付足够的扩展点/占位；外部如何实现
  不在本仓视野（`AGENTS.md` §0·基本原则）。
- **当前范围**（2026-10-07 收窄裁定）：两条能力线——**认证线**（OIDC 部署形态，
  MCP 面除外）与**授权线**（R-EE-RBAC，`docs/r-ee-rbac.md`）。裁定与重启规则见
  `AGENTS.md` §0。
- **镜像定位**（2026-10-07 裁定）：加固形态（no-plugins 谱系）。构建期零外部扩展 jar；
  扩展 jar 一律部署侧挂载 + 重启；classpath 承载仅注入 manifest 条目元数据。
  主 tag = release + `-no-plugins`。auto-install 无法镜像内烤关，部署基线应显式关闭
  （机制文档 F4 定位段）。

## 快速命令

| 命令 | 用途 |
|---|---|
| `./scripts/check-patches.sh` | 质量门（结构校验，秒级；改 patch 后必跑） |
| `./scripts/check-patches.sh --apply-check <上游BASE树>` | 追加顺序应用验证 |
| `./scripts/build.sh --apply-only` | 克隆上游 + apply 全部 patch（apply 门） |
| `./scripts/build.sh` | 全量：apply → 编译 → 镜像 → push ghcr |
| `./scripts/build-extensions.sh <WORK>` | 扩展仓注入报告（注册表 `extensions.tsv`；classpath 槽报 PENDING） |

## patch 集

1 个 patch：**0011-oidc-login-boot**（/configs OIDC 登录引导激活点；core；消费仓
kestra-oidc-provider）。

3 条 reserved：**R-CLASSPATH-MERGE**（通道② jar 承载，链与 RBAC 的共同前置，
选型 b 已裁定）、**R-EE-RBAC**（外部细粒度授权，jar 路线，预期零 patch）与
**R-OIDC-SERVER**（OAuth2/OIDC 授权服务器，**patch 路线**预留扩展点——协议稳定 +
实现标准 ⇒ 大粒度薄层，2026-10-07 裁定）。
总账见 `patches/manifest.tsv`（check-patches.sh 强校验一致性）。

## CI（overlay-build）

`patch-verify`（结构门 → 上游克隆 → apply 门）→ `build-push`（编译 + 镜像 + ghcr）。
CI 全绿是唯一通过标志。

## 维护与升级

升级（用户只需「升级到 vX.Y.Z」）、需求接收标准、实施流水线、质量法全部在
**`AGENTS.md`**（本仓自治，不依赖外部仓库文件）。
