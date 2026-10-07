# kestra 扩展机制原理：编译 / 重启 / 外部 jar（调查记录）

> 回答三个根本问题：**改一个架构能力，要不要重新编译？要不要重启？要不要外部 jar？**
> 证据基于 BASE（v2.0.5 @ 172dd0f37）源码 + dsh 项目实证 + kestra.io 文档；复现命令见 §5。
> 与 `docs/oss-ee-gap.md` 的分工：差异表回答「补什么」；本文回答「怎么生效」。

## 0. 结论矩阵（一页答案）

| 通道 | 是什么 | 重新编译 kestra？ | 需要外部 jar？ | 需要重启？ | 生效时机 | 本仓/扩展仓对应 |
|---|---|---|---|---|---|---|
| ① 源码 patch | 改上游源码（webserver M 面） | **要**（overlay CI 重编 executableJar + 重建镜像） | 否 | **要**（镜像重建+容器重启） | 构建期 | 本仓 5 个 patch |
| ② classpath 合并 jar | 扩展 jar 与 fat jar 同 classpath（bean 进 Micronaut 上下文） | **否**（扩展仓独立编译，micronaut 注解处理产 bean 索引） | **要**（官方镜像**无** libs 约定，须构建期并入 fat jar 或注入 manifest Class-Path——**待实证**，见 §4-OQ1） | **要**（bean 发现在启动期，F2） | 启动期 | plugin-apps-harness（阶段二）、kestra-oidc-provider（独立进程形态） |
| ③ plugins/ 插件 jar | `KESTRA_PLUGINS_PATH` 目录（默认 /app/plugins） | 否 | 要（jar 放目录/经 API 装） | **分形态**：auto-install 开启（OSS+local 存储**默认开**，dsh 栈即此形态）→ **否**（API 安装即时注册）；关闭形态 → 要（重启扫描） | 启动期；auto-install 开启时即时 | plugin-apps-amis（build-extensions.sh 注入） |
| ④ 部署配置 | yml/env（`KESTRA_CONFIGURATION`→`MICRONAUT_CONFIG_FILES`）：micronaut.security.enabled、intercept-url-map 等 | 否 | 否 | **要**（@Value/配置绑定在 bean 创建期） | 启动期 | kestra-oidc-provider 部署面（最小端点门） |
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
（dsh 试点实证：无索引则 bean 不可见 `[dsh]`）。EE 的官方激活话术「license key 写进配置、
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

## 2. 各通道证据细则

| # | 关键证据（BASE file:line） | 限制/边界 |
|---|---|---|
| ① | `build.gradle:626-651`（writeExecutableJar=shadowJar+selfrun 前缀）；overlay `scripts/build.sh`（patch→executableJar→镜像） | 每 patch 一行都是升级成本（AGENTS.md §3 质量法的动因） |
| ② | `gradle/jar/selfrun.sh` 末行 `-jar "$0"`；`Dockerfile:9-11`；EE 痕迹 logback/base.xml:21-23、BaseCommand.java:45；dsh 试点 13/13 `[dsh]` | jar 进镜像机制待实证（OQ1）；与 fat jar 内依赖冲突需排查（同包同名类遮蔽） |
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

## 4. 对 overlay 的结论与开放问题（OQ，实施前必须闭环）

- 当前阶段一全部落在 **①（5 patch）+ ③（amis 插件 jar→plugins/ 槽）+ ④（部署配置）**，
  不涉及 ② 的镜像集成机制。
- **OQ1（阶段二前置）**：S5 jar（Dsh* 控制器）进官方镜像的机制——候选：(a) overlay 构建期把
  扩展 jar 合并进 shadow fat jar（解包重打包，需验证 mergeServiceFiles 等价性）；
  (b) 向 fat jar manifest 注入 `Class-Path: libs/xxx.jar`（`java -jar` 尊重该属性，zip 级小改）；
  (c) 自定义 entrypoint 以 `-cp` 启动（触碰 build 面，受 AGENTS.md §2 禁收约束，最次选）。
  **登记 reserved `R-CLASSPATH-MERGE`**：plugin-apps-harness 实施时先实证再定。
- **OQ2（认知边界）**：② 的 jar 与 fat jar 内同包同名类的遮蔽规则（classpath 顺序）未实证；
  出仓 jar 保持 `io.kestra.webserver.*` 同包（差异表 §1-S6 依据）时需一并验证。

## 5. 复现命令（BASE 树内执行）

```bash
git show "$(sed -n 2p patches/BASE):gradle/jar/selfrun.sh"          # F1：-jar "$0"、KESTRA_PLUGINS_PATH、KESTRA_CONFIGURATION
git show "$(sed -n 2p patches/BASE):Dockerfile"                     # F1：唯一注入点 plugins/
git grep -n "registerBean\|DynamicBean" -- '*.java' | grep -v test  # F2：空=无运行期 bean 注册
git grep -n "micronaut\|ApplicationContext" -- 'core/src/main/java/io/kestra/core/plugins/DefaultPluginRegistry.java' 'core/src/main/java/io/kestra/core/plugins/PluginScanner.java'  # F3：空=插件不走 Micronaut
sed -n '150,170p' webserver/src/main/java/io/kestra/webserver/controllers/api/PluginController.java  # ③：安装端点+门控
```

升级 BASE 后本文与差异表一并复扫（AGENTS.md §6 步骤 3）。
