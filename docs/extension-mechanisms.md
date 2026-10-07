# kestra 扩展机制原理：编译 / 重启 / 外部 jar（调查记录）

> 回答三个根本问题：**改一个架构能力，要不要重新编译？要不要重启？要不要外部 jar？**
> 证据基于 BASE（v2.0.5 @ 172dd0f37）源码 + dsh 项目实证 + kestra.io 文档；复现命令见 §5。
> 与 `docs/oss-ee-gap.md` 的分工：差异表回答「补什么」；本文回答「怎么生效」。

## 0. 结论矩阵（一页答案）

| 通道 | 是什么 | 重新编译 kestra？ | 需要外部 jar？ | 需要重启？ | 生效时机 | 本仓/扩展仓对应 |
|---|---|---|---|---|---|---|
| ① 源码 patch | 改上游源码（webserver M 面） | **要**（overlay CI 重编 executableJar + 重建镜像） | 否 | **要**（镜像重建+容器重启） | 构建期 | 本仓 1 个 patch（REQ-0011） |
| ② classpath 合并 jar | 扩展 jar 与 fat jar 同 classpath（bean 进 Micronaut 上下文） | **否**（扩展仓独立编译，micronaut 注解处理产 bean 索引） | **要 manifest 条目**（构建期注入；jar 本体可烤进镜像或运行时挂载，缺席=静默休眠——R-CLASSPATH-MERGE 选型 b 已裁定，见 §4） | **要**（bean 发现在启动期，F2） | 启动期 | kestra-oidc-provider 的 webserver 侧认证链 jar、R-EE-RBAC 的 SecurityRule/Authorizer jar（IdP 进程独立成镜像，不受此通道影响） |
| ③ plugins/ 插件 jar | `KESTRA_PLUGINS_PATH` 目录（默认 /app/plugins） | 否 | 要（jar 放目录/经 API 装） | **分形态**：auto-install 开启（OSS+local 存储**默认开**，dsh 栈即此形态）→ **否**（API 安装即时注册）；关闭形态 → 要（重启扫描） | 启动期；auto-install 开启时即时 | 无活跃插件客户（注册表 `extensions.tsv`；2026-10-07 范围收窄后 apps 插件行已删） |
| ④ 部署配置 | yml/env（`KESTRA_CONFIGURATION`→`MICRONAUT_CONFIG_FILES`）：micronaut.security.enabled、intercept-url-map 等 | 否 | 否 | **要**（@Value/配置绑定在 bean 创建期） | 启动期 | kestra-oidc-provider 部署面（最小端点门；intercept-url-map 属 micronaut-security 配置面，生效前提=认证链 jar 进镜像，R-CLASSPATH-MERGE 前置） |
| ⑤ 运行时 settings | settings 存储（API 写入的键值，如 Basic Auth 凭据） | 否 | 否 | **否**（服务按调用读库） | 即时 | REQ-0011 兜底语义依赖（settings 缺席→fallback） |
| ⑥ 运行时数据 | flows/triggers（BroadcastQueue 事件） | 否 | 否 | **否**（队列订阅重索引） | 即时 | 历史示例 REQ-0020 AppRouteRegistry（已随 apps 范围收窄删除，2026-10-07；通道语义仍成立：队列事件驱动的内存索引即时更新） |

## 1. 三条底层事实（一切结论的根）

**F1 进程形态：selfrun fat jar，classpath 只有它自己。**
`/app/kestra` = shadowJar 字节 + selfrun 脚本前缀拼进 zip（`build.gradle:626` writeExecutableJar）；
selfrun 末行 `exec java … -jar "$0"`（`gradle/jar/selfrun.sh:35`）——**`-jar` 模式，JVM classpath =
fat jar 自身，`-cp`/`CLASSPATH` 一律被忽略**（java 工具文档：the JAR file is the source of
all user classes and other class path settings are ignored）；官方 Dockerfile 唯一注入点是
`COPY docker /` + `plugins/`（`Dockerfile:9-13`），无 `/app/libs` 约定、无 `-cp`
（docker-entrypoint 仅 `exec /app/kestra "$@"`，`docker/usr/local/bin/docker-entrypoint.sh`）。
⇒ 官方镜像形态下，**外部 jar 进应用 classpath 的唯一入口在构建期**：并入 fat jar（EE 的
做法——EE 类名出现在 OSS 的 logback/base.xml:21-23 与 cli/BaseCommand.java:45，证明 EE bean
运行期从已并入的 jar 装载）或注入 manifest `Class-Path` 条目（选型 b：jar 本体可运行时挂载，
见 §4）。`plugins/` 目录不是 classpath 入口——那是插件体系自己的 `PluginClassLoader`
（`extends URLClassLoader`，`PluginClassLoader.java:19`）+ 反射，不进应用类加载器与 Micronaut
上下文（F3），故 bean jar（@Controller/@Filter/SecurityRule）装不进 plugins/。

**F2 bean 定型于启动期，无运行期增删。**
Micronaut ApplicationContext 启动时从 classpath 的 bean 索引（注解处理器生成的
`BeanDefinitionReference` 服务文件；shadowJar `mergeServiceFiles()`（build.gradle:610）跨模块
合并）装载 bean 定义；OSS 全仓无 `registerBean`/动态 bean 注册（grep 为空）。⇒ **一切 bean 级
扩展（②③④ 的 bean 面）都重启生效**；扩展 jar 必须带 micronaut 注解处理 bean 索引
（dsh 试点实证：无索引则 bean 不可见 `[dsh]`）。**聚合面推论（2026-10-07 复核）**：OSS 侧
以 `Collection<Bean>` 注入的聚合点会自动纳入 classpath 上**全部**同类型 bean——实证
`MigrationRunner`（core/migration/MigrationRunner.java:47-56，注入 `Collection<MigrationScript>`
且 INIT_SCRIPT_IDS 预留 `0-init-ee`）⇒ 扩展仓 jar 自带 MigrationScript bean（bean+SQL 成对）
即自动进迁移执行，**overlay 无需任何 migration patch**（原 dsh fork 的 SQL-only patch 失效
根因即缺 bean 注册，AGENTS.md §8-2 教训由此升级为机制结论）。EE 的官方激活话术「license key 写进配置、
重启即激活、无代码变更」`[docs]` 与此一致。

**F3 插件体系与 Micronaut bean 图隔离。**
插件经 `PluginClassLoader`（URLClassLoader 子类）**反射实例化**，不进 Micronaut 上下文
（`PluginScanner`/`DefaultPluginRegistry` 零 Micronaut 引用；`ApplicationContextInitializable`
javadoc 自诫该逃生孔 "breaks the Micronaut bean life-cycle graph… should be avoided"）。
⇒ **plugins/ 目录不能承载 webserver @Controller/@Filter**（dsh fork 据此把 Dsh* 控制器定为
外部 classpath jar 而非 plugins 插件 `[dsh]`）。细节：`DefaultPluginRegistry` 本身可变
（`register(Path)`/`unregister`，:121/:134/:195），webserver 有异步安装端点
（PluginController `@Post("install")`:152，"newly-installed plugin shows up on the next
request"）。端点受 `pluginAutoInstallService.isEnabled()` 门控，而 **auto-install 是 OSS 能力、
不是 EE 特性**：`computeEnabled`（`PluginAutoInstallService.java:89-99`）在 **EE 上强制关**
（提示改用 Plugin Versioning）；OSS 上显式 `kestra.plugins.auto-install.enabled` 优先，
缺省 = `kestra.storage.type=local` 时**默认开启**。dsh 正式栈 storage.type=local
（docker-compose.yml:240）⇒ 运行期装插件（API）即时注册、**无需重启**。
〔2026-10-07 方向修正：本文初版把该门控读反为「EE 特性、OSS 强制关」；条件谓词
`!= OSS → 关` 必须连 warn 文案与返回值一起读（AGENTS.md §8-9 教训）〕
   门控如此安排的**设计动因**（源码注释自述一半 + 商业模型推另一半）：
   ① **爆炸半径**：运行期安装只注册**本机** registry（OSS core 无跨节点传播机制，
   PluginInstallJob/Service 无 queue/broadcast——已 grep 证实），因此只在本机+本地盘
   （"local persona"）形态下一致性安全；storage.type=local 被用作该形态的信号
   （构造器注释原文："the storage type is the signal that distinguishes `server local`
   from a generic standalone deployment on S3/GCS, which must stay inert"）。
   ② **EE 有受管替代品**：Plugin Versioning（声明式固定版本、集群一致、可审计）。
   同时放行 ad-hoc 运行期安装 = 两个插件状态事实源 → 漂移；故 EE 强制关并在 warn
   里直接指路。集群传播是 EE 层能力（端点描述自述）。
   ③ **商业分层**（对抗性上游）：OSS 给单机开发者体验类能力（贴 flow 自动装缺失
   插件 installMissingPlugins(flowYaml):216、渲染器按需装）是拉新漏斗、单机零成本；
   EE 卖治理/可复现——所以此处的阉割方向与多数门控相反：不是给 EE 加功能，
   而是把 OSS 便利从 EE 拿掉。dsh 栈恰在 local persona 安全区内；一旦多节点/
   共享存储，同样的一致性风险回归（届时回归烤 jar 或自建受管机制）。

## 2. 各通道证据细则

| # | 关键证据（BASE file:line） | 限制/边界 |
|---|---|---|
| ① | `build.gradle:626-651`（writeExecutableJar=shadowJar+selfrun 前缀）；overlay `scripts/build.sh`（patch→executableJar→镜像） | 每 patch 一行都是升级成本（AGENTS.md §3 质量法的动因） |
| ② | `gradle/jar/selfrun.sh` 末行 `-jar "$0"`；`Dockerfile:9-13`（COPY docker / + plugins RUN）；EE 痕迹 logback/base.xml:21-23、BaseCommand.java:45；dsh 试点 13/13 `[dsh]`；聚合面实证 `MigrationRunner.java:47-56`（Collection 注入收全量 bean） | 承载机制已立案 R-CLASSPATH-MERGE（§4，候选 b：manifest Class-Path 注入）；同包同名类遮蔽待 OQ2 实证 |
| ③ | selfrun.sh 头部 `KESTRA_PLUGINS_PATH` 导出；`DefaultPluginRegistry.getOrCreate():57`（启动 `scanner.scan()` 注册）；PluginController:152 安装端点 + `computeEnabled`:89-99 门控（OSS+local 默认开；EE 强制关） | 只承载任务/触发器/Runner 等插件面（F3）；新任务类型对**新** flow 生效，已解析 flow 不追溯；安装的 jar 落 local repo（LocalPluginManager），集群传播是 EE（单机 OSS 无此面） |
| ④ | selfrun.sh `KESTRA_CONFIGURATION`→`MICRONAUT_CONFIG_FILES`；MiscController `@Value("${micronaut.security.enabled:false}")`（REQ-0011 patch 面）= bean 创建期绑定 | 配置改了不重启=不生效（常见误判源） |
| ⑤ | `BasicAuthService.credentials():205-210`（每次调用 `settingRepository.findByKey` 查库） | 仅 settings 存储面；yml 键不在此列（属④） |
| ⑥ | `AppRouteRegistry`〔REQ-0020 patch，已随 apps 范围收窄删除——机制范例留档〕：`@PostConstruct` 全量索引 + BroadcastQueue 订阅增量 | 队列事件驱动的内存索引；重启后重建 |

## 3. EE 交付形态的印证（为什么 ② 是「官方通道」）

EE 与 OSS 同 codebase，以 classpath jar + license key 叠加交付（`[docs]` kestra.io/docs/oss-vs-paid：
"adding a license key to your configuration and restarting Kestra — no code changes required"）。
OSS 源码为 EE 预留的挂接点（@Requires(missingClasses)、桩 bean+@Replaces、Optional 注入——
差异表 §1 S1-S8）只有在「EE jar 已在 classpath」时才被激活——这正是 F1/F2 的直接推论：
**jar 在镜像里、开关在配置里、生效在重启时**。dsh 的 OIDC 豁免（kestra-oidc-provider 以
classpath jar 补 micronaut-security 链）复用的是同一架构事实：OSS webserver 构建里只有
`micronaut-security-csrf`（webserver/build.gradle:25），认证过滤器链本来就靠 jar 带入。

## 4. 对 overlay 的结论与 R-CLASSPATH-MERGE 立案（**选型 b 已裁定，2026-10-07 维护者确认**）

- 当前已落地通道：**①（REQ-0011 单 patch）+ ④（部署配置）**；③ 无活跃客户；
  通道② 的镜像承载是本仓「EE 同构交付」的**核心缺口**（kestra-oidc-provider 认证链 jar、
  R-EE-RBAC 的 SecurityRule jar 都卡在这里，差异表 §1-S6 统一口径），已立案为正式提案
  **R-CLASSPATH-MERGE：实施待指令**（2026-10-07 范围收窄后，apps/harness 消费面已删，
  剩余两个消费方均为保留事项）。

**方案（选型 b）**：build.sh 对**构建产物**做 zip 级后处理，向 executable jar 的 manifest
注入 `Class-Path: libs/x.jar …`。**零 patch 文件、不动上游 build 面
（settings.gradle/docker-entrypoint 均不触）、不改 Dockerfile。** 构建期可行性证据：
selfrun `exec java … -jar "$0"`（selfrun.sh:35）；executable 为合法 zip——selfrun 以
`ZipPrefixer.applyPrefixBytesToZip` 作**前缀**字节拼入、不改 zip central directory
（build.gradle:626-651）；官方 Dockerfile `COPY --chown=kestra:kestra docker /`（Dockerfile:9）
+ plugins 装载 RUN 块（:11-13）证明 `docker/` 子目录是既有注入通道（`docker/app/kestra`
暂存先例 ⇒ `docker/app/libs/` 落 `/app/libs/`，manifest 条目相对 /app/kestra 解析）。

**交付形态（双模式；manifest 条目 = 镜像 ↔ 部署的唯一契约）**：
- **烤进镜像**：build-extensions.sh 把 classpath 槽 jar 暂存 `docker/app/libs/`（可复现默认）；
- **运行时挂载**：部署侧 `-v $PWD/libs:/app/libs`，镜像保持 vanilla+patch、零扩展 jar 字节
  （约束：挂载 jar 文件名须与 manifest 条目一致；**两种模式都需重启生效**——F2）。

落选记录：(a) fat jar 解包合并（需复刻 mergeServiceFiles 语义、产物不可与上游逐字节对照、
jar 不可运行时换挂；EE 实际即此形态）；(c) 自定义 entrypoint `-cp`（`-jar` 下被忽略须绕过
selfrun，丢 `KESTRA_PLUGINS_PATH`/`KESTRA_CONFIGURATION→MICRONAUT_CONFIG_FILES` 管线，
触碰 build 面，最次选）。

### JVM 语义实证（2026-10-07，JDK 25 三组最小实验）

```
复现骨架（详见本轮 git 历史/对话记录）：
  printf 'Main-Class: Demo\nClass-Path: libs/ext.jar\n' > mf.txt
  jar --create --file main.jar --manifest mf.txt -C out_main .
  java -jar main.jar        # A: 无 libs/ → STARTUP-OK、exit 0、无警告；B: 有 → EXT-INIT
```

1. **jar 缺席 = 静默休眠**：manifest 引用不存在的 jar → 启动成功、exit 0、无任何警告
   （JVM 对 Class-Path 缺席条目的规范行为，「可选扩展」语义）；主 jar 自身类/资源/功能
   完全不受影响。⇒ manifest 条目可**无条件**烤入：缺席=休眠激活点，挂载=开关，重启=生效
   ——与 EE「license 写进配置、重启激活」同构。副作用仅「静默」：检测靠功能面探测
   （认证链未挂 → /oidc/login 404）或部署侧自检。
2. **`.class` 字面量懒解析**：主 jar 代码以 `X.class` 字面量引用仅存在于扩展 jar 的类
   （编译期见过、运行时缺席）→ **首次执行**抛 NoClassDefFoundError。⇒ **设计硬约束（通用，
   适用于任何未来 patch）**：fat jar 内代码不得以 `.class` 字面量或注解（含
   `@Error(exception = X.class)`）引用仅存在于扩展 jar 的类——若必须引用，用**类名字符串
   比较**（`declaring.getName().equals(...)`，不触发加载）或把标记类留作 fat jar 编译锚。
   〔该约束的原始场景（apps patch 收窄）已随范围收窄删除，教训保留〕
3. **同 FQN 主 jar 优先**：Class-Path 扩展 jar 中的同名类**结构性无法覆盖** fat jar 内的
   上游/patch 类——「意外遮蔽上游」整类风险排除；代价是「用扩展 jar 替换同名类」走不通
   （S6 同包策略只加新类名，不受影响）。

### 实施步骤（两步，先本地后 CI）

1. 本地机制验证（不跑 gradle）：JVM 语义部分**已实证**（上三组）；剩余 = 对真实 webserver
   executable jar 做 zip 级 manifest 注入冒烟 + selfrun 前缀完整性核对；
2. CI 端到端：build.sh 注入探针 jar（含 `@Context` 生命周期 bean，启动打日志），验证启动期
   bean 装载（F2 面），并闭环 OQ2 剩余项。

- **OQ2（认知边界）——半闭环（2026-10-07）**：同包同名类遮蔽方向**已实证**（实验 3：主 jar
  赢，良性）；**剩余** = bean 索引（`META-INF/services` 的 micronaut
  BeanDefinitionReference 条目）经 Class-Path 的可见性端到端——`ClassLoader.getResources`
  对多 jar 同名 service 条目并列返回，预期成立，随实施步骤 2 确认。

## 5. 复现命令（BASE 树内执行）

```bash
git show "$(sed -n 2p patches/BASE):gradle/jar/selfrun.sh"          # F1：-jar "$0"、KESTRA_PLUGINS_PATH、KESTRA_CONFIGURATION
git show "$(sed -n 2p patches/BASE):Dockerfile"                     # F1：唯一注入点 plugins/
git grep -n "registerBean\|DynamicBean" -- '*.java' | grep -v test  # F2：空=无运行期 bean 注册
git grep -n "micronaut\|ApplicationContext" -- 'core/src/main/java/io/kestra/core/plugins/DefaultPluginRegistry.java' 'core/src/main/java/io/kestra/core/plugins/PluginScanner.java'  # F3：空=插件不走 Micronaut
sed -n '150,170p' webserver/src/main/java/io/kestra/webserver/controllers/api/PluginController.java  # ③：安装端点+门控
sed -n '40,70p' core/src/main/java/io/kestra/core/migration/MigrationRunner.java                      # F2 聚合面：Collection<MigrationScript> 收全量 bean
```

升级 BASE 后本文与差异表一并复扫（AGENTS.md §6 步骤 3）。
