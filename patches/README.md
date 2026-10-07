# patches

`BASE` 记录 overlay 所基于的**上游 release**（两行：第一行 release tag，第二行该 release
的 commit sha）。CI checkout 该 commit 构建，保证可复现；镜像主 tag = release 版本+
`-no-plugins`（变体语义注记见 `docs/extension-mechanisms.md` F4）。
升级流程（用户指令「升级到 vX.Y.Z」→ 逐 patch 三分支判定 → 复扫 oss-ee-gap → 更新
BASE → CI 全绿）见 `AGENTS.md` §6。

## 为什么是薄 patch 而不是零 patch（机制事实）

上游交付形态决定（`docs/extension-mechanisms.md` F1，dsh fork 旁证 `[dsh]`）：官方镜像 =
selfrun executable jar（`exec java -jar`）+ 运行时 base（temurin JRE25，不编译源码），
**webserver 二进制是宿主 `gradlew executableJar` 编译并拷入镜像的**。webserver M 文件
定制只能存在于重新编译的 webserver jar——官方预编译 base 无法承载 → 必须改源码。
但 patch 面**必须最小**：每一行 patch 都是下一次上游升级的成本（升级全流程由 AI 执行，
AGENTS.md §6 的固定 SOP 就是为此设计）。

## patch 粒度与形态（AGENTS.md §3 的摘要）

- **一个 patch = 一个需求**（可跨文件）；同一文件被多个需求触达时拆多个 patch，
  改动行不得冲突（check-patches.sh 坐标归一化后强制检测）。
- **头部注释**（diff 之前的 `#` 行，git apply 容忍）必填：需求 / 消费扩展仓 / 状态 /
  来源 / 触达上游文件 / 移除条件。
- **状态**：`core`（上游不会提供的长期面）；`transition`（随扩展仓出仓收窄，须写明
  收窄后剩什么；移除条件**形态绑定**，AGENTS.md §3-6）；`reserved`（仅 manifest，待激活点，
  对应 docs/oss-ee-gap.md §4）。
- **总账** `manifest.tsv` 与 patch 文件一一对应，check-patches.sh 强校验。
- 目录白名单：仅 `webserver/` 组（build 面 CI 必挂已实证 / ui 面不编译 / migration 面
  归扩展仓 classpath jar——MigrationRunner 收全量 bean，机制证据见 AGENTS.md §2 与
  §8-2）。

## 归因纪律（2026-10-07 审计教训）

**「fork 有而 BASE 没有」≠ dsh 定制**。fork 基于上游 develop，fork↔release 全量差异里
混着上游自研演进；本轮审计实测原 patch 集 2/3 是上游内容回移（下一版 release 会自然
包含，白背升级成本）。求定制面的唯一正确方法（fork merge-base diff）见 AGENTS.md §5.2。
