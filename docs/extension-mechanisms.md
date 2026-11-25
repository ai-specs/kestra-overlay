## v2.0.13 源码升级状态

当前源码固定 `61da533e0754fcdd6c69cc2ae598dc9e72a0ccfe`，公开契约仍由现有
63 个需求补丁提供。上游新增 tenant 路由守卫、AI 可用性守卫和工具结果预算与宿主
认证、扩展菜单和工具授权并存；结果预算不能替代授权，授权通过也不能绕过结果预算。
源码升级不新增扩展业务模型或跨仓构建依赖。基础镜像独立固定于 `patches/IMAGE_BASE`。
正式使用必须核对最终提交成功 CI 的报告、推广镜像及公开产物；本节不是发布声明。
下方按日期保留的候选与旧 BASE 调查是历史证据，不覆盖当前发布入口和契约说明。

## 2026-11-24 升级状态与历史记录说明

v2.0.5 的正式宿主基线为 `434955d`，CI `45104521508` 已成功并发布；下方各日期
记录中的未发布状态是当时记录。当前源码升级到 v2.0.11，仍为未发布候选。
公开契约所有权不变；升级不得把扩展业务或其内部 API 移入宿主。升级裁决与可复用
流程见 [上游升级规则](upstream-upgrade-agent.md)，最终发布状态以对应提交 CI 为准。

# kestra 扩展机制原理：编译 / 重启 / 外部 jar（调查记录）

## REQ-0407 MCP 后台刷新上下文隔离（2026-11-23，候选未发布）

Micronaut ConnectionOperations 通过 PropagatedContext 携带 ConnectionStatus，
Reactor subscribeOn 不提供事务隔离。真实 H2 复现确认调用方与后台是同一 Connection。
0407 候选在 refreshTools 发布与订阅边界显式采用空上下文，保留 tenant/server 参数、
原异步调度、错误信号和关闭机制，不继承队列事务、请求或授权 evaluation。
工具调用可信身份路径不变。0170 原 refresh 调度块迁入0407，避免两个补丁共享来源行。
六项真实 H2 安全回归与既有十五项 MCP 回归通过；完整原localCI退出0，后端631项
零失败/错误、2项镜像专用跳过不计通过，core3与UI153通过。本机候选classpath、
OIDC35、MCP4、form/env、原生列表21/详情37、geometry64与SDK949通过，零失败/跳过/未运行。
正式CI、发布和生产组合未执行。原完整门后端XML未及时封存，随后单独实际后端重测
的134份XML不能冒称原完整门报告。失败证据、报告来源与责任见 `r-ee-rbac.md` REQ-0407。

## namespace 补集与特殊功能分类（2026-11-18，本地门通过，未正式发布）

0401/0402候选已通过本地完整localCI、classpath、OIDC35、MCP、form/env（各含
dependency503七项）、SDK949及geometry64。后端597项为595通过和2项原镜像专项
assume；core3、UI130通过。SDK949唯一具名ID、零失败/未运行和输入hash已核对。
58补丁重放与dev的391个触达文件一致，正式CI、发布及真实插件组合仍待执行。
V2不兼容旧插件二进制，必须重新编译和验证；普通bulk/import等未适配操作仍拒绝，
不能计为正常功能已支持。独立特殊功能标识留待后续裁决，本批没有新增泛FEATURE。

本节记录宿主机制与候选验证，完整裁决与独立测试见
[R-EE-RBAC](r-ee-rbac.md#2026-11-18-namespace-补集与未解析操作收窄提案)。
它取代本文历史未知控制器 SYSTEM 门可作为授权兜底的建议，不声称现有代码已改变。
正式输入 `sha256:dd40ed1149ac322fa175055481100e70d01c345c11d67eabc4f5ee2f5e28379b`
的 resolver 对未知非扩展 controller 和 Flow 未识别 handler 生成相同 SYSTEM.EXECUTE，
没有功能标识；现有 QueryDomain 排除仅按精确名称匹配。可对正式产物使用 `javap -c -p`
检查 OssRestOperationAdapter、TypedAuthorization$QueryDomain 与其 ResourceDomain。

最小演进沿用 typed gate、评估生命周期、namespace/log ACL 与实际 repository 激活点。
版本化域以 DNF term 并集保存，每项独立关联 namespace 包含域、精确/子树排除域与 IDs；
并集不得跨项合并 exclusions。交集逐项笛卡尔配对，包含求交、排除求并、IDs 求交，
超过公开复杂度上限则在业务执行前拒绝。namespace GLOBAL 仅为当前 tenant 内具体
namespace 宇宙，不含 null，也不是 TENANT 资源；TENANT 不能携带 namespace 选择器。
宿主只接结构化域，不解析感叹号语法。补集是该项的允许范围，不是全局 deny，独立正向
项继续有效。SQL 以 OR 连接 term，每项包含、排除、IDs 同时约束，tenant 强制约束所有项。
所有查询、统计、分页和单资源授权必须保留相关性，不支持的域明确拒绝。

未知操作不得再产生可授予的 SYSTEM 兜底；批量/导入先解析全部实际资源再执行完整授权。
真正与 tenant/namespace 数据范围无关的特殊功能使用显式稳定 featureId/action，走
可信身份和评估边界，逐项登记与授权，未知标识拒绝。普通数据子操作仍单独授权，不能
通过特殊功能许可扩大范围。旧 V1 精确排除不改变含义；新域须显式版本兼容检查，不能
丢弃字段降级。宿主独立 provider/SQL/log/HTTP 探针先通过并发布，扩展后消费；真实双账号
登录、保存与拒绝副作用由部署仓验证。本次仅文档提案，不运行或替代上述门。

## 原生 AI provider 固定租户授权适配（2026-11-17，REQ-0400，未发布）

[src] 固定 BASE 的 AiController 路由为 `/api/v1/main/ai`，getProviders 没有 tenant
路径变量。原 OssRestOperationAdapter 在控制器分派前拒绝缺少 tenant 的请求；手工
添加 main 变量又会落到 SYSTEM 行政兜底。0400 在这两处之前精确检查完整控制器名、
getProviders、GET、规范 `/api/v1/main/ai/providers` 和不存在或为 main 的 tenant 变量，
生成 REST / AI.READ / main / SINGLE / READ_ONLY；namespace 和 resourceId 均为空。
其余 AiController 请求直接返回空计划，包括旧 generateFlow，不增加行政绕过。
TypedRestRbacFilter 沿用既有真实 HTTP 主体、短评估及失败关闭。关闭 RBAC 的模式 A
不进入此授权分支。provider DTO 仍由上游生成，仅有 id/displayName/isDefault；插件
只消费原有公开 Operation，不解析控制器或路由。上游升级须重新核对此精确路由。

本地红例同时证明缺少计划、未知入口行政兜底和真实 HTTP 403；新增两项解析、三项
模式 B HTTP、一项模式 A HTTP，检查脚本分别要求 2/3/1 且零失败、错误或跳过。
定向 93 项全绿，完整 local-ci 后端 584 通过加 2 镜像专用跳过、core 3、UI 130
通过；镜像门、几何 64、首装 21、恢复 4 和原 SDK949 完整重跑通过，首轮休眠中断
失败保留，详见能力文档。正式 CI、镜像发布及部署组合
仍待执行，不以此候选作为独立插件的正式编译输入。详见 r-ee-rbac.md REQ-0400。

## 本地 OIDC 认证回退边界（2026-11-04，候选未发布）

Micronaut Security 4.15.2在JWT验证失败后使用userinfo远程验证同一token；内置issuer
的userinfo也经过同一SecurityFilter，未知kid时可递归而非返回拒绝。0131本地元数据
适配移除框架消费的userinfo endpoint，保留JWKS签名及claim验证。公开discovery、
userinfo端点和外部issuer发现不变，不根据空JWKS推断安装状态。原setup服务继续
核对数据库与独立凭据，失配失败关闭。定向红绿与剩余门见r-oidc-server.md本轮记录。

## 原生popup reference归属修复（2026-10-31，已接收，未发布）

0384的window mouseup capture必须识别当前popup真实reference，而不只识别portal内
弹层节点。否则reference会先被outside处理关闭，再被原生click重新打开。修复只允许
本ShadowRoot内、与当前注册popup精确关联的reference；不同根、不同实例、失效引用
和普通外部点击保持原关闭语义。优先使用公开组件实际ARIA/reference关联，不给插件
暴露私有序号或要求插件修改vendor DOM。完整行为证据、边界和发布门见r-ee-rbac。

## 授权初始化阻塞隔离（2026-10-30，已在48946d6独立发布）

可信身份复查可能执行JDBC安全锁，不能在Netty事件循环同步运行。既有0330 boundary
须用受控阻塞执行机制隔离初始化，仅传必要AuthorizationInvocationContext等来源，
不把连接/事务传播给长生命周期任务；保持当前身份、锁后复查、403/503及恰好一次释放。
候选0330先建立owner，再由`Schedulers.boundedElastic()`执行可信身份读取与begin。
来源优先从Reactor Context提取，否则取当前线程同类元素；从空上下文构造，仅含
`AuthorizationInvocationContext`。取消可独立于阻塞begin完成；初始化已取消时不进入
begin，已返回或晚到的句柄仍由原owner恰好关闭一次。不复制JDBC/事务或外层评估。
2026-10-30主控另明确接收同一生命周期内的关闭工厂隔离：SPI仅返回CompletionStage，
没有非阻塞工厂承诺。仅closeOnce同步标记唯一closing，实际close在有界阻塞池、空
上下文执行，保留released、失败、超时及恰好一次。请求/JDBC/旧owner上下文不传播。
取消与晚到handle的单eventloop红2/绿2已实证；精确新增门为初始化10项、关闭2项，
原生命周期16项保留，合并28项通过。资源释放与此附加面接收是两条独立授权记录。
实际线程栈、最小面和回归门见r-ee-rbac同名节。最终完整local-ci为407项，405通过、
失败/错误0、2项既有镜像前置跳过，精确新增12项全执行；UI95、46补丁重放及335文件
一致、executable通过。classpath、OIDC35及MCP四份专项各1项零跳过通过，生产UI
两模式通过，SDK949/几何60门通过。公开SPI类型兼容；正式48946d6/CI41007119467
已发布并核实际报告、镜像及双架构产物，版本与限制见r-ee-rbac对应节。后续提交仍须
自身成功CI及推广，不以历史成功代替；外部插件与部署组合另验。

## 普通授权依赖故障传播（2026-10-28，已接收，未发布）

认证身份复查及评估provider位于业务Controller前；故障分类必须跨该边界传播。
TrustedIdentityV2新增default currentForAuthorization委派旧current，宿主覆盖精确
依赖分类，V1普通验证与V2借用连接契约保持。公开AuthorizationUnavailableException
只由受控依赖或provider明确报告，typed链精确保留并返回安全503 ProblemDetail。
未知异常/未知路由及独立授权provider缺失重复保持原403失败关闭，不按消息猜测。
插件目录/策略依赖不唯一503与独立授权provider原门不得混淆；细节与独立门见r-oidc-server。
当前本地395项与实际签名cookie的投影故障503/恢复200通过；未改变生命周期filter，
不以假设顺序扩大绕过。发布和真实插件消费仍按对应提交CI、正式镜像推广及组合门执行。

## V2 借用连接身份拒绝分类（2026-10-28，已接收，未发布）

消费扩展生产互删204+503暴露锁后身份失效被折叠为依赖不可用。V2借用连接复查使用
已有生命周期Rejected分类：当前actor缺失/停用、认证版本或可信claim/授予失效为
FORBIDDEN；SQL、投影异常/损坏和缺失/重复组件为UNAVAILABLE。普通V1验证仍使用
原IllegalStateException契约。生命周期分派保留明确类别，不按异常消息猜测，不把
未知RuntimeException伪装安全拒绝。借用连接只锁定/读取，不自行结束事务。
确定性PostgreSQL屏障必须核对真实锁等待，再提交四种失效并验证失败方无写入；真实
插件业务不进入宿主CI。提案及正式消费门见r-oidc-server.md对应节。
最终本地完整门385项与新镜像两种首装V2锁后复查各24项通过，输入审计覆盖21个
触达源码；SDK/UI输入不变。对应提交CI、正式镜像推广与部署组合仍须独立验收。

## 精确 favicon 静态资源激活（2026-10-28，已接收，未发布）

`kestra-plugin-rbac` 的正式组合在 RBAC/typed 开启时匿名图标 401；Micronaut 的
`isAnonymous()` 只通过认证层，不能覆盖独立授权过滤器。规范 `/favicon.ico` GET/HEAD
只有在没有方法路由覆盖、实际 `StaticResourceResolver` 解析到宿主已打包
`root/favicon.ico` 时才使用公开静态资源例外。错误/缺失映射、编码/穿越路径和写方法
仍失败关闭，不通配放行无方法路由。三个过滤器共享该解析判定，失效会话也可读公开
图标，业务 API 的认证和授权不变。无需新增插件 SPI、SDK 或业务策略。

新增 0385 补丁；最小提案、风险和红绿/镜像/生产页面验证要求见
`r-oidc-server.md` 的匿名 favicon 节。GET 检查真实图标内容与 MIME；HEAD 检查 200
空体，并在框架提供 MIME 时核对与 GET 一致，不把本次激活修复扩大为静态响应头重写。
本地完整local-ci与新镜像两种首装已通过，失败与来源审计保留在自有`.work/favicon-final/`；
最终对应提交CI、正式发布及部署组合仍未执行，不得将此节当作已发布能力。

## 公开账号空资料（2026-10-28，仅对应提交 CI 与正式镜像推广成功后可消费）

消费插件清空资料的真实管理请求在宿主目录返回 INVALID。修复复用0350的资料更新与
0381的V2临时创建：姓名/邮箱专用校验将合法缺省/空值规范为空字符串，保留256字符、
控制字符和非空首尾空白边界。V1 create的默认资料保持原样；V2不编造人类资料。
不改subject、凭据、认证版本、角色、参与者或组业务。邮箱清空清除verified，CAS与
事务保持。本地PG及完整构建已通过：后端368项中366通过、2项镜像专用前置跳过，
UI87项通过；新镜像classpath、OIDC35及四份MCP专项通过。form/env各通过目录22、
扩展7、主题26、语言52、首次改密215、RBAC改密14及独立空资料26项；不重复累加。
真实红测及Accept探针失败保留。仅Java反射类型门，不声称插件HTTP错误类型已验收。
公开边界、条件式发布与部署仓尚须执行的组合门见r-oidc-server.md空资料节。
测试PG可用KESTRA_TEST_PG_VOLUME显式指定本次owner命名卷，调用方负责创建与精确清理。

## 首次改密协议激活修复（2026-10-28）

消费项目 `kestra-plugin-rbac` 的正式组合在临时密码登录 303 后收到改密 GET 401。
原因是 0230 的精确协议分类遗漏实际改密控制器，0260 在普通主体为空前复用该分类。
修复只将 `OidcPasswordChangeController` 的精确 `/oidc/password` GET/page、POST/submit
交回自身受限交互校验；其他 controller/handler、方法及路径变体仍失败关闭。
不新增授权 SPI 或生命周期例外，不承载组业务，不改变 SDK 输入。该源码修复必须重新
构建 overlay 镜像并重启 JVM；本地绿测不能代替发布与部署组合验收。
失败证据、接收依据、兼容及必需门见 `r-oidc-server.md` 的首次改密 RBAC 激活点节。
完整 local-ci 和恢复环境后构建的新镜像门已通过，含两种首装各 14 项 RBAC 改密检查。
旧 Docker 只读失败保留为历史记录，不计通过。正式消费以该提交全部 CI 与推广成功为
条件，不以本地门或旧镜像替代；部署仓仍须验证真实业务组合。

## 0384 原生组件隔离与导航接线

公开元数据与内置README在2f2984a同步，补丁13文件、b57b59a8，含四项既有sdk.spec
新增一致性断言；helper/runtime与04dc980逐文件一致。overlayCompatibility声明仅四个
经公开helper使用的原生组件，raw overlays/popover/未列复杂下拉/KsPagination仍拒绝。
元数据/说明本身必须作为新构建与完整矩阵输入，不能沿用旧69e11808的executable/hash。

正式64c4498保持44协议契约；0384另提供独立SDK原生组件隔离，helper来源04dc980。
只适配公开原生组件的ShadowRoot portal/popover/focus/ESC，不复制业务，不改原主题或
关闭动画。生命周期保留V1，增加冻结query/fullPath与可选异步导航确认，安全abort清理。
独立probe与CI调用同一949模块，包含sdk-theme稳定终态等待与13behavior，不删矩阵。
历史11文件输入69e11808/build02d12978的完整local-ci、真实镜像门及双工具同949已
通过；后续公开元数据修订必须按新hash重验。公开支持边界由打包SDK声明，消费必须
选择对应提交CI和推广均成功的正式镜像，不将历史本地成功写成新输入已发布。

协议44补丁已随64c4498通过CI40523539018并推广bebf7a7c...177a22e镜像。该发布不含
后续UI SDK扩容，不证明插件业务或部署组合交付。下方历史候选记录只描述其指定阶段，
不得覆盖该正式协议状态；消费方仍须取得包含目标契约且通过发布门的对应镜像。

## REQ-0383 资源 audience 版本门（64c4498已发布）

`ApplicationGroupProtocolProjectionV2` 复用唯一 classpath provider 发现槽和同一事务连接，
不新建组表。V2 的 `currentResources` 返回可为空的精确 resourceAudiences；V1 `current`
在 V2 实现中明确拒绝，不通过补 clientId 伪造 V1 投影。已有 V1 provider 及 DTO 语义不变。
宿主内部只读适配统一签发、预览、code绑定、refresh与在线身份检查；V2 ID/UI 和普通
无 resource access 精确 clientId，有 resource access/MCP 精确当前 resource。空集不授权资源。

V2 claim 签名 audience_contract_version=2，code/refresh 用 v2 前缀绑定组与 epoch，
带资源 access 另签名精确 resource。V1/V2 provider 切换拒绝旧组凭据，重新生产登录；
不改变 issuer、组、epoch或协议 scope，不因当前资源扩张升级旧 code/refresh。
consent 提交在同一安全锁事务中、标准身份行锁前复查资源；撤销时交互和 code/token
写入全部回滚。版本化公开使用与安全矩阵见 `r-oidc-server.md` REQ-0383；定向门不替代
完整 local-ci、正式 CI、镜像发布和部署仓浏览器组合门。

## 账号与凭据接线（64c4498已发布）

REQ-0380–0382 复用已有 PostgreSQL 事务级安全锁和 classpath 唯一 provider。宿主拥有
事务，参与者借用连接，不 commit/rollback/close，不自开第二连接检查；READ_COMMITTED，
安全锁→扩展目录→扩展策略→标准身份行。`TrustedIdentityV2.current(Connection)` 候选
用于避免 V1 在已持锁回调内另开连接等待同一锁。账号删除的扩展清理属于插件业务。

临时密码受限交互不能升级为业务会话；普通 secret 在运行时事务原子轮换。配置登录
client 只能在部署维护窗口停止 JVM、同步配置后用通用 CLI 激活；prepare 不影响旧登录，
失败可受限回退，真实登录确认后清回退材料，不长期接受双值。两者均不要求插件构建
读取宿主源码。提案、DTO、失败语义及必需测试见 `r-oidc-server.md` REQ-0380–0382；
当前仅授权实施，尚无本地门/CI/镜像发布证据。R24/R25 为维护者可复核的主控设计。

> **职责纠正优先（2026-10-21）**：前序把应用组目录、CRUD、内置/退役和组表放在宿主的候选被替代；这些业务迁回插件。本仓只保留标准 OIDC、版本化只读投影与必要激活点，不保留旧写目录转发。下方各候选重放/编译/探针数字只描述原版本，不证明最新职责落实。接收方向、最小机制缺口和测试顺序见 `docs/r-oidc-server.md` 的职责纠正提案。

2026-10-22 当前：账号/client生命周期已通过同连接guard接线，旧宿主组API、业务实现、组CLI与组表迁移已移除。pending登记查询与consent只读预览已经补齐，绑定、签发和refresh保持严格有效client检查。40补丁重放、57份相关主源码、源码职责门及58项进程内检查通过；20项PostgreSQL仅源码编译。构建增加实际executable边界门，旧缓存产物实际被拒绝；完整数据库、网络HTTP/浏览器与发布未通过。具体阶段边界和证据以职责纠正提案当前状态为准，后文旧记录不得作为交付证明。

`0370` 已加入只读投影、事务内标准协议状态查询与生命周期 guard 候选。标准查询通过调用方连接读取本仓 OIDC 状态，统一安全锁不建立组业务表。42补丁重放、65份相关主源码编译及新增11项进程内探针通过；旧业务目录移除和调用点激活未完成。正式构建已接入职责边界门，当前候选明确被拒绝，不能用于插件编译或部署。具体 API、锁顺序、探针限制与证据见同一职责纠正提案。

2026-10-22：签发、refresh 和可信身份读取已改为目标化只读投影及同连接标准身份检查，不再调用宿主组业务目录或首方成员标志。权限元数据仅用于 consent 展示，不能另作授权上限。授权码/refresh 绑定防止旧凭据跨组/epoch使用或在 provider 恢复后自动提权。相关25项进程内探针通过，PostgreSQL12项已适配并完成源码编译、未执行。账号/client生命周期与旧组类/表仍使发布职责门失败；详见 `docs/r-oidc-server.md` 的只读接线记录。

> **签发公开方法与运行探针（2026-10-21，候选未发布）**：授权码绑定及 claim/audience 辅助方法统一应用组命名；旧方法无别名。最新 token-contract-replay 重放 41 补丁、编译 60 份主源码及纯契约 16 项通过，另可信身份/V2/MCP 异步撤权进程内探针 13 项通过。数据库及真实 HTTP 未执行；完整 Gradle 仍受本机 socket 权限阻断。发布检查器已同步新类名；静态计数不作为执行证据。详见 `docs/r-oidc-server.md` 的签发契约清理后续。

> **组 ID 生命周期（2026-10-21，候选未发布）**：为防止删除后同 ID 新组版本重置而重新匹配旧凭据，组删除在同一目录写锁和事务中登记退役 ID；创建同时检查现存及退役 ID，均不得复用。内置组及被拒删除不写退役记录。候选重放、60 份源码编译与 16 项纯契约检查通过；真实 PostgreSQL/并发测试仅源码编译，尚未运行。正式发布门仍未通过，详见 `docs/r-oidc-server.md` 的删除安全补充裁决。

> **应用组命名候选（2026-10-21，未发布）**：目录 `ApplicationGroup`、可信 `applicationGroupId/applicationGroupScopes`、scope `key/name/description`、快照和安装计划的应用组字段及 `oidc_application_group_*` 表已统一进入候选补丁；旧字段不加别名。固定 BASE 的 41 补丁重放、60 份主源码编译及 16 项纯契约测试通过；数据库及完整 CI 未运行。具体破坏性边界、源码树与证据见 `docs/r-oidc-server.md` 的宿主命名候选更新，不能供插件正式编译。

> **内置应用组约束（REQ-0360/0363，候选未发布，2026-10-21）**：安装计划显式提供不可推断的内置组 ID，审批 hash 绑定该值，激活事务保存非空外键；内置 ID 只读且删除拒绝。非内置组只允许按精确修订删除无引用空组。41 个补丁从固定 BASE 顺序重放、结构检查、相关源码编译与计划测试 4 项通过；PostgreSQL 持久化/删除探针、并发与正式 CI 尚未运行。最小契约及证据见 `docs/r-oidc-server.md` 的内置约束补充裁决，不作为当前插件编译输入。

> **系统主题监听（REQ-0369，已接收、未发布）**：全局主题生命周期监听系统媒体变化，
> 只在 syncWithSystem 偏好下调用既有 switchTheme，并在卸载时清理。扩展继续消费
> 宿主解析主题，不维护第二套偏好。真实失败与验证见 [R-EE-RBAC](r-ee-rbac.md)。

> **条件扩展壳层（REQ-0368，已接收、未发布）**：认证 manifest 由控制器逐 descriptor
> 检查 EXTENSION.READ，不以前置 METADATA 检查阻断发现。路由和模块装载重新核对描述与
> capability；只有目标获准且业务 configs 返回 403 时使用独立壳层。获准 configs 的页面
> 保留完整宿主布局；返回普通页面仍执行原配置门。App 不为独立壳层补载业务资源，拒绝页
> 提供通用的获准扩展链接。该机制不识别 RBAC 项目恢复模型、不新增 Java SPI，不放宽
> 业务 API 或静态匿名范围。失败证据和检查边界见 [R-EE-RBAC](r-ee-rbac.md)。

> **MCP 异步来源修复（2026-10-18，已接收、未发布）**：0170 在同次工具调用的
> publisher 中显式传播既有 `AuthorizationInvocationContext`，以恢复执行等待后的可信
> HTTP 来源。传播从空上下文构造，不携带 JDBC 事务或旧授权评估，不保存到队列或
> session。输出读取开启新评估并重新核对账号及项目撤权版本。0366 提供宿主独立
> 跨线程允许、撤权和失败关闭探针。机制不新增公开 SPI；正式消费仍须等待本次镜像
> 通过完整发布门。失败证据和验收边界见 [R-EE-RBAC](r-ee-rbac.md)。

> **OAuth 错误回调（2026-10-18，已接收、未发布）**：0367 使用内部专用错误控制器
> 处理框架授权错误，复用公开 state 存储与验证机制，匹配发起授权时绑定的 callback，
> 返回固定同源失败页并仅清除临时 state cookie。不得从错误描述构造跳转地址，不清除
> 已有合法认证会话。六项宿主检查与部署仓真实协议检查分别执行，见
> [R-OIDC-SERVER](r-oidc-server.md)。此修复不新增扩展 SPI 或运行数据模型。

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

### 应用项目身份机制（已接收，候选实现边界）

> 新应用组目标已替代本节旧 project 契约。`0361458` 已发布 scope 名称、声明只读 SPI 与新签名 claim 的部分机制，但 `ApplicationDirectoryV1` 和 `TrustedIdentityV1` 仍保留旧项目字段、应用组级意图与恢复联锁。完整目标与拒绝规则见 `docs/r-oidc-server.md`“应用组签发与目录契约重构提案”。本节保留旧源码事实供差异调查，不作为新模型的实现规范。
> 旧 `resourceIntents/managementIntents` 与全组目录修订恢复仍须移除。事务内的应用组管理授权缺口见 `docs/r-oidc-server.md`“应用组管理授权边界提案”；主控已接收最小机制需求，但接口尚未实施或发布，不能作为当前插件编译输入。
> 缺声明组件时的首方标准 OIDC 登录失败已由部署仓组合证据复现；收窄后的零应用组 scope 签发机制见 `docs/r-oidc-server.md`“缺声明组件的首方协议登录”。该修复仍须正式发布和缺插件组合复测。
> 移除组级资源/管理意图的下一项候选仅在独立验证树通过宿主定向测试；插件尚未从旧上界切换，不能把候选 patch 当成已发布应用组语义。消费顺序和测试门见 `docs/r-oidc-server.md`“应用组管理授权边界提案”。

`ApplicationDirectoryV1`、`TrustedIdentityV1` 和 `AuthorizationEvaluationProviderV2` 是版本化 classpath 公开契约。`ApplicationDirectoryV1` 只提供项目、scope、成员 client、subject assignment、revision/epoch 和显式三域管理意图；不提供插件 grants、业务页面或名称推断。`TrustedIdentityV1` 只返回宿主验证后的 issuer、subject、client、精确 audiences、tenant、project、protocolScopes、projectScopes、authenticationVersion、authorizationVersion 和 directoryRevision。

开关 `kestra.rbac.application-projects.enabled` 必须同时要求 `kestra.rbac.enabled`、`kestra.rbac.typed.enabled` 和 `kestra.rbac.evaluation.enabled`，且 provider 必须是唯一 V2；缺失、多实例、异常、超时、版本不符失败关闭，不得回退 V1、roles 或 subject。

MCP tools/list 与 tools/call 都按当前请求 token 重新验证身份、项目 epoch、resource audience 和 scope；不得复用 initialize/session 缓存。实际生产 `TypedAuthorization.QueryDomain.resourceDomains` 必须保持 namespace×resourceId 关联，并在分页、total、统计和聚合前编译到 repository 查询。详情/写使用同一完整域；不支持受限 ID 列表时明确拒绝。


未发布的独立 `QueryDomainV2` DTO 没有生产消费者，已裁决删除；不作为公开契约或
插件编译输入。关联域采用既有 `TypedAuthorization.QueryDomain` 的兼容扩展：
每项显式携带 NAMESPACE/TENANT 与 ALL_IDS/RESTRICTED_IDS，经求交、查询上下文及
JDBC 消费保持完整。不得把 namespace 与 ID 分别并集后形成笛卡尔积，也不得在中间
转换时丢弃两个范围枚举。空的受限 ID 域必须拒绝，不解释为全部 ID。最终发布前必须
验证实际 SQL、分页/total/聚合与 tenant MCP 配置查询，DTO 测试不是查询消费证据。

本地管理显式目标项目和完整恢复入口的边界见 `docs/r-ee-rbac.md` 末节。
宿主只提供同 scope 管理意图的精确目标上界；本地绑定、恢复页面、完整候选审核和
原子策略保存归消费插件，宿主不保存本地 grants。


候选 `TrustedIdentityV1.directoryRevision` 取目录快照 `Project.revision`，
`authorizationVersion` 取独立撤权 epoch `Project.authorizationVersion`。两者不得互换。
`protocolScopes()` 当前只来自固定标准项与启动配置；它没有动态数据库修订。若扩展为
动态词汇表，必须纳入一致快照后再接收。既有 scope 语义只允许收窄；新目标管理授权
必须创建新 scope，不能扩大旧 scope 后复用旧同意。


关联查询适配边界：JDBC 调用 `namespaceScopeWithResourceDomains()` 后必须消费每个
term；namespace-only 消费入口不得调用该投影绕过 ID 限制。普通 namespaceScope、
namespaceAllowed 与日志投影在受限 ID 下拒绝；已核定 FLOW/EXECUTION 的精确资源
predicate 保持(namespace,id)关联。无 ID 列的 JDBC 资源只对 RESTRICTED_IDS 拒绝，
全部 ALL_IDS 项继续按 namespace term 过滤。关联交集空结果显式为空拒绝域。

目录可信身份先读后写，写事务持锁复核当前状态；token 内部目录、账号版本和 JWK
读取复用事务连接。公开目录/身份接口不接收 JDBC Connection，不把连接带出短事务。

### 应用项目宿主发布状态（2026-10-18）

上述应用项目机制及目录迁移数据源修正已在 `4b017f6` 的正式 CI
[39087229293](https://github.com/ai-specs/kestra-overlay/actions/runs/39087229293) 通过，
镜像已推广为 `sha256:ba19764bf232306e6501c5226af015d3e18d006da75a4e96a55c6baecee457af`。
先前段落中的“候选／未发布”描述提案与实施时状态；本条只确认指定提交的宿主公开机制、
镜像级 MCP/OIDC/浏览器检查和发布，不确认独立插件业务、完整迁移或 Compose 组合。
使用契约与范围以 README 的应用项目章节为准；后续提交须检查自身 CI，不沿用此记录。

原生filter锚定正式基线（2026-10-29，`1e3632e`，成功CI `40822882820`）：REQ-0384公开renderer仅在owned原生filter触发后适配高级层viewport坐标及根内scroll/resize；已登记层的style更新后重算，拒绝宿主document decoy干扰。缺失/跨根高级锚点拒绝，移动sheet按实际mobile trigger所属bar关联，chip编辑保持原生定位。独立真实KsFilter几何门与原949矩阵分别报告，不以业务插件或旧SDK结果替代。

移动filter视口边界正式基线（2026-10-30，27520a2/CI40941713707）：仅owned mobile sheet在下方空间足够时保留+8，否则上翻或视口安全边距clamp，maxHeight严格为正且不超过当前top到视口底的空间。内容展开依靠该上界和原生overflow保持可滚动；window/root scroll、window resize和visualViewport scroll/resize成对重算/清理。仅已迁移sheet/scrim保存逻辑父与原anchor，parentNode/nextSibling成对实现Vue后续patch关系，remove清理，不接受跨根插入或任意null兜底。desktop本轮不改变。原949/36保留，新增12几何单列，总48、8诊断源必须零错误。

REQ-0384桌面advanced视口边界增量（2026-10-30，候选未发布）：registered高级层下方足够仍+6，不足翻转或clamp并提供正maxHeight/原生overflow；visualViewport监听成对清理。原949/48保留，新增12，总60几何；不改chip/mobile业务语义，不引入业务路径。详见r-ee-rbac本轮接收提案。


### 原生 reference 与 REST 测试修复候选（2026-11-01，未发布）

0384 保持 13 个触达文件与 V1 公开 API，仅在同一 ShadowRoot 中沿真实事件目标的
祖先核对 ARIA，要求唯一解析到当前注册 popup 的 portal 内容；嵌套 tooltip 有独立
ARIA 时仍可找到真实外层 reference。不同根、不同实例、缺失/失效/重复引用仍按
outside 处理。扩展不设置内部 popup 序号，不修改 vendor DOM。

0330 的两条既有 REST 测试已接收最小消费修复：
`Flux.from(...).single().block(Duration.ofSeconds(10))` 等待完整响应终结，且要求恰好
一个响应。403/200、零业务副作用、快照查询、begin/close 次数的全部原断言保留；
生产 Java 与取消语义不变，0330 仍为 20 文件。相关类 2 项及未修改的取消/晚到句柄/
关闭调度 18 项通过。修正后完整 local-ci 通过：后端 412 项中 410 通过、0 失败、
2 个受控镜像入口跳过；UI 105 项全部通过，其中 shadow 31 项，无跳过。

当前唯一新候选为 `kestra-overlay:popup-reference-final-20261101`，镜像 ID
`sha256:6dde36977bd08452269413e64dd7a31a113572a94d9075624d99c23d7c8f80dd`，
内含 executable SHA-256
`64c978d7e490ed7378b125a268bff56d19417295ceb53c0379ed0486ed2ff3c5`。
新候选镜像门与 SDK949/几何64在独占 `final-candidate/` 目录重新执行；原报告保持
原 image 绑定，不用于替代新候选结果。对应提交 CI、推广与正式发布仍须另行验证。

## 首装事务参与者增量（2026-11-03，已接收，未发布）

`OidcInitialAccountParticipantV1` 使用启动期发现的唯一 classpath bean，在宿主首个账号
事务内借用同一连接初始化扩展。目录和 typed grants 留在插件；既有安装不补授。
锁序为协议安全锁 → 首装锁 → 插件目录/策略锁 → 标准行锁；receipt 延至全部数据库
写入成功后、commit 前创建。创建前回滚可重试，文件不确定状态仍锁存。
缺 jar 仅刷新不能装载 Micronaut bean；补放后必须重启 JVM，setup 页仅自动等待服务
恢复，不执行热加载或匿名重启。正常 jar 启动首装不重启。定稿与验收见
`r-oidc-server.md` 的“首个账号事务参与者”节；本条不是发布证据。


### REQ-0404a 原生 Flow 列表有限能力（候选未发布）

已接收入口B，消费方kestra-plugin-rbac下的原生Flow列表；已有Me恒true导致可选
latest/每行chart主动发403。新增固定目标HTTP投影，不新增Java SPI，不复制插件策略。
精确路由在认证后委派到控制器，控制器单次gate.boundary复用V2可信身份和冻结评估。
固定FLOW.READ前置、执行query来源/动作/aggregate与原生业务语义一致。
模式由公开configs boolean明确区分；模式A无请求、模式B缺组件503。
范围仅列表；复合详情后续独立分类，不能复用两个枚举通行。
详见r-ee-rbac.md的0404a接收段和README候选HTTP契约。


### REQ-0404b 原生 Flow 详情有限能力（已接收候选、未发布）

0404a HTTP新增显式v2，v1不变；固定9种原生读取操作由同主体/冻结typed评估投影，不新增SPI。
原生默认10卡分别预检，FLOW_DESCRIPTION可独立加载；运行tab的LIST/aggregate和行内LOG分开。
宿主投影复现已有ID可执行限制，LOG/TRIGGER受限ID未适配仍拒绝。固定定义内容摘要防漂移，
custom/未知定义未支持；Concurrency待独立typed分类，本批不算支持。
模式A无投影HTTP，原生刷新/custom装载保留。Flow异步定义/装载提交有局部generation守卫。
当前SDK普通facade不转发signal，0404a/b只承诺generation隔离、旧响应不恢复内容；不承诺
物理HTTP取消。可信业务API继续最终授权。契约、来源与验收门见r-ee-rbac及README。
独立CI artifact native-flow-detail-browser锁定37具名用例、源码/runner/readiness及纯诊断
checker，失败留存；实际生产授权与副作用由部署仓验证，不进入宿主CI。


### REQ-0406 原生 Flow 首屏与身份失效补偿（2026-11-23，入口 C 已接收，候选未发布）

正式 84fe614 的 0404 单 getter 返回数组，misc configs 同值替换也触发身份失效；
路由守卫先加载配置，App 的异步通用资源初始化再次替换对象，导致列表清空或在途结果
因 generation 变化被丢弃。原表格不因 data 清空自动查询。模式 A/B 均有生产失败证据。
最小候选使用独立 watch 来源按值比较；真正身份、tenant、登录或模式变化同步失效，
已挂载且身份与模式有效时合并补偿当前表格查询。挂载前的变化保留 pending；卸载和
退出禁止补偿。能力未知仍失败关闭，旧响应仍受 pageGeneration 约束，不新增 SPI 或策略。
新增自然首屏测试按父组件异步 configs 与子表格原生 mount 加载时序验证模式 A/B，
不得用手动刷新替代首屏成功；原十项保留并增加新身份恢复检查。具名输入和实际结果见
r-ee-rbac.md 顶部接收段及当前独占目录的定向报告。正式发布与生产组合仍由主控验收。

0406 CI适配补足：原生列表与必需详情门的Playwright适配器共用有界异步条件helper，
await页面evaluate且仅true成功；保留原21/37业务断言和异常分类。helper/test均进入两门
SOURCE输入锁，正式入口实际运行6项离线反例。未改SDK和onboarding驱动：本轮只读核对
未发现其使用同类async waitForFunction路径，不由此扩大其已验证范围。


## F5 通用 HTTP 扩展入口（REQ-0410，通用公开契约）

消费项目为独立 `kestra-plugin-amis-apps`；宿主只提供通用入口，不承载页面、API 声明、schema、Flow 查找或执行业务。2026-11-25 主控接收最小通用 HTTP 通道；消费必须匹配成功 CI 与正式镜像 digest。

正式输入 `91d6726df4d13535af22b16937e7e6ee21a5f5a4058534d31d3dfd64b6981c7e` 导出的 `/app/kestra` SHA-256 为 `58e3549afe5db2d4de6f16954bb67c487b0e72e456cd725cc128cdae94cca36c`。classfile 实证：CsrfTokenFilter 只注册 `/api/.*`，REST RBAC filters 在 SECURITY+1 对未知路由无通用扩展计划；manifest 仅登记 RBAC jar。已有 classpath、TypedAuthorizationGate.boundary/authorize 和 CSRF 校验方法可以复用，缺口是扩展请求的通用激活通道，不是 AMIS 专用 SPI。

0410 增加 provider 元数据注册及生产认证后的 fallback dispatcher：实际原生 MethodBasedRouteMatch 优先；静态与保留首段优先；之后才按 provider 纯元数据匹配。provider ID 是入口能力 ID，target 仅 namespace，不查询业务存储。首门使用现有 Operation V2 的 EXTENSION_ROUTE/EXECUTE，resourceId 为 provider ID，范围沿用 QueryDomain。第二道精确 Flow 执行门归插件，消费 README 声明的既有执行方法子集；不新增第二执行引擎或裸 queue 接口。

注册重复、未知范围、provider/授权故障均失败关闭；模式 A 仍必须认证。写请求直接复用 CsrfTokenFilter.csrfFilter，缺必需组件失败关闭，不扩张 `/api` 放行规则。授权采用既有 boundary 的完成/错误/取消清理。宿主测试须覆盖 HTTP/filter 顺序、原生与静态优先、两个 provider 隔离、匿名/允许/拒绝/503、CSRF、取消清理及零 handler/查询/副作用。插件 CI 与根仓正式组合验收仍各自负责。

兼容性：新增 enum 值须消费方显式识别；旧插件未知资源应拒绝。新增 `kestra-amis-apps` classpath 元数据只声明文件名，宿主构建不得读取业务 jar。关闭或缺席扩展时保持原生路径；升级时重验 fallback 保留首段与原生路由顺序。Flow 查找/执行、AMIS schema 和 UI 变更不在 0410 范围。

0410 激活顺序补证（2026-11-25）：现有 OidcIdentityLifecycleFilter 在 SECURITY+1 复查会话撤销，dispatcher 必须在其后（+2），两个 REST RBAC filter 在 +3。现有 OidcPriorToLoginPersistence.safe 只接收 `/ui/`，扩展匿名书签会丢失目标。最小修正为复用同一纯 metadata registry：只有唯一 provider 匹配且 Target.documentReturn=true 的安全 GET 文档可以保存及重新取回；API/资产即使 Accept HTML 也不能保存。静态 safe(UI) 兼容、原有 cookie 清除和同源/编码防护保留。原生 chain 的错误不得被 dispatcher 改写为 503。

0410 文档恢复补证：既有 lifecycle 对失效身份只为 `/ui/*` 返回 `/oidc/logout`，独立文档得到裸 401；扩展首门裸 403 也无法提供既有退出换号入口。复用统一 registry 的安全 GET+Accept HTML+唯一 documentReturn 分类，使失效扩展文档进入既有 logout，授权拒绝扩展文档进入 `/ui/access-denied`。API/JSON 保持 401/403 no-store；404 不改写，分类不查询 Flow。宿主定向测试不能代替根仓生产登录与退出验收。


### REQ-0412：会话先行校验的依赖故障分类（入口 C）

0410 固定会话撤销检查先于业务授权后，原 dependency503 镜像门实际复现：有效签名
cookie 的健康请求200；受控投影表暂时不可用时得到401，预期为既有安全503；此时
不应把仍有效的身份判为注销。证据入口为原 `blackbox-dependency503.sh` 的具名
`real-cookie-lifecycle-and-typed-chain-fault-status`，主控候选输入执行结果401。

最小修复复用 `OidcTrustedIdentity` 已有授权故障分类，在会话先行校验中保留明确的
SQL/受控投影依赖不可用信号；lifecycle 输出无敏感详情的 no-store ProblemDetail503，
不清除 cookie。真实账号失效、scope 撤销和未知运行异常继续原拒绝/退出行为。
不按异常消息或任意 cause 搜索，不放宽主体、签名、scope、审计或事务检查。
本地定向门、原 dependency503 七项、两种首装镜像门及正式CI必须对应最终输入。

### REQ-0411：UI SDK 独立文档偏好数据桥（入口 B）

消费方 `kestra-plugin-amis-apps` 独立 HTML。正式 digest `91d6726df4d13535af22b16937e7e6ee21a5f5a4058534d31d3dfd64b6981c7e` 的 SDK contract 只有主题/语言列表与语言别名，没有偏好存取契约；native `ui/src/utils/utils.ts` 的 getSelectedTheme/getTheme/getLang 实际消费 localStorage.theme/lang。独立页猜测 system/navigator 会在首访、刷新和切换时偏离 native。2026-11-26 主控接收最小数据提案：现有 SDK contract.json 追加 preferences descriptor，锁定存储键、默认、系统模式与解析映射、locale aliases；原契约字段保持兼容。不得导入 SPA/Vue 私有实例、改变 native UI 或建立平行偏好表。归属既有 REQ-0340/0384 UI SDK 能力。消费必须匹配成功 CI 与正式产物；宿主真实 Chromium 对照 native 函数验证三主题/system、13语言/别名/默认、刷新与跨文档 storage，原949/64门不减少。

### REQ-0413：Webhook 执行状态传播（入口 B，已接收）

消费方为 `kestra-plugin-amis-apps`。正式 host 的 `WebhookService.startExecution(Execution)` 原本复制
`kind`、`trigger`、`labels`、`inputs` 和 trace，但没有复制调用方准备的 `State.Type.FAILED`；原生
Controller 的 `Create.withStateType(FAILED)` 语义因此不能由独立扩展保留。该失败不来自插件源码，
host 通过独立 mock capture 重现。

最小契约：`startExecution(Execution)` 保持现有入口；`FAILED` 传给 `Create.stateType`，
`CREATED`、`RESTARTED` 或无 state 保持原有 CREATED 默认；其他预提交状态失败关闭，不进入
waiter、queue 或 event。正常 waiter 注册、operationId、queue emit、event publish、trace 顺序不变。
BLOCK/条件失败不创建 execution，仍由调用方在准备阶段负责。不得新增裸 queue、第二执行引擎或
回移未归因上游代码。

host 独立测试验证 FAILED、正常 CREATED/RESTARTED/无状态、非法状态、wrapper subscription
取消和 queue/event capture；取消测试不证明 AsyncOperationWaiter 内部注册清理。测试只证明
Create 命令和包装层互操作，不证明 AMIS 业务执行或生产组合通过。消费方必须先完成独立编译
和真实组合验收。
