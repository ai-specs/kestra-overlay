# kestra 扩展机制原理：编译 / 重启 / 外部 jar（调查记录）

> **发布治理修复（2026-10-11）**：基础镜像以 `patches/IMAGE_BASE` OCI index digest
> 固定。构建只推唯一候选 tag，验收全部使用候选 digest；MCP/OIDC/浏览器门全部成功
> 后才推广 release/commit/latest tag。禁止验收前更新可部署正式 tag；发布串行化，并在晋级前核对 main HEAD，防
> 旧 run 覆盖新版本，不改上游 Dockerfile，用 build-arg 固定基础层。

> **MCP 用户归属机制（已交付，真实 CI 验收通过）**：0150/0160/0170/0180/0190
> 提供DCR pending、owner/consent、resource Bearer、能力门、OAuth-only及管理限速。
> DCR pending 只提供可发起授权的 client_id；
> 登录确认时事务绑定不可变 owner、权限授权与 code，后续 token/refresh/MCP 执行
> 均校验用户/client/目标资源。OIDC 身份声明与 OSS tenant 桩本身不提供数据隔离。
> 完整机制与兼容性边界见 [mcp-oauth-integration.md](mcp-oauth-integration.md)。
> 最新分层：本仓 scope 门独立限制资源大类 read/write/delete（write 不含 delete），
> 服务端暴露策略∩请求∩用户同意决定授权。外部 RBAC 启用后，必须通过统一
> Authorizer 拦截每个实际 MCP 资源操作，与 REST 同语义；直接/批量/异步路径
> 不能绕过。承载缺席可休眠只适用于未启用授权，启用后组件异常必须失败关闭。
> 当前只有MCP-only SPI与scope gate，外部RBAC jar及REST适配未交付。
> 缺bean镜像门、异常Authorizer handler→gate→queue单元门各自验证失败关闭，
> 不等同完整REST/MCP数据隔离。镜像撤销 existing session/refresh 由 CI 的 `scripts/blackbox-mcp-oauth.sh`
> 验收，复跑命令见 README；不依赖先前交互浏览器状态。

> 三个根本问题：改一个架构能力——要不要重新编译？要不要重启？要不要外部 jar？
> 证据：BASE（v2.0.5 @ 172dd0f37）源码（含上游自述 docs/architecture/）+ dsh 实证
> + kestra.io 文档 + vanilla 实例实测（v2.0.5-no-plugins）。复现命令见 §5。
> 分工：差异表（oss-ee-gap.md）答「补什么」；本文答「怎么生效」。

> **2026-10-09 认证机制修正**：启用 OIDC 时完全停用 Basic Auth 链。仅后端暴露
> oidcAuthEnabled 不足以驱动 BASE UI：其守卫仍检查 Basic Auth 标志。REQ-0132
> 同批替换 UI 守卫、401 跳转与退出，认证状态从服务端验证，禁止兼容旧 cookie。
> UI 改动经 npm 构建进入 jar；本例外仅认证面。验收含登录后刷新、导航与退出。
> REQ-0132 已实现独立 OIDC UI 状态与服务端旧端点禁用，CI 增 Chromium 真实
> 登录/刷新/导航/退出测试；本地机制证据见 docs/r-oidc-server.md §0。
> REQ-0133 初始化通过同 datasource 事务创建用户、凭据、UI client 与持久化标记；
> 环境变量首次生效，已初始化后不覆盖数据。空库引导与环境变量共用逻辑。
> 已实现初始化入口：首次访问 UI/OIDC 客户端入口读取 bootstrap 环境变量；未提供
> 则 303 到 `/oidc/setup`。完成后标记持久化，后续 GET/POST 均关闭，不烤入用户数据。
> 再审加固：数据库安装 ID 与独立持久化文件绑定；删除单方标记不能激活，损坏/
> 不一致/中断事务遗留状态失败关闭。凭据必须保留在部署卷，不能只存容器可写层。

## 0. 结论矩阵（一页答案）

| 通道 | 是什么 | 重编译 kestra？ | 要外部 jar？ | 要重启？ | 生效时机 | 对应 |
|---|---|---|---|---|---|---|
| ① 源码 patch | 改上游源码（webserver M 面） | **要**（overlay CI 重编 executableJar + 重建镜像） | 否 | **要** | 构建期 | 本仓 1 个 patch（REQ-0011）；预留 R-OIDC-SERVER（授权服务器，patch 路线——2026-10-07 裁定） |
| ② classpath jar | 扩展 jar 与 fat jar 同 classpath，bean 进 Micronaut 上下文 | 否（扩展仓独立编译，带 micronaut 注解处理 bean 索引） | **要 manifest 条目**（构建期注入；jar 本体仅运行时挂载，缺席=静默休眠——R-CLASSPATH-MERGE 选型 b，见 §4） | **要**（F2） | 启动期 | R-EE-RBAC SecurityRule jar（契约 `kestra-rbac-authorizer.jar`）。认证链不走此通道——前置裁定②与 R-OIDC-SERVER 一体化进 patch（2026-10-07） |
| ③ plugins/ 插件 jar | `KESTRA_PLUGINS_PATH` 目录（默认 /app/plugins；部署注入 = `-v ./plugins:/app/plugins` 或 `-e KESTRA_PLUGINS_PATH=/挂载点`，重启生效——F4 ①） | 否 | 要（jar 放目录/经 API 装） | **分形态**：auto-install 开 → 否（API 装即时注册）；关 → 要 | 启动期；auto-install 开时即时 | 无活跃插件客户（`extensions.tsv`） |
| ④ 部署配置 | yml/env（`KESTRA_CONFIGURATION`→`MICRONAUT_CONFIG_FILES`） | 否 | 否 | **要**（配置绑定在 bean 创建期） | 启动期 | kestra-oidc-provider 端点门（前提 = 认证链 jar 进镜像） |
| ⑤ 运行时 settings | settings 存储（API 写入的键值） | 否 | 否 | **否**（按调用读库） | 即时 | REQ-0011 兜底语义（settings 缺席 → fallback） |
| ⑥ 运行时数据 | flows/triggers（BroadcastQueue 事件） | 否 | 否 | **否**（队列订阅重索引） | 即时 | 无（通道语义留档：事件驱动内存索引即时更新，重启重建） |

auto-install 开关三层（③行「分形态」的展开）：源码级 OSS+local 默认开（`computeEnabled:89-99`）→ 镜像变体覆盖（slim=开、no-plugins=烤配置关，F4）→ 部署显式配置最终覆盖（④通道）。

## 1. 四条底层事实（一切结论的根；F4 = 官方镜像启动链实录）

**F1 进程形态：selfrun fat jar，classpath 只有它自己。**

`/app/kestra` = selfrun 脚本前缀 + fat jar zip（`build.gradle:626` writeExecutableJar）。
selfrun 末行 `exec java … -jar "$0"`（`gradle/jar/selfrun.sh:35`）。
`-jar` 模式下 JVM 只认 fat jar 自身 + 其 manifest `Class-Path`；`-cp`/`CLASSPATH` 一律忽略
（java 工具文档：the JAR file is the source of all user classes and other class path
settings are ignored）。
官方 Dockerfile 唯一注入点 = `COPY docker /` + `plugins/`（`Dockerfile:9-13`）。
docker-entrypoint 全文 3 行，只做 `exec /app/kestra "$@"`。

**UI 保留要求（2026-10-09 修正）**：`no-plugins` 不表示无 UI。BASE 的
`ui/vite.config.js` 将 `npm run build` 输出到 `webserver/src/main/resources/ui`，
随后 `executableJar` 打包这些资源。overlay 构建必须先执行 `cd ui && npm ci && npm run build`，
再执行 Gradle；仅执行 Gradle 会漏打 UI，属于构建缺陷。黑盒门须断言已认证
`GET /ui/` 返回 200 与应用 HTML，不得将 404 当作成功条件。

推论：外部 jar 进应用 classpath 的唯一入口在**构建期**——并入 fat jar（EE 的做法，见
logback/base.xml:21-23 与 cli/BaseCommand.java:45 的 EE 类痕迹），或注入 manifest
`Class-Path` 条目（选型 b：jar 本体可运行时挂载，见 §4）。
`plugins/` 不是 classpath 入口。插件走自己的 `PluginClassLoader`（`extends URLClassLoader`，
`PluginClassLoader.java:19`）+ 反射，不进应用类加载器与 Micronaut（F3）。bean jar 因此装不进
plugins/。

**F2 bean 定型于启动期，无运行期增删。**

Micronaut 启动时从 classpath 的 bean 索引装载 bean 定义（注解处理器生成的
`BeanDefinitionReference` 服务文件；shadowJar `mergeServiceFiles()` 跨模块合并，
`build.gradle:610`）。OSS 全仓无 `registerBean`/动态 bean 注册（grep 为空）。

推论一：一切 bean 级扩展（②③④ 的 bean 面）重启生效。扩展 jar 必须带 micronaut 注解处理
bean 索引——无索引则 bean 不可见 `[dsh]`。
推论二（聚合面，2026-10-07 复核）：OSS 侧以 `Collection<Bean>` 注入的聚合点自动纳入
classpath 上全部同类型 bean。实证：`MigrationRunner`（`core/migration/MigrationRunner.java:47-56`，
INIT_SCRIPT_IDS 预留 `0-init-ee`）。⇒ 扩展仓 jar 自带 MigrationScript bean（bean+SQL 成对）
即自动进迁移执行，overlay 无需 migration patch。

EE 官方话术「license 写进配置、重启激活、无代码变更」`[docs]` 与 F2 一致。

**F3 插件体系与 Micronaut bean 图隔离。**

插件经 `PluginClassLoader` 反射实例化，不进 Micronaut 上下文。
`PluginScanner`/`DefaultPluginRegistry` 零 Micronaut 引用（grep 为空）。
`ApplicationContextInitializable` javadoc 自诫该逃生孔 "breaks the Micronaut bean
life-cycle graph… should be avoided"。
⇒ plugins/ 目录不能承载 webserver `@Controller`/`@Filter`。

registry 本身可变（`register(Path)`/`unregister`，:121/:134/:195）。webserver 有异步安装端点
（`PluginController @Post("install")`:152）。端点受 auto-install 门控，行为读全（2026-10-07）：

- 关 → 403 + "Plugin auto-install is disabled on this instance."；
- 开 → 仅 catalog 白名单 artifact（`isFromCatalog`；任意 Maven 坐标 400 拒绝）+ 202/jobId
  异步（`GET /plugins/install/{jobId}` 轮询；429 限并发）；
- OSS 上显式配置永远赢（构造器注释原文 "An explicit property value always wins on OSS"）；
  EE 强制关 + warn 指路 Plugin Versioning；
- **启动目录扫描无条件**（`DefaultPluginRegistry.getOrCreate():57`）——不受门控，
  这就是「目录预置 + 重启」在任何变体可用的根源。

auto-install 门控如此设计的动因（源码注释自述一半 + 商业模型推另一半）：
① 爆炸半径——运行期安装只注册本机 registry，OSS 无跨节点传播（PluginInstallJob/Service
无 queue/broadcast，已 grep 证实），故只在 local 形态安全；storage.type=local 是该形态的信号。
② EE 有受管替代品（Plugin Versioning：声明式、集群一致、可审计）——同时放行 ad-hoc 安装
会造成两个事实源漂移，故 EE 强制关。
③ 商业分层——OSS 的运行期便利是拉新漏斗；EE 卖治理。此处阉割方向与多数门控相反：
不是给 EE 加功能，是把 OSS 便利从 EE 拿走。
〔镜像变体覆盖该缺省开关：slim=开、no-plugins=烤配置关——见 F4〕

**F4 官方镜像启动链实录（v2.0.5，含 no-plugins 变体）。**

```
docker run kestra/kestra[:v2.0.5|-no-plugins] server standalone   # 典型命令（官方 docker-compose.yml:30）
└─ ENTRYPOINT ["docker-entrypoint.sh"]（Dockerfile:15；无命令时 CMD 默认 ["--help"]，:17）
   └─ docker/usr/local/bin/docker-entrypoint.sh（全文 3 行）：exec /app/kestra "$@"
      └─ /app/kestra = selfrun 前缀 + fat jar zip（build.gradle:626-651）
         selfrun（gradle/jar/selfrun.sh，35 行）：
           ① KESTRA_PLUGINS_PATH 缺省 = $(dirname $0)/plugins = /app/plugins，导出（:2-3）
           ② KESTRA_CONFIGURATION → 写 <confs>/application.yml → MICRONAUT_CONFIG_FILES（:6-10）
           ③ Java≥25 版本门（:12-19）；add-opens×3 + unsafe-memory-access + MaxRAMPercentage=50
             + --enable-native-access（:21-32，可被 JAVA_OPTS 覆盖）
           ④ exec java … -jar "$0" "$@"（:35）—— F1：classpath = fat jar + manifest Class-Path
         JVM：Main-Class = io.kestra.cli.Kestra（build.gradle:49；manifest :598）
         → picocli：server standalone 单 JVM 起 webserver/executor/worker/indexer
           （cli/commands/servers/StandAloneCommand.java）
         → Micronaut 上下文（F2：bean 定型）
         → @Context MigrationStartupRunner 先于仓储 bean 执行 MigrationRunner.autoRun()
         → Netty 监听 8080（Micronaut 缺省；官方 compose 映射 8080:8080，docker-compose.yml:60-61）
```

端口面：主 HTTP **8080**。management 端点 **8081**（`endpoints.all.port`，
`cli/src/main/resources/application.yml:138`；compose 注释明言缺省不暴露、无鉴权）。
gRPC server 缺省 disabled（同文件 :130-133）。

镜像变体差异（上游自述 `docs/architecture/PLUGIN_AUTO_DOWNLOAD.md:63-75`）：
full / slim / no-plugins 共用同一 Dockerfile 与 base 镜像（构建在 kestra-io/actions 仓）。
差异只有两处——烤进镜像的 Kestra 配置，与 /app/plugins 内容：

- `:<version>`（full）：全部插件预装；
- `:-slim`：纯核心引擎，auto-install 默认开；
- `:-no-plugins`：纯核心引擎，auto-install 烤配置关（上游定位原文："customers who want
  to control the exact plugin set on hardened environments"）。

**本仓镜像的变体谱系与定位（2026-10-07 命名与定位裁定）**：主 tag `${RELEASE}-no-plugins`。
定位 = 上游 no-plugins 谱系的加固形态，两条铁律：

1. **构建期零外部扩展 jar**。镜像 = vanilla + patch。任何扩展 jar（③ 插件槽 / ② classpath
   槽）一律部署侧预置/挂载 + 重启生效。classpath 承载的构建期唯一动作 = 注入 manifest
   `Class-Path` 条目元数据（R-CLASSPATH-MERGE，§4——不是 jar 字节）。
2. **静态插件集纪律**。插件集由部署侧精确预置。auto-install 无法在镜像内烤关（selfrun
   只认 `KESTRA_CONFIGURATION` 环境变量，烤配置文件不生效；源码缺省在 OSS+local 开）——
   **部署基线应显式 `kestra.plugins.auto-install.enabled: false`**（④ 通道，重启生效）。

与上游同名变体的唯一实现差异 = 第 2 点的「部署侧承担烤关」。
历史无后缀 tag（如 `v2.0.5`）停止更新；registry 旧副本为遗留。

## 2. 各通道证据细则

| # | 关键证据（BASE file:line） | 限制/边界 |
|---|---|---|
| ① | `build.gradle:626-651`（writeExecutableJar）；overlay `scripts/build.sh` | 每 patch 一行都是升级成本（AGENTS.md §3 的动因） |
| ② | `selfrun.sh:35`（`-jar "$0"`）；`Dockerfile:9-13`；EE 痕迹 logback/base.xml:21-23、BaseCommand.java:45；`[dsh]` 13/13；聚合面 `MigrationRunner.java:47-56` | 承载 = R-CLASSPATH-MERGE（§4）；同包同名类遮蔽待 OQ2 实证 |
| ③ | `PluginScanner.scan(Path):62-88`（PluginResolver 枚举 → 逐组 `PluginClassLoader.of` → `scanClassLoader` 识别插件类型）；`DefaultPluginRegistry.getOrCreate():57`（启动注册，无条件）；`PluginController:152` 安装端点 + `computeEnabled`:89-99 门控（门控行为读全见 F3） | 只承载任务/触发器/Runner 等插件面（F3）。新任务类型对**新** flow 生效，已解析 flow 不追溯。安装 jar 落 local repo；集群传播是 EE |
| ④ | selfrun `KESTRA_CONFIGURATION`→`MICRONAUT_CONFIG_FILES`；MiscController `@Value("${micronaut.security.enabled:false}")`（REQ-0011 面） | 配置改了不重启 = 不生效（常见误判源） |
| ⑤ | `BasicAuthService.credentials():205-210`（每次调用查库） | 仅 settings 存储面；yml 键属④ |
| ⑥ | BroadcastQueue 订阅 + `@PostConstruct` 全量索引（内存索引形态） | 事件驱动即时更新；重启后重建 |

## 3. EE 交付形态的印证

EE 与 OSS 同 codebase，以「classpath jar + license key」叠加交付 `[docs]`（oss-vs-paid：
"adding a license key to your configuration and restarting Kestra — no code changes
required"）。OSS 源码里处处是为 EE 预留的挂接点（差异表 §1 S1-S9）。这些挂接点只有在
「EE jar 已在 classpath」时才被激活——F1/F2 的直接推论：**jar 在镜像里、开关在配置里、
生效在重启时**。`[dsh]` 旁证：OIDC 部署以 classpath jar 补 micronaut-security 链，复用同一
架构事实（OSS webserver 构建里只有 csrf，`webserver/build.gradle:25`——认证链本来就靠
jar 带入）。

## 4. R-CLASSPATH-MERGE 承载（选型 b；2026-10-13 本地验证）

已落地通道：①（REQ-0011 单 patch）+ ④（部署配置）；③ 无客户。
通道② 的承载 scripts 已实施，消费仓为 `ai-specs/kestra-plugin-rbac`，
部署契约为运行时挂载 `kestra-rbac-authorizer.jar`；认证链已一体化进 patch，
不消费本通道。外部 bean 发现由本仓契约探针验证；真实 RBAC jar 的业务组合验收属于部署 monorepo。

**方案（选型 b）**：build.sh 对构建产物做 zip 级后处理，向 executable jar 的 manifest
注入 `Class-Path: libs/x.jar …`。零 patch 文件。不动上游 build 面。不改 Dockerfile。

构建期可行性证据：selfrun `-jar`（selfrun.sh:35）；executable 为合法 zip（selfrun 以
`ZipPrefixer.applyPrefixBytesToZip` 前缀拼入，不改 central directory，build.gradle:626-651）；
`COPY docker /`（Dockerfile:9）+ plugins RUN 块（:11-13）证明 `docker/` 子目录是既有注入通道
（`docker/app/kestra` 暂存先例 ⇒ `docker/app/libs/` 可落 `/app/libs/`；manifest 条目相对
/app/kestra 解析）。

**交付形态（唯一模式 = 运行时挂载；manifest 条目 = 镜像 ↔ 部署的唯一契约）**：
构建期唯一动作 = 注入 manifest 条目（zip 级元数据，非 jar 字节）；条目来源 =
`extensions.tsv` 的 classpath 行（现有占位：`kestra-rbac-authorizer.jar`〔授权线〕——
缺席=静默休眠，见实证 1；认证线无契约——前置裁定②链一体化进 patch）。jar 本体由部署侧
挂载 `-v $PWD/libs:/app/libs`（文件名须与条目一致；挂载后需重启——F2）。
可复现性 = manifest 条目（构建期固定）+ 部署侧 jar 版本固定。

落选记录：(a) fat jar 解包合并——需复刻 mergeServiceFiles 语义，产物不可与上游逐字节对照，
jar 不可运行时换挂（EE 实际即此形态）；(c) entrypoint 改 `-cp`——`-jar` 下被忽略须绕过
selfrun，丢 `KESTRA_PLUGINS_PATH`/`KESTRA_CONFIGURATION` 管线，触碰 build 面；
(d) 烤入 `docker/app/libs/`——与定位裁定「构建期零外部扩展 jar」冲突。

### JVM 语义实证（2026-10-07，JDK 25 三组最小实验）

```
复现骨架：
  printf 'Main-Class: Demo\nClass-Path: libs/ext.jar\n' > mf.txt
  jar --create --file main.jar --manifest mf.txt -C out_main .
  java -jar main.jar        # A: 无 libs/ → STARTUP-OK、exit 0、无警告；B: 有 → EXT-INIT
```

1. **jar 缺席 = 静默休眠**。启动成功、exit 0、无警告（JVM 对 Class-Path 缺席条目的规范
   行为，「可选扩展」语义）。主 jar 自身功能不受影响。⇒ manifest 条目可无条件烤入：
   缺席=休眠激活点，挂载=开关，重启=生效——与 EE「license 写配置、重启激活」同构。
   副作用仅「静默」：检测靠功能面探测（认证链未挂 → /oidc/login 404）或部署侧自检。
2. **`.class` 字面量懒解析**。主 jar 代码以 `X.class` 引用仅存在于扩展 jar 的类（编译期
   见过、运行时缺席）→ 首次执行抛 NoClassDefFoundError。⇒ **设计硬约束（通用）**：fat jar
   内代码不得以 `.class` 字面量或注解（含 `@Error(exception = X.class)`）引用仅存在于
   扩展 jar 的类。若必须引用：用类名字符串比较（`declaring.getName().equals(...)`，
   不触发加载），或把标记类留作 fat jar 编译锚。
3. **同 FQN 主 jar 优先**。Class-Path 扩展 jar 的同名类结构性无法覆盖 fat jar 内的类。
   「意外遮蔽上游」整类风险排除。代价：「用扩展 jar 替换同名类」走不通——S6 同包策略
   只加新类名，不受影响。

### 承载实施与本地证据（2026-10-13）

`build.sh` 与 `local-ci.sh` 在 executable 暂存到 `docker/app/kestra` 后调用
`scripts/merge-classpath.py`，从 `extensions.tsv` 的 classpath 行追加
`libs/NAME.jar`。已有 Class-Path 保留顺序、去重追加；只改主 manifest 段，
按 UTF-8 字节折行（每物理行最多 72 字节，续行首字节为空格）。
辅助工具以 ZIP append 模式保留原 local header/压缩数据及 selfrun 前缀，
中央目录移除旧 manifest 引用后写入唯一新 manifest；其他属性、命名段、ZIP
注释与执行权限保留。重复执行字节不变。零外部 jar 字节读入或暂存，
不修改上游 Dockerfile/entrypoint。辅助测试加入两条构建脚本的编译前门及 workflow 的 patch-verify 门。

本轮使用 `.work/verify/docker/app/kestra`（真实 selfrun 构建产物，相关 fat jar
在 `.work/verify/build/libs/kestra-2.0.5.jar`）的临时副本验证：75,717 个非
manifest 项的原始 local header 与压缩数据哈希一致，前缀/ZIP 注释一致、
重复注入哈希一致。完全没有 `libs/kestra-rbac-authorizer.jar` 时，经 shell
执行 executable `--help` 返回 Usage、exit 0，无 ClassNotFoundException /
NoClassDefFoundError。原有 Prometheus meter 警告仍出现；此证据仅证明真实
CLI 启动缺 jar 休眠，不能代替完整 server 启动或外部 bean 发现验收。
selfrun 的 polyglot 前缀没有 shebang，冒烟使用 bash 的 exec 格式回退执行它。

```bash
python3 -m unittest discover -s scripts/tests -v
bash -n scripts/build.sh scripts/local-ci.sh scripts/build-extensions.sh
./scripts/check-patches.sh
PATH="$(/usr/libexec/java_home -v 25)/bin:$PATH" python3 scripts/tests/smoke_classpath.py \
  .work/verify/docker/app/kestra extensions.tsv
```

辅助测试覆盖多条目、重复项、原 Class-Path、字节折行（含 UTF-8）、原属性与命名段、
前缀、执行权限、ZIP 数据、幂等、无末尾空行修复、URI 安全文件名及非法路径拒绝。前文“同 FQN 主 jar 优先”
为既有 JVM 实证，本轮未复测；工具不合并类文件，也不改变主 jar 优先顺序。
剩余闭环：本仓注册表/差异表/manifest 状态、外部契约探针的 Micronaut bean 发现、
本仓 CI/镜像验收。独立 RBAC jar 的构建归消费仓，实际部署组合验收归 monorepo。

- **OQ2（本地完整 server 探针已闭环，候选镜像 CI 待验收）**：同包同名类遮蔽方向已实证（实验 3：主 jar 赢，良性）。剩余 =
  bean 索引（`META-INF/services` 的 BeanDefinitionReference 条目）经 Class-Path 的可见性
  端到端——`ClassLoader.getResources` 对多 jar 同名 service 条目并列返回，预期成立，
  随实施步骤 2 确认。

## 5. 复现命令（BASE 树内执行）

```bash
git show "$(sed -n 2p patches/BASE):gradle/jar/selfrun.sh" | cat -n      # F1/F4：启动链 35 行全文
git show "$(sed -n 2p patches/BASE):Dockerfile" | cat -n                 # F1/F4：ENTRYPOINT/CMD/plugins 通道
git show "$(sed -n 2p patches/BASE):docker/usr/local/bin/docker-entrypoint.sh"  # F4：入口 3 行
git show "$(sed -n 2p patches/BASE):docs/architecture/PLUGIN_AUTO_DOWNLOAD.md" | sed -n '63,75p'  # F4：变体自述
git grep -n "registerBean\|DynamicBean" -- '*.java' | grep -v test  # F2：空=无运行期 bean 注册
git grep -n "micronaut\|ApplicationContext" -- 'core/src/main/java/io/kestra/core/plugins/DefaultPluginRegistry.java' 'core/src/main/java/io/kestra/core/plugins/PluginScanner.java'  # F3：空=插件不走 Micronaut
sed -n '150,170p' webserver/src/main/java/io/kestra/webserver/controllers/api/PluginController.java  # ③：安装端点+门控
sed -n '40,70p' core/src/main/java/io/kestra/core/migration/MigrationRunner.java                      # F2 聚合面
```

升级 BASE 后本文与差异表一并复扫（AGENTS.md §6-3）。

### 外部 bean 契约探针（2026-10-13 本地镜像）

`scripts/blackbox-classpath.sh` 使用真实宿主编译契约和 Micronaut 注解处理器构建
临时探针 jar，不读取或构建业务扩展仓。挂载该 jar 到本轮本地镜像后，完整 server
启动出现 `RBAC-CLASSPATH-PROBE-DISCOVERED`，无 token REST 返回 401。
探针实现三个授权 SPI 且始终拒绝，验证 bean 索引发现与承载，不提供角色模型。
该探针同时纳入候选镜像 CI，正式交付仍以真实 CI 门为准。

```bash
bash scripts/blackbox-classpath.sh "$PWD/.work/verify" \
  "$PWD/.work/verify/docker/app/kestra" kestra-overlay:rbac-contract
```

本轮完整 `scripts/local-ci.sh` 通过：146 项定向测试，144 通过、2 个受控镜像
fixture/SDK 实例测试按预期跳过，零失败；UI 构建与认证单测、executable 构建通过。
受控跳过由已有镜像黑盒与部署 monorepo 验收分别负责实际运行，不能视为通过。

### 资源查询适配的复用边界

usage HTTP 入口必须使用 tenant 报告方法，不能调用面向后台采集的全实例报告。tenant
报告的 Flow 查询和 Execution statistics 查询分别消费现有 namespace ACL。MCP server
2026-10-17 组合反馈发现评估模式的 MCP 工具注册遗漏评估边界，列表全空。0170 修复
候选对每次已验证 session 的列表建立短期评估，直接输出本次快照的可见 schema，不从
SDK 注册表复用可见性；调用处理器仍由独立 tools/call 授权。发布及组合复验尚未通过。

工具列表实际读取的是 Flow，typed adapter 必须把它分类为完整 Flow 查询。服务配置的
READ/LIST 与 CREATE/UPDATE/DELETE 是不同授权，不因工具列表允许而授予配置写权限。
REQ-0300 提案、发布与组合验收状态见 `r-ee-rbac.md`；本节只说明机制，不作为通过证据。


### 独立认证页的语言装载

REQ-0320 的 Vite 独立入口与业务 UI 使用同一 `vue-i18n` 初始化、语言目录和 JSON。
宿主在自己的构建中产出 `/ui/assets/oidc-login-i18n.js`，独立 OIDC 登录表单引用该入口；
该机制不向插件暴露宿主内部源码，不作为外部管理页面共享组件契约。
主题和国际化的实现、回退及验收要求见 `r-oidc-server.md`。发布状态以对应 CI 为准。

### 独立管理页面与账号目录：调查边界（2026-10-15）

当前 OSS 的模块联邦通道是任务 UI 插槽：`useFederatedModule.ts` 通过 PluginController
取得 task type 的模块与资源，只支持 topology details／task drawer／task modal。
它不能注册管理菜单或页面路由。`routes/routes.ts`、`utils/init.ts` 和
`override/components/useLeftMenu.ts` 仍是构建期注册；classpath bean 承载不等于前端
注册。UiController 能读 classpath 静态文件，但没有管理页面描述、版本和资源清单协议。

公开 npm 的 `@kestra-io/design-system@0.5.0` tarball 已实际取得，具有编译 dist、组件、
样式及语言相关 exports；尚未证明与本镜像 workspace 的 `0.0.0-dev` 对应。优先补兼容
声明及独立消费探针，不复制宿主源码。REQ-0320 登录翻译入口不能代替管理页面上下文。

当前源码对带实际 `tenant=main` 的未知控制器使用 typed SYSTEM 门，但外部控制器的
分类稳定性与可信身份消费方式尚须公开确认，不能把 default 分支或 Authentication
attribute 当成发布契约。认证和 `/api/.*` cookie CSRF 可以复用；授权异常仍按现有
403 失败关闭，不能承诺进入插件控制器返回 503。独立控制器探针与公开说明是接收前提。
MigrationRunner 聚合 MigrationScript 可承载扩展 bean+SQL，业务表不需 overlay patch。

动态策略还需要完整评估边界：当前 REST/runtime 逐 operation 调用及请求内查询 scope
缓存不能保证一次完整计划使用同一策略快照。独立发布二进制探针已复现混合允许，
REQ-0330 已接收最小生命周期激活点；provider 只提供不透明句柄，策略存储和 revision
归扩展。契约已随 `8d46953` 通过 CI `38732224758` 并正式发布，发布证据见
`r-ee-rbac.md`；机制检查不替代真实插件组合验收。

账号目录内部服务不是公开扩展契约；账号生命周期和密码／会话由宿主负责，受保护
管理员与授权绑定归扩展，不允许插件直接写宿主表。目录线路不阻塞角色／授权线路。
目录 SPI 记录在 `r-oidc-server.md`；管理页面及评估生命周期记录在 `r-ee-rbac.md`。
页面优先验证独立 ESM mount/unmount 与纯数据偏好上下文，不传内部框架实例；模块
联邦共享运行时须另有兼容证据。页面 REQ-0340 已由真实发布宿主装载／隔离探针补证接收；
目录 REQ-0350 已由独立 PostgreSQL
组件探针补证并接收，保留业务授权于插件；评估生命周期 REQ-0330 已接收，
三项已随 `8d46953` 通过正式发布门；页面标题修复仍须对应提交的 CI。manifest 必须与实际生成的实现 patch 同批加入；页面通用
激活的窄化例外已同步 AGENTS.md，不允许把业务页面或授权模型移入宿主。
