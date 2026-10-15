# RBAC 授权评估调查探针

日期：2026-10-15。状态：调查证据；没有生产修复，没有新增已发布契约。
本目录只包含宿主自己的最小 provider 和生命周期模型，不读取真实插件。

## 输入与复现

正式发布输入：

- CI：<https://github.com/ai-specs/kestra-overlay/actions/runs/38686689513>，
  commit `9a8dbdae8e13761e135f0e42ccd5ffe4a9635635`，全部四个 job success，包含 promote。
- 镜像：`ghcr.io/ai-specs/kestra-overlay@sha256:878be36bcb1a2d15266f6c7c05921f77d836136604bd956a5318671c2f34186c`。
  本次重新读取 promote 日志，确认此 digest 推广为正式版本标签和 `9a8dbda`。
- 从该镜像 `/app/kestra` 提取 executable jar，SHA-256：
  `bc4c8645de85a2fe2fa395af5d7b13067c236ef276a33476662f68da49732ec7`。
- 调查时 overlay HEAD：`5e96c02764f9afb87f8f961c4278cee31470b088`。
  从发布 commit 到该 HEAD 的 `patches/` diff 为空。
- 独立源码树：`.work/evaluation-probe/source`。从已核对 BASE 的本地 Git 对象独立克隆，
  checkout `172dd0f3760fb1255d3b22bd1fd07ce31b173fa3`，按顺序应用全部 28 个当前 patch。
  每个 patch 的 hash 和 check/apply 退出码保存在 `source-inputs.json`，均为 0。
  未复制其他验证树的未提交文件，未 reset 其他树，未编译宿主。

运行环境实测为 Darwin，JDK 25.0.4 arm64。下面从 overlay 根目录执行：

```bash
mkdir -p .work/evaluation-probe
docker create --name rbac-evaluation-extract --entrypoint /bin/true \
  ghcr.io/ai-specs/kestra-overlay@sha256:878be36bcb1a2d15266f6c7c05921f77d836136604bd956a5318671c2f34186c
docker cp rbac-evaluation-extract:/app/kestra .work/evaluation-probe/host.jar
docker rm rbac-evaluation-extract
python3 scripts/rbac-evaluation/run.py
```

提取容器已经删除。脚本在本机用 `javac -proc:none` 编译专属探针，再用 `java -cp`
运行，classpath 只有本探针和该发布 jar。不会装载真实插件，不启动业务服务器。
具体 javac/java 命令和每步退出码写入 `.work/evaluation-probe/results.json`。

## 实际结果与覆盖限制

| 检查 | 实际结果 | 退出码 |
|---|---|---|
| 编译专属探针 | 通过 | 0 |
| 复现与固定版本对照 | 4 类混合评估复现，全部探针断言成立 | 0 |
| 完整评估必须版本一致的断言 | AssertionError，保留失败证据 | 1 |
| 独立生命周期模型 | 完成、嵌套、异常、超时、取消均释放 | 0 |
| 独立生命周期故障模型 | 12 类检查，含 100 次并发取消/begin 到达 | 0 |
| run.py 调查调度程序 | 确认上述退出码符合预期 | 0 |

`EvaluationProbe.java` 直接调用发布 jar 的真实 `TypedRestRbacFilter`、
`OssRestOperationAdapter`、`TypedAuthorizationGate`、`RbacGate`、`RbacExecutionGate`、
`McpCapabilityGate` 和 `TypedNamespaceAccessControl`；没有复制或替换这些实现。
provider 只实现已发布 `TypedAuthorizationResolver`，在指定决策后从不可变 A 策略切换
到不可变 B 策略。BeanProvider 和 route metadata 由测试程序提供。

- REST：真实适配器将 `ExecutionController.getLatestExecutions` 的两个 namespace 解析为
  两项完整查询计划。A-only 和 B-only 都返回 403，continuation=0；中途切换返回 200，
  continuation=1，轨迹为 `V1 EXECUTION:LIST:team.a=true`、`V2 ...team.b=true`。
- runtime：A-only 授予 Flow READ/EXECUTE 与 Execution CREATE，B-only 只授予另一个
  namespace 的 KV READ 依赖。两者单独都拒绝；完成第三项后切换，完整 runtime gate
  返回 true，依赖由 B 允许。包含真实 Flow 序列化和最小依赖 resolver。
- MCP：A-only 只允许 Flow READ，B-only 只允许同一 Flow EXECUTE。两者单独拒绝；
  切换时真实 `McpCapabilityGate.execute` 返回 true，scope 同时包含必要的两项能力。
- query：同一请求下 V1 FLOW LIST 范围为 `[team.a]`，V2 EXECUTION LIST 为 `[team.b]`；
  再读 FLOW 命中 V1 缓存，provider 只调用两次。新请求的 FLOW 正确读取 V2 并拒绝。
  这说明缓存固定的是单 resource 的 scope，不能固定整个请求的策略版本。

`reproduction.log` 保存全部调用轨迹；`coherence-expectation.log` 保存安全断言失败。
`released-bytecode.txt` 保存本次运行类的 javap 反汇编；`promotion.log`、`ci.json` 保存发布证据。

本轮是发布二进制的组件级调用链探针。REST 使用合成 route metadata 和 continuation，
没有启动 Netty、调用真实 controller、连接数据库或执行业务副作用。MCP 运行了 execute
子门，完整工具调用链只做源码追踪；query 未执行 SQL。不能据此报告完整 HTTP、MCP 工具、
数据库、两个 JVM 或 Compose 验收通过。continuation=0 只证明本组件未放行后续处理。

## 已核对的宿主调用链与评估边界建议

以下源码路径均相对于 `.work/evaluation-probe/source`，用于宿主适配调查，不是插件 API。

| 边界 | 真实调用链 | 建议所有者和结束点 |
|---|---|---|
| REST 完整请求 | `webserver/.../rbac/TypedRestRbacFilter.java` 的 adapter.resolve → concatMap gate.authorize → all → chain.proceed；实际业务中的 namespace/log/dashboard 查询另行调用 gate | filter 订阅时 begin；边界覆盖完整计划及业务查询，不能在 preflight 返回 true 时就 close；在响应业务 publisher 完成、异常或取消时释放 |
| MCP 单次工具调用 | `webserver/.../mcp/McpToolService.java` buildCallHandler：executableScope → capabilities.execute → trigger.evaluate → outputs(CREATE/ACCESS_OUTPUTS) → runtime flow resolution → preflight(额外依赖) → input validation → runFlowForMcpTask → output lookup | 单次 tools/call 调用所有者；从 executableScope 之前开始，不能只包 execute；输入、依赖和查询共享此评估。不得把句柄存入 MCP session、缓存工具 handler 或全局工具缓存 |
| runtime 实际声明检查 | `ExecutionController.java:1038` 调用 `RbacExecutionGate.authorize`，位于 FlowMetaStores 实际 flow 解析之后、readExecutionInputs/checks/Create command 之前；gate 再调用 dependencies | 必须建立新的完整评估，即使嵌套在已允许 REST/MCP 内也不能复用旧允许结果。检查及本边界关联的输入读取完成后 close，包括异步读取；不得将请求句柄写入 Create command 或队列 |
| 查询与统计 | `TypedNamespaceAccessControl.domain` 按 request+resource 缓存；`TypedDashboardGate` 每次写入同一 resource 缓存键；`AbstractJdbcRepository.aclCondition` 分别读取 namespaceScope 和 excludedNamespaces | 普通 repository 查询加入当前完整评估，不每个查询重新 begin。cache 必须绑定评估身份；嵌套评估不得读外层 request 缓存。Dashboard 的分子/分母和多 datasource 必须共享评估快照，同时保持各自请求域交集，不能互相覆盖 scope |

runtime 的上述 gate 在当前源码只由 REST ExecutionController 直接调用。它不是 worker
运行每个 task 时的通用撤权钩子，不能把候选中的“执行时重新 begin”描述为已实现的队列
运行授权。MCP 当前直接走自己的 execute/outputs/preflight 链。若要求队列真正开始时
重新授权，必须单独明确可信主体来源、worker 激活点与失败关闭语义，再裁定生产范围。

`TypedAuthorizationGate` 每项有 5 秒 timeout，REST/runtime/preflight 外层有 10 秒 timeout。
逐项超时保护提供失败关闭，不提供跨决策版本一致性。

## 现有公开机制与最小建议的比较

| 机制 | 能复用的部分 | 不能解决的部分 |
|---|---|---|
| TypedAuthorizationResolver + 不可变策略原子替换 | 稳定 Operation/Decision、逐项完整读取 | 每项读到完整版本仍可拼接两个版本，探针已复现 |
| QueryDomain 与请求 scope cache | 域求交、SQL 前过滤、同 resource 查询复用 | 缓存键没有评估身份；不能固定 REST/runtime/MCP 的全部决定 |
| AuthorizationInvocationContext / AuthorizationContextExecutors | HTTP 来源和身份；线程池只传播授权来源，避免复制 JDBC 上下文 | 没有策略快照或生命周期；captureHostTask 从 empty context 只加入 origin，新增句柄不会自动传播 |
| 批量 authorize(List) | 可以一次判定静态 REST 计划 | 无法覆盖运行时依赖、后续查询、MCP 分散子门与 KPI 分子/分母 |
| ThreadLocal、subject 全局缓存或插件读取 request 内部 attribute | 无可接受的稳定公开复用方案 | 异步、不同请求、嵌套边界与撤权语义均不可靠；不能让插件依赖宿主内部 HTTP 对象 |
| 可选版本化生命周期 provider | 保留现有 Operation/Decision，新增 begin 与评估对象内 authorize/close | 是候选生产契约，尚未接收；必须补宿主集成与兼容测试后发布 |

最小建议是新增可选的 V1 生命周期能力，具体候选签名和异步语义见下文；没有发布该接口。
provider 返回不透明评估对象，评估对象消费现有 Operation 并返回现有 Decision，结束时 close。
宿主只拥有生命周期，不解释 revision，不提供角色或数据库模型。旧接口保持二进制兼容，静态 provider
维持原模式；部署显式要求一致模式时，缺 provider、多个 provider、版本不符、begin/决策
异常均拒绝，不得退回逐项模式。句柄必须绑定本边界的主体及租户，不能换主体复用。

新边界取得最新可见快照；已开始的边界可以按旧快照完成。新的 runtime 边界独立 begin，
内层结束恢复外层上下文。策略 revision 与多 JVM 快照读取由 provider 保证，不能由宿主
内存句柄宣称跨 JVM 强一致。begin 读取策略时立即结束数据库事务，句柄只保留不可变数据。

## 异步释放方案与模型验证

`LifecycleModel.java` 是专属模型，不修改宿主类，也不是可发布 SPI。使用 Reactor
`usingWhen` 创建句柄，三个清理回调分别处理正常完成、error 和 cancel；不是在组装 Mono
时使用 try/finally。主体函数外加 defer，覆盖同步抛异常。显式传入句柄跨 boundedElastic
线程，结果为 A+B 拒绝，下一边界看到 B。嵌套使用不同句柄，内层结束不关闭外层。
模型实测 8 次 begin、8 次 close；覆盖完成、下一边界、嵌套两层、异步异常、同步异常、
timeout、主动取消和释放后拒绝复用。日志为 `lifecycle-model.log`。

## 补充故障探针与最小接口候选

`LifecycleFaultProbe.java` 是另一个宿主独立模型，不替换已发布 gate，也不实现生产 SPI。
本次亲自运行 `python3 scripts/rbac-evaluation/run.py`，重新编译全部探针并核对发布 jar
的 SHA-256。`run.py` 使用 `os.pathsep` 连接 classpath；安全失败标记和故障模型标记
必须来自本次 subprocess 输出，不能用磁盘上的旧日志作为通过证据。
当前输出及各子进程命令和退出码保存在 `.work/evaluation-probe/results.json` 和对应日志。
输入发布证明仍为上文的历史证据，本次没有重新查询远端 CI 或重新拉取镜像。

故障模型验证以下 12 类检查：主体绑定、tenant 绑定、取消先到、begin 先到、begin 返回
错误主体、begin 返回错误 tenant、异步 close 失败、同步 close 抛异常、close 超时及晚到完成、
begin 失败、begin 返回 null、100 次并发取消/begin 到达。取消先到时保留对原始
CompletionStage 的回调，晚到句柄由同一个所有者释放一次；取消调用不会取消原始 future。
close 故障保留在 released future 和计数中；超时检查不会取消 cleanup 或重新 close。
已关闭或绑定不匹配的句柄拒绝 authorize。该模型没有模拟完整 Principal 的 roles、client、
audience、scopes，也没有接入 Reactor Context；生产必须绑定完整可信 Principal 的不可变副本。
两种确定顺序和并发循环提供竞态证据，不能证明所有线程交错均已穷尽。

以下签名建议可供接收审查，状态为**未接收、未发布**。它只保留异步 begin、authorize、close
三项能力；不新增 revision API、数据库事务、公开宿主上下文、请求对象或插件业务模型：

```java
public interface AuthorizationEvaluationProviderV1 {
    CompletionStage<AuthorizationEvaluationV1> begin(
        RbacAuthorizer.Principal principal, String tenant);
}

public interface AuthorizationEvaluationV1 {
    CompletionStage<TypedAuthorization.Decision> authorize(
        TypedAuthorization.Operation operation);
    CompletionStage<Void> close();
}
```

接口名的 V1 标识生命周期主版本；Operation 自身已有 contractVersion 和 source，
不再增加同义来源枚举。begin 必须在订阅时执行，固定一个不可变策略快照与完整可信身份。
宿主在私有包装器中绑定完整 Principal、规范 tenant 和边界身份；每次使用前验证当前身份
和 Operation.tenant，失配直接拒绝，不调用 provider。嵌套新边界独立 begin，cache 使用
边界身份；对象地址不能充当跨请求、跨进程或持久化身份。provider 不得将句柄交给队列。

begin 同步异常、异步失败、null stage、null handle 均失败关闭。边界取消后不再调用业务
函数；宿主继续观察原始 begin 的完成并释放晚到句柄。provider 必须保证 begin 在约定的
最大时间内完成或失败；无限 pending 的 begin 不是受支持行为。宿主不能凭本地超时宣称
provider 已释放资源。begin 不跨边界持有数据库事务。

close 返回异步结果，不继承 AutoCloseable。宿主单一所有者保证调用一次，在完成、异常、
取消与晚到 begin 路径中统一释放。并行授权必须在释放前结束；close 开始即禁止新决策。
close 的同步异常、异步失败、null stage 和超时必须保留诊断；超时后继续观察原始结果，
不得重试 close 或重用句柄。宿主不能因清理失败把 deny 改为 allow，也不能承诺撤销已发生
副作用；业务失败为主错误，清理失败作为附加诊断。正常路径须等待 close 后才发布最终
成功信号，但流式响应、数据库已提交和队列已入队的副作用仍不能回滚。若不能接受这一
限制，应收窄边界或另立事务需求，不能给 close 增加事务承诺。

### 升级与接收范围

旧 `TypedAuthorizationResolver` 不增加抽象方法，旧模式与关闭功能行为保持兼容。
一致模式必须显式选择；只接受一个 V1 provider，缺失、多个、版本不支持均失败关闭，
不得隐式回退到旧逐项判定。两种模式只能选一个；不能混用新旧 provider 的决定。
旧插件不自动获得快照一致性。新扩展必须等宿主正式发布后，针对发布产物独立编译。
生命周期语义发生破坏性变化时发布 V2；不得原地改变 V1 的取消、绑定或释放语义。
上游升级由 overlay 适配内部调用链，并复测 V1 和旧模式；不要求扩展解析内部路由。
多 JVM 最新可见快照、撤权传播上限属于 provider 和部署保证，不由此接口承诺强一致。

建议的首批生产接收面是 REST 完整请求、该请求内查询/统计以及实际 flow 声明检查的
嵌套边界。它们仍须联合实现，不能只在 preflight 包一层 begin/close 就宣称覆盖后续查询。
真实 MCP 完整 tools/call、等待 execution 后输出、长连接和 worker 队列开始时重新授权
应单独明确边界后接收；本次不建议默认纳入同一个长期句柄。
当前发布 MCP 子门的跨版本问题仍然存在，排除生产接收范围不表示该路径已安全修复。

生产接入仍必须验证：

- Reactor Context 携带评估引用；同步 repository 桥接仅传播必要的评估引用与身份。
  普通后台任务及 queue subscriber 不继承请求句柄；不得整体复制 PropagatedContext。
- 已加入当前请求的并行任务必须有明确所有权及结束屏障，不能在任务仍检查权限时 close。
  脱离请求的任务、延迟任务和队列任务在实际授权入口新建边界。
- 将本次故障模型的晚到 begin、取消与 close 故障断言移入实际宿主集成测试。
  模型通过不能证明生产 usingWhen 或上下文传播已正确实现。
- 长连接不持有会话级句柄。MCP 等待 execution 完成、SSE/follow 的后续输出读取应有明确
  的短期读评估或事件评估；不能把一次 preflight 的允许无限延长。拆分点必须保留完整
  前置计划一致性，并明确输出使用新评估的语义。

生产 patch 仍需主控明确接收。随后必须覆盖真实 Netty、完整 MCP 工具链、repository
查询和统计、嵌套 runtime、异步 begin/close 故障与取消竞态、缺组件、旧静态 provider、
关闭功能回归；发布后再由部署仓执行真实数据库策略修改、两个 JVM 和无拒绝副作用验收。
