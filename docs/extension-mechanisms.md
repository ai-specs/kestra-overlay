# kestra 扩展机制原理：编译 / 重启 / 外部 jar（调查记录）

> 回答三个根本问题：**改一个架构能力，要不要重新编译？要不要重启？要不要外部 jar？**
> 证据基于 BASE（v2.0.5 @ 172dd0f37）源码 + dsh 项目实证 + kestra.io 文档；复现命令见 §5。
> 与 `docs/oss-ee-gap.md` 的分工：差异表回答「补什么」；本文回答「怎么生效」。

## 0. 结论矩阵（一页答案）

| 通道 | 是什么 | 重新编译 kestra？ | 需要外部 jar？ | 需要重启？ | 生效时机 | 本仓/扩展仓对应 |
|---|---|---|---|---|---|---|
| ① 源码 patch | 改上游源码（webserver M 面） | **要**（overlay CI 重编 executableJar + 重建镜像） | 否 | **要**（镜像重建+容器重启） | 构建期 | 本仓 5 个 patch |
| ② classpath 合并 jar | 扩展 jar 与 fat jar 同 classpath（bean 进 Micronaut 上下文） | **否**（扩展仓独立编译，micronaut 注解处理产 bean 索引） | **要**（官方镜像**无** libs 约定，须构建期并入——承载机制已立案 **R-CLASSPATH-MERGE**，见 §4） | **要**（bean 发现在启动期，F2） | 启动期 | plugin-apps-harness 控制器 jar、kestra-oidc-provider 的 webserver 侧认证链 jar（该仓 IdP 进程独立成镜像，不受此通道影响） |
| ③ plugins/ 插件 jar | `KESTRA_PLUGINS_PATH` 目录（默认 /app/plugins） | 否 | 要（jar 放目录/经 API 装） | **分形态**：auto-install 开启（OSS+local 存储**默认开**，dsh 栈即此形态）→ **否**（API 安装即时注册）；关闭形态 → 要（重启扫描） | 启动期；auto-install 开启时即时 | plugin-apps-amis（build-extensions.sh 注入） |
| ④ 部署配置 | yml/env（`KESTRA_CONFIGURATION`→`MICRONAUT_CONFIG_FILES`）：micronaut.security.enabled、intercept-url-map 等 | 否 | 否 | **要**（@Value/配置绑定在 bean 创建期） | 启动期 | kestra-oidc-provider 部署面（最小端点门；intercept-url-map 属 micronaut-security 配置面，生效前提=认证链 jar 进镜像，R-CLASSPATH-MERGE 前置） |
| ⑤ 运行时 settings | settings 存储（API 写入的键值，如 Basic Auth 凭据） | 否 | 否 | **否**（服务按调用读库） | 即时 | REQ-0011 兜底语义依赖（settings 缺席→fallback） |
| ⑥ 运行时数据 | flows/triggers（BroadcastQueue 事件） | 否 | 否 | **否**（队列订阅重索引） | 即时 | REQ-0020 AppRouteRegistry（flow 增删→路由索引即时更新） |

## 1. 三条底层事实（一切结论的根）

**F1 进程形态：selfrun fat jar，classpath 只有它自己。**
`/app/kestra` = shadowJar 字节 + selfrun 脚本前缀拼进 zip（`build.gradle:626` writeExecutableJar）；
selfrun 末行 `exec java … -jar "$0"`（`gradle/jar/selfrun.sh`）——**`-jar` 模式，JVM classpath =
fat jar 自身**；官方 Dockerfile 唯一注入点是 `COPY docker /` + `plugins/`（`Dockerfile:9-11`），
无 `/app/libs` 约定、无 `-cp`。⇒ 官方镜像形态下，**外部 jar 要进应用 classpath 只能在构建期
并入 fat jar**（EE 正是这么做——EE 类名出现在 OSS 的 logback/base.xml:21-23 与
cli/BaseCommand.java:45，证明 EE bean 运行期从已并入的 jar 装载）。

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
| ⑥ | `AppRouteRegistry`（REQ-0020 patch）：`@PostConstruct` 全量索引 + BroadcastQueue 订阅增量 | 队列事件驱动的内存索引；重启后重建 |

## 3. EE 交付形态的印证（为什么 ② 是「官方通道」）

EE 与 OSS 同 codebase，以 classpath jar + license key 叠加交付（`[docs]` kestra.io/docs/oss-vs-paid：
"adding a license key to your configuration and restarting Kestra — no code changes required"）。
OSS 源码为 EE 预留的挂接点（@Requires(missingClasses)、桩 bean+@Replaces、Optional 注入——
差异表 §1 S1-S8）只有在「EE jar 已在 classpath」时才被激活——这正是 F1/F2 的直接推论：
**jar 在镜像里、开关在配置里、生效在重启时**。dsh 的 OIDC 豁免（kestra-oidc-provider 以
classpath jar 补 micronaut-security 链）复用的是同一架构事实：OSS webserver 构建里只有
`micronaut-security-csrf`（webserver/build.gradle:25），认证过滤器链本来就靠 jar 带入。

## 4. 对 overlay 的结论与 R-CLASSPATH-MERGE 立案（2026-10-07 使命审查升级）

- 当前已落地通道：**①（5 patch）+ ③（amis 插件 jar→plugins/ 槽）+ ④（部署配置）**；
  通道② 的镜像承载是本仓「EE 同构交付」的**核心缺口**（kestra-oidc-provider 认证链 jar、
  plugin-apps-harness 控制器 jar 都卡在这里，差异表 §1-S6 统一口径），已立案为正式提案
  **R-CLASSPATH-MERGE：实施待指令，实施前下列两问必须闭环**。

**最小面方案（已选型，候选 b）**：build.sh 对**构建产物**做 zip 级后处理，向 executable
jar 的 manifest 注入 `Class-Path: libs/xxx.jar …`，扩展 jar 经 `docker/app/libs/` 暂存
（`COPY docker /` 通道已存在，`docker/app/kestra` 暂存有先例）落 `/app/libs/`；manifest
Class-Path 相对 jar 自身位置（/app/kestra → /app/libs/*）解析，`java -jar` 模式尊重该属性。
**零 patch 文件、不动上游 build 面（settings.gradle/docker-entrypoint 均不触）、不改
Dockerfile。** 2026-10-07 证据级可行性核验：selfrun 末行 `exec java … -jar "$0"`
（gradle/jar/selfrun.sh）；executable 为合法 zip——selfrun 以 `ZipPrefixer.applyPrefixBytesToZip`
作**前缀**字节拼入、不改 zip central directory（build.gradle:626-651）；官方 Dockerfile
`COPY --chown=kestra:kestra docker /`（Dockerfile:9）+ plugins 装载 RUN 块（:11-13）证明
`docker/` 子目录是既有注入通道。

落选记录：(a) fat jar 解包合并（需验证 mergeServiceFiles 等价性，产物不可与上游构建
逐字节对照，侵入最深）；(c) 自定义 entrypoint `-cp`（触碰 build 面，AGENTS.md §2 禁收，最次选）。

**实施步骤（两步，先本地后 CI）**：
1. 本地机制验证（不跑 gradle）：对合成 fat jar（含 bean 索引 service 文件 + selfrun 前缀）
   做 manifest 注入 + `java -jar` 启动冒烟，确认 Class-Path 生效与前缀完整性；
2. CI 端到端：build.sh 注入一个探针 jar（含 `@Context` 生命周期 bean，启动打日志），
   验证启动期 bean 装载（F2 面），并一并闭环 OQ2。

- **OQ2（认知边界，随步骤 2 闭环）**：② 的 jar 与 fat jar 内同包同名类的遮蔽规则
  （classpath 顺序）未实证；出仓 jar 保持 `io.kestra.webserver.*` 同包（差异表 §1-S6
  依据）时需一并验证。

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
