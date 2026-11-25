# 上游升级评估工具与 agent 交接

`scripts/assess-upstream-upgrade.py` 使用 Python 3.9+ 标准库与本机 Git，评估任意本地
目标 tag、ref 或 commit。工具不升级 BASE、不改补丁、不运行构建、不发布产物。
它只读取本仓 `patches/BASE`、`patches/manifest.tsv`、`patches/*/*.patch` 和调用者提供
的本地上游 Git 对象，不读取独立扩展项目。

```bash
python3 scripts/assess-upstream-upgrade.py \
  --upstream /absolute/path/to/local-upstream \
  --target refs/tags/vX.Y.Z \
  --target-commit <expected-40-character-commit> \
  --output "$PWD/.work/upstream-upgrade-tools/assessment-vX.Y.Z"
```

上游仓须预先具备 BASE tag、固定 BASE commit 和目标对象。工具不联网补对象；
缺失即失败。BASE tag 必须精确对应 BASE 第二行。附注标签解析到 peeled commit
（标签最终指向的提交），报告固定其完整提交值。建议用完整 `refs/tags/...`，避免
短名歧义；`--target-commit` 可选，用于核对调用者预期提交。目标不限定为 v2.0.11。

输出目录必须尚不存在，由工具独占创建；不得位于上游工作树。允许在本仓 `.work`
下保存报告。工具拒绝有已跟踪或未跟踪改动的上游工作树，不 reset、不清理、不 stash。
bare 仓无工作树检查。忽略文件不是源码输入，工具不读取它们。调用期间不要修改
输入、移动标签或并发改动上游仓；该工具不提供外部进程之间的仓库锁。

验证对象、BASE 和 manifest 后，工具以完整 `git diff --name-status -z --find-renames`
取得变更清单，保留路径内空格、制表符和换行，以及 rename/copy 两端和删除记录。
结果不限于托管平台 API 的文件数量。rename 识别仍依赖 Git 的相似度判断，未识别时
可能显示为删除与新增，两者均保留。JSON 使用转义保存特殊字符。

工具在系统临时目录创建独立 clone，禁用 hooks，不复用已有验证树，不执行仓库程序。
它按 patch 文件路径字典序执行 `git apply --check` 和 `git apply`。首次失败保留诊断，
后续一律标记 `blocked` 并记录阻塞补丁；这些后继没有执行，不是独立冲突。新增文件
与目标文件碰撞由真实 Git apply 检出。临时 clone 最后自动删除。报告中的 `applied`
只表示该前缀在固定目标树可应用；**clean apply 不等于兼容，也不等于上游已吸收**。

输出包括：

- `assessment.json`：固定提交、BASE/manifest SHA-256、每个 patch 的 SHA-256、完整
  upstream 文件差异、patch 文件路径、与 upstream 的交叠、与前序 patch 的路径交叠、
  顺序依赖风险、重放结果及原始失败诊断。
- `ai-summary.md`：AI 可读摘要、计数、语义未验证声明，以及交接提示词规则。

migration、dependency、public-contract 和 test 风险只根据路径规则分类。路径交叠
表示可能相关，不证明具体 hunk 冲突；无路径交叠不能排除间接 API 或依赖风险。
前序 patch 同文件交叠是依赖线索，不是完整依赖图。工具未判断 migration 是否安全、
接口是否二进制兼容、认证授权语义是否保持，未运行编译、测试、CI 或镜像门。
所有补丁及报告均明确标记 `semantic_validation: NOT_VERIFIED`。

对象缺失、标签不符、输入不合法或输出已存在时退出码为 2；成功生成报告时退出码
为 0，即使重放中有失败。自动化必须检查 `replay_complete` 和各补丁的 `replay`。
clone 或 I/O 异常可能留下本次新建输出目录，应保留现场，重试时使用另一个新目录。
诊断可能包含本地路径；交接报告前按本仓要求核对适用的公开范围。

升级 agent 必须先读本仓 AGENTS.md、README、差异表和机制文档，再按报告的固定提交
调查源码。先修复首个失败，在新的独立树重新顺序重放，再判断后继；不得引用历史
trial-replay 中的后继失败直接定性。新增文件、删除、rename 两端、依赖漂移、公开契约、
migration bean 与 SQL、失败关闭及测试都须逐项核对。已吸收、冲突和业务归属的裁决
需要源码证据，不能由路径统计代替。实施、交付和批准仍按仓库规则和主控授权执行。

真实 Git 测试仓验证命令：

```bash
mkdir -p .work/upstream-upgrade-tools
python3 -m unittest discover -s scripts/tests \
  -p test_assess_upstream_upgrade.py -v \
  > .work/upstream-upgrade-tools/unittest.log 2>&1
```

测试覆盖超过 522 个差异条目、特殊文件名 rename、删除、附注标签、固定提交核对、
缺失对象、dirty source、独占输出、新文件碰撞、成功前缀与后继阻塞、输入清单及风险。
测试通过仅证明评估工具的这些行为，不代表任何上游升级通过。

## 逐补丁裁决与最终审计模板

逐 patch 台账必须完整覆盖报告中的全部补丁，包括未执行的后继。至少记录以下字段：

| 字段 | 必须记录的证据 |
|---|---|
| 输入 | patch 编号、路径、SHA-256、BASE/目标完整提交、需求号、消费方 |
| 重放 | applied/failed/blocked、首个失败诊断、blocked_by、重跑输入及命令 |
| 上游归因 | 触达文件、rename/delete 两端、实现级证据、已吸收或冲突的具体依据 |
| 裁决 | 保留/吸收/冲突待适配/阻塞未裁决、理由、最小改动、负责人、移除条件 |
| 影响 | API/依赖、migration、公开契约及版本、失败关闭、模式 A/B、对应测试 |
| 验证 | 命令、退出码、报告路径、输入与产物哈希、失败/跳过/未运行、未验证项 |

不能把 blocked 填成冲突，不能从可应用直接填成语义通过。任何“吸收”裁决都需要
逐项核对原需求是否仍满足；补丁字节已出现在目标中也不能代替行为检查。

模式 A 指关闭 RBAC 且不装载扩展；模式 B 指启用 RBAC 且装载正式兼容扩展。两种
模式分别检查首装、已有安装、登录、刷新、退出、拒绝与允许操作。模式 B 须验证
扩展实际装载及至少一个允许操作；全部请求拒绝不证明扩展激活。授权拒绝还须核对
数据库、存储和队列没有非预期副作用。候选组合的验证须明确记录候选身份，不能用于
独立插件正式编译或替代正式交付。

已有安装升级前，固定并备份数据库、安装凭据、部署配置、插件 jar/hash 和镜像 digest。
明确哪些迁移不可逆、怎样恢复一致的数据库与凭据、怎样回退配置和镜像；在独立验证
环境实际验证备份恢复，保留命令和结果。新出现的 plugin-auto-install migration 必须
调查执行触发条件、数据库持久化配置、默认值与环境变量的关系、重启行为及自动下载/
安装插件的副作用。部署配置声明 `auto-install.enabled: false` 不能代替迁移实现调查。

交付顺序固定为正式 host → plugin → root：先由宿主完成对应提交的全部 CI 与镜像
推广，记录正式 digest；插件再以该正式宿主为输入独立编译、验证和发布；最后由 root
部署仓固定宿主 digest、插件 hash 与配置，完成组合验收。本工具只评估宿主升级，
不读取插件或 root 部署源码，不触发它们的构建或发布。

最终报告审计至少包含源码提交、tag 对象及 peeled commit、全部 patch 哈希和裁决、
API/依赖/migration 结论、模式 A/B 结果、已有安装备份与恢复证据、全部必需门和其
输入、失败/跳过/未运行、镜像 digest、插件 hash、正式组合验收及剩余限制。前序成功
报告只作历史证据；最终输入变化后须明确哪些门需重跑。未完成发布门必须写明未交付。

## 浅仓输入准备与实际验证

上游工作树即使存在未提交改动，也可由调用者只读取其 Git 对象，准备独立裸仓作为
输入；不要清理原工作树。浅仓对象转移须允许更新新裸仓的 shallow 边界。例如，以下
`fetch` 只写新建的工具专用裸仓：

```bash
git init --bare .work/upstream-upgrade-tools/upstream.git
git -C .work/upstream-upgrade-tools/upstream.git fetch --update-shallow \
  /absolute/path/to/local-upstream refs/tags/vX.Y.Z:refs/tags/vX.Y.Z
```

缺少 BASE tag 时，由调用者向这个新裸仓取得官方精确 tag，并核对 peeled commit
等于 BASE 第二行。不要向原工作树或其他人的验证树 fetch。工具自身只使用本地输入。

实际升级报告保存在调用者指定的忽略目录；长期文档不固定会话路径或把一次评估当作后续版本证据。

## 固定基础镜像与运行环境

源码 BASE 与 `patches/IMAGE_BASE` 是两个独立输入。评估目标 Dockerfile、JRE 版本、
基础 OS、UID/GID、镜像入口与双架构后，明确保留或更换固定 digest。latest 仅可用于
调查，不是交付输入。基础镜像变化要求重新构建和运行相关镜像门。

升级发现固定默认图表发生变化时，先读完整定义和实际数据源，再重算仅限可信定义
的摘要；保持未知/自定义/被改变图表的拒绝断言。上游工具名称、请求参数、DTO 构造
和测试报告格式变化须追踪到真实入口，不能只修改模拟测试而遗漏生产授权适配。
同一测试命令包含多种 reporter 时分别指定输出路径，实际解析上传报告验证格式。

## 首次实践的适配裁决（v2.0.5 → v2.0.11，已发布）

63 个需求补丁保留，部分已被上游覆盖的 hunk 收窄；没有扩大宿主业务范围。

| 影响 | 实现级裁决与验证 |
| --- | --- |
| MCP server/session 键、初始化 ID、owner 与 DELETE | 保留上游三元键、服务器生成 ID、未知或非 owner DELETE404；定制仍约束 subject/client/resource/roles。监听流实例注销与受管理异步释放保留，上游未提供等价生命周期机制。原17及上游新增6项 transport 测试全部进入精确门。 |
| MCP LocalSession | 使用上游包装类型，定制关闭/重连按真实 session 实例比较，不回退旧裸 map；清理不删除新 owner。 |
| YAML inline provider | 上游已修复 dispose 回调名称，不重复替换；保留去除类型旁路、command title 及真实锁定 Monaco 生命周期回归。 |
| 异步 Execution 输出 | 保留上游输出映射与请求线程 tenant 解析；输出读取仍位于授权 supplier 内，不在授权前读取。 |
| usage 时间窗 | 保留上游 days 参数与限制，同时保持现有认证和 tenant 查询边界。 |
| 原生 AI 工具 | 上游 tool 名已改下划线；宿主授权适配和真实 HTTP/工具回归同时更新。保留上游 AgentToolCallScope，并与实际资源授权组合；未知名称失败关闭。 |
| 默认 Flow 卡片 | 上游 recent/next 增加排序且 next 列名变化；核对实际数据源不变后更新可信定义摘要，保持10卡精确匹配、未知/改变定义拒绝。 |
| 测试报告 | 上游增加 JUnit reporter，JSON 使用专用 outputFile.json 防覆盖；新增 follow 测试保留并纳入154项精确门。 |
| 自动安装迁移 | 该迁移已存在于旧 BASE；目标仅把整段服务取得/执行包入异常保护。它读取已有 flow 最新非删除版本；禁用直接返回，失败记录警告且仍登记迁移已执行。独立7项上游迁移测试纳入宿主 local/CI；部署仍须验证已有安装升级与无下载副作用。 |
| 固定基础镜像 | 保留既有 c5115b… OCI index；实际 arm64 运行核对 Ubuntu24.04、Temurin25、UID/GID1000，与目标要求一致。未自动跟随 latest-slim；双架构和最终镜像仍须 CI 核对。 |

宿主 1d50c01 的 CI45407070627 已成功并发布正式镜像。消费扩展及部署验收由其所属仓记录，不从本仓局部测试推断。
逐补丁机器证据、失败记录与源码字节比较保存在本次忽略证据目录；不提交验证树或产物。

## 交付前文档时效性门（必需）

每次升级完成后、最终交付或停止工作前，主控必须执行一次文档收敛。

1. 核对实际 BASE、正式发布提交、成功 CI、镜像 digest 和公开产物。
2. 检查 README 开头、安装命令、Compose 示例、manifest 状态列和机制文档。
   检索旧版本、候选、未发布、移植开发中、待验证；逐项判断，不批量删除历史。
3. 当前使用说明必须指向可获取的正式输入。历史段落必须标明历史及当前状态入口，
   不得让旧候选声明与当前发布声明并列而没有优先关系。
4. 对历史缺陷按目标版本真实行为验收。特定提交包含关系或单文件相同只能作为
   调查输入，不能代替交互复现，也不能据此宣布修复或未修复。
5. 记录检查范围、修正项、保留的历史和未验证事项。按所属仓提交推送，最后由
   部署仓更新 submodule。仅文档修正不冒称重新执行了运行产物验收。

复用任务提示词必须包含以下停工条件：

> 不得在仅测试通过后停止。先逐项核对 README、部署命令、manifest、机制与验收
> 文档的当前状态；清除与实际正式发布证据冲突的旧版本和候选声明，历史明确标识。
> 核对文档引用的正式提交、CI、digest、hash可追溯后，提交推送文档修正；未完成
> 文档时效性门不得宣布升级完整交付。行为缺陷必须复现，不以特定修复代码代替验收。
