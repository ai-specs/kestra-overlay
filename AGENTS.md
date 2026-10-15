# kestra-overlay Agent 指南

> **本仓自治声明**：本仓的全部规范、记录与检查工具都在本仓内（本文件 + `patches/manifest.tsv`
> + `scripts/check-patches.sh` + `docs/oss-ee-gap.md`），**不依赖任何外部仓库的文件才能运作**。
> 上游（kestra-io/kestra）是源码输入。独立扩展项目是公开契约的使用方，不是构建输入。

本文件用于本仓的需求接收、宿主机制设计、补丁维护、独立构建和镜像发布。
本仓必须独立验证公开契约。真实业务扩展的部署组合和用户验收由部署仓负责。

## 0. 项目职责与边界

kestra-overlay 提供宿主扩展机制和增强镜像。构建时必须按 `patches/BASE` 固定的提交取得
上游源码，按顺序应用补丁（patch），编译宿主程序，并构建和发布 overlay 镜像。
扩展能力的归属见 `docs/oss-ee-gap.md`。本仓不得提交上游源码，不运行上游全量 CI，
不承载独立扩展的业务逻辑。

### 长期目标与架构依据

本仓的长期使命是 **OSS→EE 方向的架构能力扩展层**：以上游每个 release 的架构能力为立足点，
补足 Kestra OSS 缺少的**架构扩展能力**，使下游扩展仓和部署方
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
> 见差异表第 4 节 R-OIDC-SERVER 行和本文件第 3 节第 7 项。

### 基本原则（2026-10-07 维护者裁定）

本仓只对**上游运行架构与扩展机制**负责。交付物 = 足够的扩展点、占位、激活缝隙，
由差异表 S1-S9 和机制 F1-F4 从上游推导。本仓不承担外部项目的进度管理，也不以外部
项目的现状直接决定路线图。主控可以从消费项目迭代和真实
验收中反向识别公开机制缺口，并按 §2 入口 B 提案；业务实现缺口仍归消费项目。
扩展点面的验收标准是「机制通道可用」，
不是「某外部仓已消费」。
具体 patch 必须满足第 2 节入口 B 的接收条件：指明消费项目，并提供失败行为证据。

### 第三方扩展与类型化契约规则

- 本仓负责宿主公共界面和必要的 UI 扩展机制。登录、退出和通用拒绝页面必须保持一致的
  视觉风格。业务扩展管理页面留在独立扩展仓，不得为统一外观而移入宿主。
  风格统一必须按页面用途取舍元素，不得无条件照搬登录页。`/ui/access-denied` 应突出
  拒绝原因和退出换号入口；不要求复制 Kestra 的 K 字母标志等品牌或装饰元素。
  非上游定制页面必须检查与宿主主题的兼容性，包含独立渲染的 `/oidc/login` 和宿主内的
  `/ui/access-denied`。必须覆盖 light、dark、dark-2、跟随系统、窄屏、错误提示和键盘焦点；
  独立认证页面不得依赖业务配置或权限加载来取得主题。
  消费项目需要共享组件、样式、菜单或页面装载机制时，必须先调查已发布接口；机制不足
  时按入口 B 接收最小公开契约提案。不得要求扩展构建读取相邻宿主 UI 源码或未发布资源。
- 稳定公开契约优先。overlay 适配上游细节，扩展仓消费已发布 SPI、类型和配置；业务模型
  与业务 bean 必须留在扩展仓。
- 插件不得解析或复制 `Controller`、`Handler`、URL 路由或 chart YAML。上游内部类、内部
  URL 和部署模板不是公开契约。
- 类型化契约与宿主适配分别由 0250/0260 提供。独立构建边界和发布顺序统一见第 10 节。
  源码存在、测试通过或候选镜像不能替代正式发布证据。
- 未解析路径、身份、组件、资源计划或契约不匹配必须失败关闭。异常拒绝后必须检查没有
  不应有的数据库、存储或队列副作用；错误状态码不能单独证明安全行为。
- 上游升级先由 overlay 重新核对契约并适配细节，再发布新 digest；扩展仓随后重新编译
  和验收。错误路径回退只能保持失败关闭，不得绕过稳定契约、放宽授权或使用未发布接口。

### 授权激活点与上下文规则

- 资源分类必须追踪端点实际读取的数据和子操作。管理控制器中的关联列表必须按关联资源
  授权。入口授权或共享元数据授权不能替代关联资源授权。查看服务配置、使用连接信息和
  修改配置必须分别授权。
- 用户请求不得复用绕过访问控制的全实例采集入口来生成统计。必须检查实际数据查询方法
  是否应用租户和资源授权范围，并在统计、分页和聚合前过滤。后台采集规则不得自动用于 HTTP 请求。
- 认证 UI 必须在首次业务请求前规范资源路径。授权拒绝页面及退出入口必须能在业务配置
  加载失败时工作；退出必须使用宿主会话撤销与 cookie 清除机制，不能仅跳转登录页面。
- 展开子流程、执行图或依赖图时，必须检查实际目标的所属命名空间。涉及两个资源时，
  必须约束两端的资源范围。
  调查必须追踪 `WithoutAcl` 等绕过查询路径，不能只检查控制器入口。
- 仪表盘必须按实际执行的数据源查询生成授权操作。KPI 的分子和分母必须分别
  检查。用户过滤条件只能与授权范围求交，不能覆盖授权范围。未知数据源必须拒绝。
- HTTP 请求缺少身份或授权上下文时必须失败关闭，不得推断为宿主内部调用。可信内部入口
  必须显式标记，并与 HTTP 来源区分；裸线程、线程池和队列订阅路径必须有独立探针。
- 异步任务只传播必要的授权来源和身份。不得整体复制含 JDBC 连接、事务等对象的执行
  上下文到长生命周期任务。相关改动必须验证任务执行、连接复用及服务关闭行为。
- URI 安全检查必须先解析 URI，再分别验证 scheme、authority 和 path。不得在完整 URI
  字符串中搜索 `//` 来判定路径越界；合法 `kestra:///...` 与路径穿越必须分别测试。

### 主控 AI 与并行 agent 规则

主控 AI 必须先检查各仓 Git 状态、README、AGENTS.md、公开契约和已有交付物，再划分任务。
并行 agent 只能承担互不重叠的目录职责；任务提示必须写明修改目录、禁止目录、输入证据、
公开契约、检查命令和交付格式。agent 不得递归启动 agent，不得提交、推送或发布，除非主控
明确授权。共享文件、共享验证树和跨仓组合验收由主控指定唯一负责人。

主控必须检查 agent 的实际 diff、运行命令和测试输出。agent 的计划、推断或口头报告不能
替代构建、CI、产物 hash、镜像 digest 或 Compose 验收证据。主控负责裁决跨仓边界、公开
契约、失败关闭、上游升级和最终交付；任何未通过的必需检查都不得宣称完成。

### 当前范围

北极星使命不变（服务任何下游），但**活跃范围**收缩为两件事：

1. **kestra-oidc-provider**（含后续重新接收的 MCP OAuth2 认证/能力契约面；旧 MCP patch 已删，不作为新需求依据）；
2. **R-EE-RBAC**（`docs/r-ee-rbac.md`，外部细粒度授权能力）。

认证线包含 **R-OIDC-SERVER**（OAuth2/OIDC 授权服务器）。该能力属于宿主协议基础设施，
按本文件规定使用 patch 实现；接收条件见第 3 节。
本仓模式 = **overlay 先行**（镜像扩展、classpath 契约、运行扩展点先行约定），
jar 路线跟随。

apps/AI/UI 等其余域的 patch（0010/0020/0021/0022）与 reserved
（R-APP-ROUTER/R-NFH-ANCHOR/R-AI-PROVIDERS/R-UI-EDITION-GATE，含更早收回的 R-MIG-DSH）
已删除，git 历史即归档；重启任一域须按 §2 入口**重新接收**（先补差异表行 + 客户证据），
不引用已删内容作为立项理由（可作 `[dsh]`/历史证据引用）。

### 镜像定位（2026-10-07 裁定，维护者）

**后续范围修订（维护者多轮澄清）**：重新接收 MCP **认证面**，目标 OAuth2-only，
删除 MCP Basic Auth 实现/选项/商业占位；其余 MCP 业务面不自动扩展。动态 MCP
client 归属用户，采用短期 pending→登录确认绑定 owner 的第二种方案，无管理员
特例或共享动态 client。0150–0190 已交付并通过真实 CI；0200/0211 补齐生产审计加固。详细流程/边界/接收与验收门见
docs/mcp-oauth-integration.md。早期“MCP 面除外”仅为历史范围，不得否定本裁定。
本仓 MCP scope 独立声明资源大类 read/write/delete（write 不含 delete），用户
授权只能收窄；不依赖外部 RBAC 模型。R-EE-RBAC 启用时必须拦截全部现有 MCP
实际执行/子操作路径，与 REST 同主体/资源/动作语义；两层都允许才执行，异常失败
关闭，未覆盖不能宣称交付。详见 docs/r-ee-rbac.md §3/§6/§8。

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
| `extensions.tsv` | 扩展部署契约注册表（name \| slot \| 说明；slot=plugin/classpath/standalone） | 骨架客户中立：下游是数据不是代码；与机制通道矩阵对应 |
| `scripts/build-extensions.sh` | 只读取本仓 extensions.tsv，声明运行时挂载契约；不读取扩展源码或 jar | 构建目录发现外部 jar 时拒绝构建 |
| `scripts/check-patches.sh` | 本仓质量门（结构校验 + 可选 apply-check） | 改 patches 后必须本地跑；CI patch-verify 第一步 |
| `docs/oss-ee-gap.md` | OSS↔EE 能力差异表 + reserved 登记簿 | 补足决策的唯一依据；BASE 升级后必须复扫 |
| `docs/extension-mechanisms.md` | 扩展机制原理（编译/重启/外部 jar 三问的调查记录） | 「怎么生效」的事实源；含 OQ 开放问题清单（实施前必须闭环） |
| `.github/workflows/overlay.yml` | CI：结构检查 → apply 门 → 编译+镜像 | CI 全绿是唯一通过标志 |

## 2. 需求接收条件

需求入口只有四类，接收标准与拒绝清单如下。**不满足接收标准的需求一律退回补证，不得开工。**

| 入口 | 触发 | 接收标准（缺一不可） |
|---|---|---|
| A. 上游升级 | 用户指令「升级到 vX.Y.Z」 | 只需版本号；其余按 §6 升级 SOP 执行 |
| B. 扩展点补足 | 某扩展仓需要一个上游文件的激活/注册/占位 | ① 指名**消费扩展仓**；② 行为证据（缺了它哪个端点/页面/流程不工作）；③ 最小面声明（只动激活点，不含业务逻辑）；④ 对照 `docs/oss-ee-gap.md` 有归属行（新增行需先补表） |
| C. 缺陷修复 | 已有 patch 在某 BASE 上失效/行为错误 | 失效证据（命令+输出）；修复不得扩大 patch 面（收窄优先） |
| D. 治理 | 本仓骨架/规范/脚本的调整 | 说明影响的规范条款；改检查脚本必须自检通过 |

### 2.1 消费项目反馈与扩展点提案

`kestra-plugin-rbac` 及其他独立扩展的迭代可以提供入口 B 的需求证据。主控必须先核对
OSS 已有机制和已发布契约，区分宿主机制缺失、扩展业务实现缺失与部署错误。调查消费仓
源码可以帮助归因，但不得形成构建依赖，也不得将消费仓内部实现作为公开契约。

扩展点提案保存在本仓 `docs/` 的所属能力文档中，必须自包含：消费项目及失败行为、
可复现证据、现有机制不足、最小契约与激活点、双方职责、兼容与升级影响、安全失败语义、
本仓独立探针及部署仓组合验收条件。不得要求读取相邻仓文件才能理解或验证宿主提案。
同一能力优先更新已有文档；候选、已接收、已发布和已验证状态必须有明确区分和证据。

主控按正确性、合理性、简洁性、上游耦合和升级成本裁决，并同步差异表与机制文档。
实现仍须满足入口 B 和第 3 节的 patch 质量要求。宿主可以因反馈演进契约，消费项目可以据此调整
实现；业务策略必须留在独立扩展仓。不得以双向迭代为由扩大业务归属或绕过发布门。

提案接收后按第 10 节交付。组合验收发现新缺口时重新归因和裁决，不自动扩大修改范围。

**拒绝清单**（历史已验证的歧路，直接拒）：
- ❌ 无消费扩展仓的「顺手优化/对齐上游」——patch 面只增不减的根源；
- ❌ 把上游 develop/未来 release 的内容回移到 BASE（「fork 有而 BASE 没有」≠ 定制，见 §5）；
- ❌ patch 携带业务逻辑（应出仓为扩展仓 jar）；A 类新增文件进 patch 仅限「M 面激活点的编译锚」（manifest 标 `transition` + 移除条件）。**例外（2026-10-07）**：协议标准基础设施层（R-OIDC-SERVER 类）走 patch 路线——条件见 §3-7；
- ❌ build 面 patch：settings.gradle **模块 include**、docker-entrypoint 等——CI 实证必挂（`Configuring project ':x' without an existing directory`）。**唯一例外（2026-10-07 R-OIDC-SERVER 裁定）**：`webserver/build.gradle` 增**依赖行**允许（nimbus oauth2-oidc-sdk / jbcrypt / micronaut-security 系，fork 归因实证清单）；模块 include 永远禁止；
- ❌ ui 面 patch：一般 UI 定制不接收；**2026-10-09 维护者例外**：R-OIDC-SERVER 的完整认证替换允许最小 UI patch（路由守卫、401 跳转、退出、登录外观）。OIDC 模式完全关闭 Basic Auth 链，不伪造 Basic Auth cookie/登录标志，不复用其凭据端点。镜像必须构建 UI 并保留上游其他功能；详细契约与验收见 docs/r-oidc-server.md §0；
- ❌ migration 面 patch：**扩展仓需求**的 migration 归扩展仓（`MigrationRunner` 注入 `Collection<MigrationScript>` 收集上下文全部 bean，classpath jar 的也收（`core/migration/MigrationRunner.java:47-56`）——扩展仓 jar 自带 bean+SQL 即生效；SQL-only patch 缺 bean 注册，从未生效，§8-2）。**例外（2026-10-07）**：**overlay 自有 schema**（R-OIDC-SERVER 的用户/client/JWKS 表）的 migration 进 patch——源码级 MigrationScript bean + SQL 成对（F2 机制自动执行，前置裁定③）；
- ❌ 复刻 EE 产品功能（审计日志、Kafka 队列等）——本仓只补**架构扩展能力**（见差异表 §0 定位）。

## 3. patch 质量要求

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

## 4. 本地验证与 CI

- **REQ-0134（2026-10-09 维护者接收）**：RFC7591 动态 public client 注册属于
  R-OIDC-SERVER 标准协议面，可由 MCP 客户端消费；不新增 MCP 专属业务端点。
  无 secret + S256，开关默认关闭，回调/元数据/注册总量限制与验收同批。

- **REQ-0133（2026-10-09）**：OIDC 首次安装引导与环境变量初始化属于 R-OIDC-SERVER
  协议基础设施 patch 路线；用户/凭据/UI client/完成标记原子持久化，测试同批。
  完成后关闭匿名引导，重启不得覆盖密码；环境变量契约见 docs/r-oidc-server.md §0。
  安装身份须由数据库与独立持久化凭据共同锁存；标记删除/损坏时失败关闭，不重新激活。

- **本地（秒级，每次改动必跑）**：`./scripts/check-patches.sh`（结构 + manifest + 重叠检测）；
  有上游树时 `./scripts/check-patches.sh --apply-check <dir>`（顺序应用验证）。
- 修改 patch 后必须用 `git apply --numstat <patch>` 验证 diff 可解析，并在干净 BASE 树
  按序执行完整 apply 检查。结构检查不能替代 hunk 长度校验或实际应用；生成仍按 §5.3，
  不得手写 hunk 坐标。复用验证树前必须检查未提交改动并保存需要保留的证据。
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
- 交付前必须核对对应提交的全部必需 CI 结果。运行中按阶段检查状态；失败后读取具体
  步骤和日志，修复原因后再运行。不得反复查询无变化的状态或直接重跑掩盖失败。
- **禁止**在 CI 红时宣称完成；禁止用 `... | tail` 吞退出码。
- 新增或调整安全测试时，必须同步报告检查脚本要求执行的测试组和数量，并用对应测试报告验证
  检查脚本。不得通过取消数量、失败或跳过检查来适配新增测试。
- 本地候选镜像必须复用正式构建的产物准备步骤，包括 executable manifest 的运行时
  Class-Path 契约。组合验证前必须确认扩展实际装载，并验证至少一个允许操作；挂载 jar
  文件或所有请求被拒绝不能证明扩展激活。候选不得作为正式插件编译输入。

## 5. 实施流程

### 5.1 前置
```bash
proxy_on                      # 网络故障时（zsh 函数，宿主提供）；克隆成功则无需
git clone --depth 1 --branch <BASE行1> https://github.com/kestra-io/kestra.git /tmp/kestra-upstream
# blob:none 部分克隆的 lazy checkout 会中途断流（已踩），用完整浅克隆
```

### 5.2 区分分支定制与上游变化
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

### 5.4 交付检查

交付前必须完成以下检查：

1. 同步 `patches/manifest.tsv` 与实际 patch。
2. 运行 `check-patches.sh`，确认全部检查通过。
3. 在干净 BASE 树执行 `--apply-check`，确认应用后的源码与开发树一致。
4. 按第 4 节完成本地测试和构建。
5. 提交并推送改动。提交格式为 `feat(req-XXXX)|fix|chore(scope): 摘要`。
6. 核对该提交的全部必需 CI 通过，并按第 10 节发布产物。

任何必需检查未通过时，不得宣称交付完成。

## 6. 上游版本升级流程

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

## 7. 技术表达与证据要求

中文正文参考 ASD-STE100 的受控语言理念，使用常见词和明确动作，不宣称符合该英文标准。
一个术语表达一个概念，一条指令表达一个主要动作。测试中创建的账号称“测试账号”，
准备的数据称“测试数据”，前置配置称“测试配置”，不得用“夹具”统称。
正文优先使用中文；必要的英文术语首次出现时说明含义。命令、代码标识符、配置项和路径保留原文。

- 结论附**可复现命令**；统计数字写明口径；`[src]/[docs]/[dsh]` 证据分级（见差异表）。
- **时间戳/时间差不定罪**：patch/jar 是否过期只看内容级比对（git apply --check / 编译）。
- 引用前序结论注明「本轮未复测」。
- fork 行为移植后必须做**漂移核对**：`diff <新树文件> <fork文件>`，差异必须全部可归因于
  「上游 develop↔BASE 上下文」或「已声明的剥离项」，否则视为移植丢失。

## 8. 已验证的技术限制

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

- 镜像发布先构建唯一候选并固定 digest，全部协议/浏览器/MCP 验收通过后推广正式 tag；
  基础层 OCI index 由 `patches/IMAGE_BASE` 固定，变更须核验 amd64/arm64 后更新。

- main 直推（本仓无 PR 流程）；commit message 指明需求号或范围。
- 每 patch 的增/删/改在 commit message 记录理由；被删 patch 的理由入 manifest 或 commit（git 历史即归档，不留 .bak）。
- 本文件与 `docs/oss-ee-gap.md`、`patches/manifest.tsv` 与实际 patch 集**四者一致**，由
  `check-patches.sh` 部分强制、评审补足。

## 10. 独立构建边界与交付顺序

本仓的构建和 CI 不读取、检出、编译或打包任何 `kestra-plugin-*` 项目。
主控可以调查消费项目源码以识别契约缺口。调查不得形成构建依赖。
扩展仓的构建和 CI 不得读取相邻宿主源码、patch、开发目录或未发布 jar，也不得触发宿主构建。
扩展注册表只声明公开 SPI 与部署文件名，不包含消费仓内部目录或构建指令。
本仓 CI 的探针源码属于本仓测试，只验证公开契约，不引用真实业务插件。
交付必须按以下顺序执行：

1. 本仓独立构建 overlay 镜像，通过公开契约检查和全部 CI，发布镜像。
2. 扩展仓取得已发布宿主产物，独立编译插件 jar，通过自身 CI，发布产物。
3. 部署仓选择兼容组合，执行 Compose 验收。

必须记录源码提交、镜像摘要（digest）和产物校验值（hash）。不得仅用可复用标签证明版本。
候选镜像不得作为正式插件交付的编译输入。只有部署仓可以决定跨仓部署组合。
