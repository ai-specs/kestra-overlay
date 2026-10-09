# kestra-overlay Agent 指南

> **本仓自治声明**：本仓的全部规范、记录与检查工具都在本仓内（本文件 + `patches/manifest.tsv`
> + `scripts/check-patches.sh` + `docs/oss-ee-gap.md`），**不依赖任何外部仓库的文件才能运作**。
> 上游（kestra-io/kestra）与扩展仓只是构建时的依赖对象。任何 agent 接手本仓，读本文件即可正确工作。

## 0. 定位（一句话）

kestra-overlay 是 **kestra 侧薄 overlay 构建仓**：CI 时克隆上游 kestra（BASE pin 固定
release commit）→ 按序应用**需求对齐的薄 patch**（补足 OSS 相对 EE 故意阉割的**架构扩展能力**
——见 `docs/oss-ee-gap.md`）→ 注入扩展仓 jar → 编译 webserver → 构建镜像推 ghcr。
**不携带上游代码，不跑上游全量 CI，不承载业务逻辑。**

### 长远目标（北极星，维护者裁定 2026-10-07）

本仓的长期使命是 **OSS→EE 方向的架构能力扩展层**：以上游每个 release 的架构能力为立足点，
系统性补足 kestra OSS 因商业策略被阉割的**架构扩展能力**——让任何下游（扩展仓、部署方）
能以与 EE 同构的方式（classpath jar、激活点、配置开关）扩展 OSS。由此确定演进秩序：

1. **决策源 = 差异表 + 机制原理**（`docs/oss-ee-gap.md` 回答「补什么」、
   `docs/extension-mechanisms.md` 回答「怎么生效」）——不是任何 fork 的现状，
   也不是任何客户的迁移阶段表。
2. **dsh fork（app-kestra）仅是参考证据库**（证据分级 `[dsh]`：某能力曾被实证可行），
   不是路线图。「fork 有/没有」本身不构成收/不收 patch 的理由——理由只能落在差异表行
   + 机制证据上（外部实现不在本仓视野——基本原则）。
3. 客户的阶段规划只影响**优先级**，不影响 patch 的形态、质量标准与本仓的自主演进。

三类内容的归属是硬边界：

| 内容 | 归属 |
|---|---|
| 上游预留扩展点的**激活/注册/占位**（改写上游文件的极小面） | 本仓 patch |
| 业务逻辑实现（控制器、服务、触发器、前端包） | 扩展仓（jar 出仓：plugins/ 槽或外部 classpath jar） |
| 上游自身内容（含未来 release 会包含的东西） | **本仓永不回移**（见 §5 归因法） |

> **归属例外（2026-10-07 裁定）**：**协议标准基础设施层**（当前唯 R-OIDC-SERVER——协议
> 稳定 + 实现标准的大粒度新文件层）走 **patch 路线**，不入扩展仓；判定依据与实施前置
> 见差异表 §4 R-OIDC-SERVER 行、§3-7 质量法条款。

### 基本原则（2026-10-07 维护者裁定）

本仓只对**上游运行架构与扩展机制**负责。交付物 = 足够的扩展点、占位、激活缝隙，
由差异表 S1-S9 + 机制 F1-F4 从上游推导。外部扩展如何实现、何时实现，不在本仓视野：
不跟踪其进度，不以其现状为路线图。扩展点面的验收标准是「机制通道可用」，
不是「某外部仓已消费」。
具体 patch 的收件仍按 §2 入口 B（消费仓 + 行为证据）。两者不冲突：本原则管「留不留位」，
入口 B 管「动不动刀」。

### 当前范围（2026-10-07 收窄裁定，维护者）

北极星使命不变（服务任何下游），但**活跃范围**收缩为两件事：

1. **kestra-oidc-provider**（不含 MCP 面——REQ-0010 与差异表 MCP 域行已删）；
2. **R-EE-RBAC**（`docs/r-ee-rbac.md`，外部细粒度授权能力）。

认证线含一项预留扩展点：**R-OIDC-SERVER**（OAuth2/OIDC 授权服务器，Micronaut 生态
标准实现，patch 路线——2026-10-07 裁定）。裁定理由：协议稳定性 + 实现标准性 ⇒
大粒度仍为薄层（新文件为主，BASE 升级冲突面小）；它区别于 jar 路线的外部扩展实现。
本仓模式 = **overlay 先行**（镜像扩展、classpath 契约、运行扩展点先行约定），
jar 路线跟随。

apps/AI/UI 等其余域的 patch（0010/0020/0021/0022）与 reserved
（R-APP-ROUTER/R-NFH-ANCHOR/R-AI-PROVIDERS/R-UI-EDITION-GATE，含更早收回的 R-MIG-DSH）
已删除，git 历史即归档；重启任一域须按 §2 入口**重新接收**（先补差异表行 + 客户证据），
不引用已删内容作为立项理由（可作 `[dsh]`/历史证据引用）。

### 镜像定位（2026-10-07 裁定，维护者）

**加固形态（上游 no-plugins 谱系）：「精确控制插件集的加固环境」+ 构建期零外部扩展
jar**。铁律与推论（证据与机制全文见 `docs/extension-mechanisms.md` F4 定位段）：

1. 镜像 = vanilla + patch；任何扩展 jar（③ 插件槽 / ② classpath 槽）一律**部署侧
   预置/挂载 + 重启**生效，构建期不烤 jar 字节；classpath 承载的构建期唯一动作 =
   manifest `Class-Path` 条目元数据注入（R-CLASSPATH-MERGE）。
2. 主 tag = `${RELEASE}-no-plugins`；与上游同名变体的唯一实现差异：auto-install 无法
   在镜像内烤关（selfrun 只认 `KESTRA_CONFIGURATION` 环境变量）——**部署基线应显式
   `kestra.plugins.auto-install.enabled: false`**（④ 通道）闭环静态插件集纪律。
3. 违反零 jar 定位的构建期注入（如重新启用 plugin 槽暂存、烤入 libs）须先修订本节
   （入口 D），不得经实施顺带发生。

## 1. 仓库结构与事实源

| 路径 | 是什么 | 约束 |
|---|---|---|
| `patches/BASE` | 两行：release tag + 该 tag 的 40 位 commit sha | 镜像主 tag = release 版本+`-no-plugins`（变体语义注记见机制文档 F4）；升级必更新 |
| `patches/webserver/NNNN-slug.patch` | 需求对齐薄 patch（头部注释 + 统一 diff） | 命名 `^\d{4}-[a-z0-9-]+$`；编号即应用顺序（字典序） |
| `patches/manifest.tsv` | patch 总账（含 reserved 待激活点） | 与 patch 文件一一对应，`check-patches.sh` 强校验 |
| `scripts/build.sh` | 克隆上游→apply→编译 webserver→镜像→push | `--apply-only` = 验证门 |
| `extensions.tsv` | 扩展仓注入注册表（name \| slot \| 说明；slot=plugin/classpath/standalone） | 骨架客户中立：下游是数据不是代码；与机制通道矩阵对应 |
| `scripts/build-extensions.sh` | 按 extensions.tsv 收集注入（env > extensions/ > 跳过；classpath 槽未落地报 PENDING） | 本仓不 vendored 任何 jar 二进制 |
| `scripts/check-patches.sh` | 本仓质量门（结构校验 + 可选 apply-check） | 改 patches 后必须本地跑；CI patch-verify 第一步 |
| `docs/oss-ee-gap.md` | OSS↔EE 能力差异表 + reserved 登记簿 | 补足决策的唯一依据；BASE 升级后必须复扫 |
| `docs/extension-mechanisms.md` | 扩展机制原理（编译/重启/外部 jar 三问的调查记录） | 「怎么生效」的事实源；含 OQ 开放问题清单（实施前必须闭环） |
| `.github/workflows/overlay.yml` | CI：结构检查 → apply 门 → 编译+镜像 | CI 全绿是唯一通过标志 |

## 2. 需求接收（什么时候收需求、收到什么程度才算合格）

需求入口只有四类，接收标准与拒绝清单如下。**不满足接收标准的需求一律退回补证，不得开工。**

| 入口 | 触发 | 接收标准（缺一不可） |
|---|---|---|
| A. 上游升级 | 用户指令「升级到 vX.Y.Z」 | 只需版本号；其余按 §6 升级 SOP 执行 |
| B. 扩展点补足 | 某扩展仓需要一个上游文件的激活/注册/占位 | ① 指名**消费扩展仓**；② 行为证据（缺了它哪个端点/页面/流程不工作）；③ 最小面声明（只动激活点，不含业务逻辑）；④ 对照 `docs/oss-ee-gap.md` 有归属行（新增行需先补表） |
| C. 缺陷修复 | 已有 patch 在某 BASE 上失效/行为错误 | 失效证据（命令+输出）；修复不得扩大 patch 面（收窄优先） |
| D. 治理 | 本仓骨架/规范/脚本的调整 | 说明影响的规范条款；改检查脚本必须自检通过 |

**拒绝清单**（历史已验证的歧路，直接拒）：
- ❌ 无消费扩展仓的「顺手优化/对齐上游」——patch 面只增不减的根源；
- ❌ 把上游 develop/未来 release 的内容回移到 BASE（「fork 有而 BASE 没有」≠ 定制，见 §5）；
- ❌ patch 携带业务逻辑（应出仓为扩展仓 jar）；A 类新增文件进 patch 仅限「M 面激活点的编译锚」（manifest 标 `transition` + 移除条件）。**例外（2026-10-07）**：协议标准基础设施层（R-OIDC-SERVER 类）走 patch 路线——条件见 §3-7；
- ❌ build 面 patch：settings.gradle **模块 include**、docker-entrypoint 等——CI 实证必挂（`Configuring project ':x' without an existing directory`）。**唯一例外（2026-10-07 R-OIDC-SERVER 裁定）**：`webserver/build.gradle` 增**依赖行**允许（nimbus oauth2-oidc-sdk / jbcrypt / micronaut-security 系，fork 归因实证清单）；模块 include 永远禁止；
- ❌ ui 面 patch：一般 UI 定制不接收；**2026-10-09 维护者例外**：R-OIDC-SERVER 的完整认证替换允许最小 UI patch（路由守卫、401 跳转、退出、登录外观）。OIDC 模式完全关闭 Basic Auth 链，不伪造 Basic Auth cookie/登录标志，不复用其凭据端点。镜像必须构建 UI 并保留上游其他功能；详细契约与验收见 docs/r-oidc-server.md §0；
- ❌ migration 面 patch：**扩展仓需求**的 migration 归扩展仓（`MigrationRunner` 注入 `Collection<MigrationScript>` 收集上下文全部 bean，classpath jar 的也收（`core/migration/MigrationRunner.java:47-56`）——扩展仓 jar 自带 bean+SQL 即生效；SQL-only patch 缺 bean 注册，从未生效，§8-2）。**例外（2026-10-07）**：**overlay 自有 schema**（R-OIDC-SERVER 的用户/client/JWKS 表）的 migration 进 patch——源码级 MigrationScript bean + SQL 成对（F2 机制自动执行，前置裁定③）；
- ❌ 复刻 EE 产品功能（审计日志、Kafka 队列等）——本仓只补**架构扩展能力**（见差异表 §0 定位）。

## 3. patch 质量法

1. **需求对齐粒度**：一个 patch = 一个需求（可跨文件）；同一文件被多个需求触达时拆多个
   patch（hunk 不得重叠，`check-patches.sh` 强制）。**禁止**按文件粒度合并多个需求——
   不同时期/层面的需求混在一个 patch 里是后续实施 agent 幻觉的主要来源（维护者裁定 2026-10-07）。
2. **头部注释必填**（patch 文件首部、`diff --git` 之前的 `#` 行，git apply 容忍）：
   `需求`（为什么存在+行为）、`消费扩展仓`、`状态`、`来源`（fork 定制移植〔verbatim/手工适配〕
   或新写〔依据〕）、`触达上游文件`、`移除条件`。缺字段 = check-patches.sh FAIL。
3. **状态语义**：`core`（长期面：上游不会提供，如 EE 门控解除）；`transition`（过渡：
   随扩展仓出仓收窄，必须写明收窄后剩什么）；`reserved` 只出现在 manifest（待激活点，
   对应 `docs/oss-ee-gap.md` §4，无 patch 文件）。
4. **manifest 同步**：增/删/改 patch 必须同步 `patches/manifest.tsv`；两处不一致 = FAIL。
5. patch 只含统一 diff 与头部注释；禁止冲突标记、尾随垃圾、二进制。
6. **形态绑定**（2026-10-07 增补）：manifest、patch 头部、差异表 §4 的一切移除条件/触发
   条件必须绑定**可观察的形态事件**（如「R-CLASSPATH-MERGE 落地」「上游向 OSS 开放 X」），
   禁止只写客户阶段号——客户阶段只影响优先级（§0-3），不是形态依据。零 overlay 动作即可
   补足的缝隙不入 reserved（登记收回规则见差异表 §4）。
7. **协议标准基础设施层**（2026-10-07 增补，R-OIDC-SERVER 裁定）：协议稳定 + 实现标准的
   大粒度新文件 patch 允许进 patch 集，条件缺一不可：① 按需求对齐拆分（一 patch 一需求，
   含 build.gradle 依赖行随首个需求 patch 走）；② **与验收测试同批落仓**（`src/test`，
   CI 定向门，见 §4）；③ 头部「来源」标注协议标准依据（RFC/SDK 及版本）；④ 剥离客户
   耦合项并在头部声明「手工适配 + 剥离了什么」（fork 移植走 §5.2 归因）。

## 4. 验证分层（本地快检 vs CI）

- **本地（秒级，每次改动必跑）**：`./scripts/check-patches.sh`（结构 + manifest + 重叠检测）；
  有上游树时 `./scripts/check-patches.sh --apply-check <dir>`（顺序应用验证）。
- **CI（push 触发，唯一通过标志）**：patch-verify（结构检查 + 上游克隆 + 全量 apply）→
  build-push（webserver 编译 + 镜像 + ghcr）。本地不跑 gradle 全量编译。
- **测试同批（安全敏感铁律，2026-10-07 裁定）**：R-OIDC-SERVER 类 patch 的验收测试与
  实现同批落仓；CI 定向测试门（`:webserver:test --tests` 包前缀过滤，只跑 patch 引入的
  测试，不跑上游全量）+ 镜像级 OIDC 流程黑盒；安全专项清单（差异表 §4 R-OIDC-SERVER
  前置④）动刀前评审定稿，门绿为 DoD 组成部分。
- **本地全链验证循环（2026-10-07 裁定，本条对 R-OIDC-SERVER 类实施期例外于「本地不跑
  gradle 全量编译」）**：动刀期用 `scripts/local-ci.sh` 在本地模拟完整 CI——验证树
  `.work/verify` 每次 reset 到 BASE 后按序重放全部 patch → 定向测试（Testcontainers，
  需 Docker）→ executableJar；开发在 `.work/dev` 树按 §5.3 进行（两树分离，脚本绝不触碰
  dev 树；`.work/` 不入库）。**本地全绿后才组织 patch 提交推送**；真 CI 仍为唯一通过标志。
- CI 平时不跟踪不轮询；**骨架/patch 集大改后查一次**（属「大量变更后跟踪一次」例外）。
- **禁止**在 CI 红时宣称完成；禁止用 `... | tail` 吞退出码。

## 5. 实施 SOP（固定流水线——防止不同 agent 各发明的「方法」）

### 5.1 前置
```bash
proxy_on                      # 网络故障时（zsh 函数，宿主提供）；克隆成功则无需
git clone --depth 1 --branch <BASE行1> https://github.com/kestra-io/kestra.git /tmp/kestra-upstream
# blob:none 部分克隆的 lazy checkout 会中途断流（已踩），用完整浅克隆
```

### 5.2 需求归因（**fork 定制面的唯一正确求法**——2026-10-07 审计教训固化）
当需求的来源是 dsh fork（app-kestra）已有行为时，**禁止**拿「fork 文件 ↔ BASE 文件」的
全量差异当定制面——fork 基于 develop，全量差异里混着上游自研演进（本轮审计实证：4 个文件
纯上游回移被误当定制、3 个文件大半是回移，占原 patch 集 2/3 体量）。正确求法：
```bash
# 在 fork 仓：fork 相对其上游 merge-base 的定制 diff = 唯一定制事实源
MB=$(git merge-base HEAD upstream/develop)
git diff $MB HEAD -- <file>          # 这才是 dsh 定制
git diff $MB HEAD --numstat -- <目录> # 逐文件定制量（ZERO = 上游内容，禁回移）
```
对照法：新文件 `git cat-file -e upstream/develop:<path>` 判断「fork 新增 or 上游已有」。

**跨基移植规则（2026-10-07 增补）**：fork 的编写基是 develop 分叉点，与 BASE（release）
**分叉**（v2.0.5 与 merge-base f6dbbb49 互不为祖先，基间 278 文件 ±1.2 万行）。定制 diff
即使归因正确也**不可直接作为 BASE 的 patch**——只作规格参考（端点/职责/表结构/测试语义）。
移植 = 在 BASE 树按 §5.3 重写：动刀前产出 **API 漂移清单**（fork 依赖的上游类逐个三方
核对 v2.0.5），patch 头部标「参考 fork 实现逻辑重写（跨基）」，移植后**逐文件**漂移核对。

### 5.3 patch 生成（增量提交法，禁止手写 hunk）
```bash
cd /tmp/kestra-upstream && git checkout -q -b overlay-work
# 逐需求实施：每完成一个需求的所有文件改动（同文件多需求 = 先做需求 A 的部分）：
git add <需求A的文件> && git commit -m "REQ <id>"
# 同文件被后续需求触达：恢复/继续编辑出「A 之后 B」的中间态再提交
{ cat <头部注释>; git diff HEAD~1 HEAD; } > patches/webserver/NNNN-slug.patch
# 校验：全新 BASE 树按序应用 5..N 个 patch == 最终提交树（check-patches.sh --apply-check）
```
手工适配（fork 上下文含上游 develop 演进时）必须在头部 `来源` 标注「手工适配 + 剥离了什么」。

### 5.4 完成定义（DoD）
manifest 已同步 → `check-patches.sh` 全 PASS → `--apply-check` 树级一致 → commit（格式
`feat(req-XXXX)|fix|chore(scope): 摘要`）→ push → CI 全绿。四者缺一不得宣称完成。

## 6. 上游升级 SOP（用户只说「升级到 vX.Y.Z」，其余全按本节执行）

1. `git clone --depth 1 --branch vX.Y.Z …` 取新树；确认 tag 指向 commit sha。
2. 逐 patch 三分支判定（按编号顺序在新树上 `git apply --check`）：
   - **clean-apply** → 保留；再编译级复核（CI）；
   - **上游已吸收/文件消失** → 删除 patch，manifest 记 `absorbed@vX.Y.Z`，commit 说明证据；
   - **冲突** → 按该 patch 头部 `来源` 字段重推导（fork 定制回到 §5.2 求法），**收窄优先**，
     禁止趁机扩面。
3. 复扫 `docs/oss-ee-gap.md`：重跑 §5 复现命令更新 §1/§2；逐行复审 §3 与 **逐条检查
   §4 reserved 触发条件**（如 R-CLASSPATH-MERGE 实施状态、R-EE-RBAC 前置是否变化）。
4. 更新 `patches/BASE` 两行（tag + sha）。
5. 本地 `check-patches.sh --apply-check`（新树）→ commit → push → **CI 必须全绿**（升级属
   「大改后跟踪一次」例外，允许用 `gh run list -R ai-specs/kestra-overlay` 确认）。
6. 镜像主 tag 自动 = 新 release（build.sh 规则），扩展仓按新镜像版本跟进（不在本仓职责内）。

## 7. 证据纪律（承袭 dsh 项目治理，本仓内自治）

- 结论附**可复现命令**；统计数字写明口径；`[src]/[docs]/[dsh]` 证据分级（见差异表）。
- **时间戳/时间差不定罪**：patch/jar 是否过期只看内容级比对（git apply --check / 编译）。
- 引用前序结论注明「本轮未复测」。
- fork 行为移植后必须做**漂移核对**：`diff <新树文件> <fork文件>`，差异必须全部可归因于
  「上游 develop↔BASE 上下文」或「已声明的剥离项」，否则视为移植丢失。

## 8. 本仓已验证陷阱（踩过即记录，新 agent 免重踩）

| # | 陷阱 | 证据/轮次 |
|---|---|---|
| 1 | build 面 patch 必挂 CI：settings.gradle `include` 本仓不注入的模块目录 → `Configuring project ':relay' without an existing directory`（gradle configure 期失败） | 2026-10-07 CI 实证，build 组已整组删除。**修订（同日）**：R-OIDC-SERVER 例外允许 webserver/build.gradle 依赖行；**模块 include 仍禁** |
| 2 | migration SQL-only patch 从未生效：MigrationScript 是 DI bean，SQL 单独进 patch 漏注册 | fork 实证；2026-10-07 机制结论（升级）：MigrationRunner 收全量 bean（含 classpath jar），扩展仓 jar 自带 bean+SQL 即生效——**扩展仓需求**的 migration 面零 overlay patch（机制结论见 docs/extension-mechanisms.md F2）。**修订（同日）**：overlay 自有 schema（R-OIDC-SERVER 前置裁定③）例外——bean+SQL 成对进 patch |
| 3 | 管道 `… | tail` 吞退出码（tail 恒 0） | 用规范脚本，失败必须中断 |
| 4 | `git apply` 容忍 patch 首部 `#` 注释行 → 头部注释由此合法（但 diff 之后不允许散文） | 本轮树级验证 |
| 5 | `--filter=blob:none` 克隆的 lazy checkout 中途断流（HTTP/2 reset） | 用完整浅克隆 + `proxy_on` |
| 6 | **fork↔release 全量 diff ≠ 定制面**（上游回移误判案：BasicAuthService/RequestUtils/CookiesConfiguration/NotFoundHeadersFilter 纯回移 + ErrorController/MiscController/UiIndexService 大半回移，占原 patch 集 2/3） | 2026-10-07 审计，§5.2 已固化求法 |
| 7 | TenantAliasingRooter 不得用路由级负向前瞻 regex（Micronaut UriTemplateMatcher 直接抛异常起不来） | fork 实证（原注记随 REQ-0020 删除，教训保留） |
| 8 | 需求对齐 patch 可能有**先后坐标依赖**（历史实例：0021 的 filter hunk 基于 0020 应用后的状态，该对 patch 已随范围收窄删除）：apply 必须**逐 patch「check→apply」交替**，不能先对干净树全量 --check 再统一 apply（旧独立 patch 集的习惯，2026-10-07 CI 实证挂法） | build.sh 修复提交 + check-patches.sh [8] 一贯正确 |
| 9 | **跨基移植陷阱**：fork 定制 diff（对 develop）不能直接当 BASE（release）的 patch——即使归因正确，编写基不同（v2.0.5 与 merge-base 互不为祖先，已实证分叉 ±1.2 万行）。必须逻辑级移植：API 漂移清单 + BASE 树重写 + 逐文件漂移核对（§5.2 跨基移植规则） | 2026-10-07 维护者指正 + fork 仓 merge-base --is-ancestor 实证 |

## 9. 变更纪律

- main 直推（本仓无 PR 流程）；commit message 指明需求号或范围。
- 每 patch 的增/删/改在 commit message 记录理由；被删 patch 的理由入 manifest 或 commit（git 历史即归档，不留 .bak）。
- 本文件与 `docs/oss-ee-gap.md`、`patches/manifest.tsv` 与实际 patch 集**四者一致**，由
  `check-patches.sh` 部分强制、评审补足。
