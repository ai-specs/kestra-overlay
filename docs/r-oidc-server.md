# R-OIDC-SERVER：内置 OAuth2/OIDC 授权服务器（能力契约、实施依据与验收）

## 普通授权依赖故障的明确503传播（2026-10-29，已接收，未发布）

消费项目为`kestra-plugin-rbac`。部署主控round11重命名统一目录表后，生产管理GET
返回403而非需求规定的503。普通可信身份在Controller前执行，现有V1路径将SQL/投影
异常折叠为普通IllegalStateException，typed评估前置再统一403，插件503分支不可达。
这是公开机制分类缺口，不通过放宽根仓状态断言处理，不包含MCP或资源audience变更。

最小契约在`TrustedIdentityV2`增加向后兼容default入口`currentForAuthorization()`，
默认调用`current()`，旧实现无需新增方法且保持旧失败关闭。宿主实现覆盖此入口并复用
校验逻辑。V1 `current()`及普通validate的实际异常类保持不变；V2借用连接生命周期
FORBIDDEN/UNAVAILABLE分类保持不变，不新增V3或业务模型。

新增公开`AuthorizationUnavailableException`，仅表示在受控SQL/连接/投影调用边界或
授权provider明确报告的依赖不可用。身份、issuer/audience、epoch/授予失效和策略拒绝
仍403；未认证仍按原401。未知RuntimeException、未知操作、缺失/重复独立授权provider
保持原失败关闭，不整体改503。需求中的“依赖不唯一503”指插件管理目录/策略依赖，
不指独立授权provider原有缺失/重复门。不得按message或任意cause链搜索分类。

`AuthorizationEvaluations`在支持V2时调用新入口，typed gate及filter仅保留精确公开
异常并映射503固定安全ProblemDetail；同步抛出、异步begin/authorize失败均须保留。
只按框架实际规定解开CompletionException/ExecutionException包装；未知包装不猜测。
普通拒绝与其他HTTP错误路径不变，响应不暴露SQL、cause或凭据。

2026-10-30初始化阻塞隔离（48946d6已独立发布）仅调整0330调用方调度，不改变本节身份校验或事务实现。
可信身份与评估begin在Reactor有界阻塞线程池执行；先建owner，跨线程仅传播请求来源。
V1 current、V2 currentForAuthorization、同连接current(Connection)的签名、连接所有权、
安全锁及锁后读取均不变。取消与晚到句柄仍由owner释放；close工厂在有界阻塞池/空上下文执行，
不把连接或事务上下文复制到清理任务。明确UNAVAILABLE仍503，
身份失效/不匹配和未知故障仍保留拒绝分类。独立红绿与完整门状态见r-ee-rbac同名节；
插件只消费对应提交成功CI、正式推广并实际核验的镜像；本地候选不能作为正式编译输入，
后续版本不得直接沿用48946d6的发布结论。

宿主使用自有最小provider先红后绿验证兼容、身份SQL/投影、begin/authorize同步异步
503、未知异常403、缺组件/重复provider/路由原门和无副作用，随后完整local-ci及镜像门。
不读取真实插件源码或jar作为宿主测试输入，不改SDK。扩展必须等宿主对应提交CI与
正式镜像推广成功后消费新默认入口与异常，再验证自身管理故障和根仓组合；候选不交付。

本地结果（2026-10-29）：真实HTTP红测明确begin依赖预期503、实际403；29项定向
绿测及最终97份XML395项（393通过、2项镜像专用前置跳过）、UI87通过。classPath、
OIDC35、四份MCP专项各1项零跳过通过。另用自有最小投影provider实际执行生产登录、
JWKS验证签名UI cookie、带组claim允许请求200→投影表故障503安全ProblemDetail→
同cookie恢复200及账号无副作用检查。生命周期filter启用但实际链未截断明确503，
因此未改该filter或V1 validateSession；诊断报告real-cookie-red.json实际为7项绿测，
文件名不是红测证据。form/env门均须含同一7项probe，不用mock身份替代。
输入审计覆盖58个触达源码、46补丁独立重放与编译class/executable一致；SDK10/UI532
逐字节等正式父2b67，最终提交CI949仍须实际执行及下载，不能沿用父报告当新后端通过。

## V2 借用连接身份复查的拒绝分类（2026-10-28，已授权实施，未发布）

消费项目为 `kestra-plugin-rbac`。部署主控在正式 `dae2b4a` 镜像与匹配插件的
round10生产互删中观察204+503，两个回滚检查已通过，但互删失败方503不满足安全拒绝
契约，不能通过扩大验收允许集掩盖。请求可能已在HTTP入口取得身份，等待安全锁期间
该actor被另一个事务删除、停用、更新认证版本或撤销授权。现有V2 `current(Connection)`
把已知身份失效与SQL/投影故障共同折叠为普通IllegalStateException；生命周期分派再
折叠为UNAVAILABLE，丢失业务拒绝与基础设施故障的区别。现场具体异常仍由部署日志核对。

最小变更仅收敛V2借用连接路径与生命周期分派：缺失/已停用actor、认证版本失效、
可信claim或当前授予失效使用既有 `IdentityLifecycleGuardV1.Rejected(FORBIDDEN)`；
可信claim本身缺字段、类型或版本失效同样属于拒绝。SQL、投影异常、缺失/重复组件、
投影返回null/非法版本/错误目标等协议损坏使用UNAVAILABLE；投影未激活表示依赖缺失，
已激活但无该用户关联表示授权失效。不得按异常消息分类，
不得将任意IllegalStateException改成403。V1 `current()`/普通validate继续保持既有
失败契约；不新增插件业务类型，不扩大权限，不把真实插件加入宿主测试或CI。

锁后重新读取标准账号/client及公开投影，借用连接不自行commit/rollback/close。分派
保持明确Rejected类别，其余未知故障失败关闭为UNAVAILABLE。宿主负责分类和同连接
安全锁，插件后续消费正式产物并收紧互删测试的异常类型，根仓保留204+503为失败。

必须先用确定性屏障在身份已解析而安全锁被占用时提交actor删除/停用/认证版本变化/
撤权，验证锁后安全拒绝且无失败方副作用；另验证SQL/投影故障、缺失/重复组件仍为
UNAVAILABLE，V1契约与借用连接所有权不变。随后运行完整local-ci及新镜像OIDC、MCP、
两种首装与生产认证页面门；SDK输入不变仍需核对，最终CI及推广成功前不得供插件编译。

本地证据位于`.work/identity-classification-final/`。真实PostgreSQL锁等待红测4项
均为预期FORBIDDEN、实际UNAVAILABLE；绿测4项零失败，6项分类单元覆盖基础设施
异常、可信claim错误与投影损坏、缺失/重复组件、V1普通异常及连接所有权。最终完整
local-ci为93份XML、385项，其中383通过、2项镜像专用前置跳过；UI87通过。新镜像
classpath、OIDC35、四份MCP专项各1项零跳过通过；form/env各保留原22/7/26/52/215/14、
空资料26、favicon26项，并新增实际镜像V2锁后复查24项。未知类型和故障不改为允许。
早期探针V1创建资料及清理入口准备失败均保留，不计通过。SDK10/UI532逐字节等正式
父a56，未把父949报告写成本轮新后端已跑949；最终提交CI须实际执行并下载949。

## 匿名 favicon 静态资源激活修复提案（2026-10-28，已授权实施，未发布）

消费扩展为 `kestra-plugin-rbac`，行为为生产登录、退出和零授权页面装载站点图标。
部署主控在正式 `3a96e111`（executable SHA-256
`190fb02df7923f096bc8a540b49c5e96f16a25736f3c1649749dcb51a7eae15b`）
开启 RBAC/typed 后观察匿名 `/favicon.ico` 返回 401。README 已明确匿名开放该精确
路径，正式 executable 也包含 `root/favicon.ico`，由 `classpath:root` 的静态映射承载。
已有 Micronaut 匿名规则不能越过独立授权门；共享 `RestRbacFilter.protocol` 只接受
方法路由，因此漏掉实际静态处理链。登录页未显式声明 favicon，浏览器默认请求不能
通过 SDK 页面中的模拟 204 证明可用。

最小公开契约只允许规范原始路径 `/favicon.ico` 的 GET/HEAD，且必须确认为宿主配置
解析到已打包 `root/favicon.ico` 的静态资源处理链。业务方法路由、其他静态路径、错误
资源、缺失资源、POST/PUT 和编码/穿越/重复分隔符均不获得此例外；不得通配放行无
方法路由请求。共享分类与身份生命周期检查使用同一判定，使匿名、退出、零授权及
失效会话仍可取得该公开图标，不因此取得业务身份或业务 API 权限。

宿主负责静态映射、精确激活和认证回归；扩展继续负责业务授权。部署方保留 README
中精确匿名规则，不扩大 API 权限。此修复不新增 SDK/SPI、不改业务表及资源策略；
上游静态处理链或资源映射升级时必须重新验证实际解析，无法确认时失败关闭。

宿主必须先红后绿验证实际静态请求及方法/路径/映射负例、失效身份图标可用与受保护
API 继续拒绝，运行完整 local-ci、新 executable 镜像门及 form/env 两种首装的生产
认证页面检查。镜像门启用 RBAC/typed，覆盖匿名首次、退出、零授权与失效会话，核对
图标内容与 MIME，不以 SDK 模拟资源代替。所有资源使用 owner/run 标签及命名 PG 卷，
仅一套 PG 串行执行。部署仓最后选择已发布镜像与匹配插件复测，宿主绿测不等于真实
插件或根仓 UI/Compose 通过。当前候选未发布，不得作为插件正式编译输入。

本地证据位于 `.work/favicon-final/`：正确父提交归档的45补丁重放加0385逐文件
核对；0380新增PG测试run标签也包含在19个触达源码输入审计中。7项定向测试先红
后绿，完整local-ci的375项中373通过、2项镜像专用检查跳过，UI87通过；外层zsh
因使用只读status变量退出1，原日志保留，不改记整体命令成功。四份MCP镜像专项各
1项零跳过，实际覆盖上述专用前置。新镜像OIDC35及form/env原有22/7/26/52/215/14、
空资料26与新增favicon26项均通过；两模式最终诊断未分类错误0。HEAD框架返回200
空体且可省略MIME，不扩大为响应头改造。生产浏览器只允许精确登录窗口中既有评估
边界缺provider导致的configs/manifest拒绝；逐请求记录来源，不豁免其他403。
先前错误比较基线产生的重复改密块、HEAD头部断言和两次浏览器失败均保留，不计通过。

## 账号空资料公开契约（2026-10-28，仅对应提交 CI 与正式镜像推广成功后可消费）

消费项目为 `kestra-plugin-rbac`。部署主控用正式宿主 `cfd81ec8` 和匹配插件执行新装，
清空账号资料的 `PUT /api/v1/main/extensions/rbac/users/profile` 返回 400。需求允许姓名和
邮箱为空，冻结原型的“—”表示空资料，不是存储值。插件已允许空字符串，只消费公开目录。
现有宿主 `update` 强制非空；V2 临时创建把空值转 null 后又走 V1 默认资料，不能真实保存空态。

最小修复复用 `UserDirectoryV2.createTemporary` 和继承的 `update`，不增加接口或业务表。
姓名和邮箱的 null、空字符串及不含控制字符的纯空白统一存储并返回空字符串；非空值
继续要求最多 256 字符、无首尾空白和控制字符。超过长度或包含控制字符的值仍拒绝，
不得借空态规范化放宽原有边界。subject 与密码校验不变。V1 `create` 的 null 默认资料
行为保留；仅 V2 临时创建绕过默认值。更新只变资料、目录修订与更新时间，不改 subject、
active、角色、凭据、认证版本、tenant 或 issuer。邮箱为空时清除 verified；相同非空邮箱
保留 verified，其他邮箱变化清除 verified。旧 revision 拒绝且无副作用。

宿主负责目录持久化、输入校验、修订比较及认证不变性；插件负责 HTTP 类型、管理授权、
空态展示和退出换号，不覆盖宿主资料或读取私有表。已有 V1 调用者可继续创建默认资料；
资料更新新增允许清空，不自动清理已有账号。错误沿用 INVALID/CONFLICT/NOT_FOUND/
UNAVAILABLE；Java 签名只接受 String，HTTP 类型错误由调用控制器拒绝。

宿主必须执行真实 PostgreSQL 红测，覆盖 V2 空/缺省创建与 find/list 回读、非空更新后
清空、V1 默认不变、邮箱 verified、CAS 拒绝和认证状态不变，再执行完整 local-ci 及新
executable 的镜像门。宿主自有探针不消费真实插件。部署仓在正式镜像发布后复测匹配
插件的生产资料接口与冻结数据；候选本地通过不能作为正式插件编译或组合验收证据。

本地结果：目录红测14项中2项失败，修复后14项全部通过；完整local-ci后端368项，
366通过、失败/错误0、2项镜像专用前置跳过，UI87项全部通过。新镜像classpath、OIDC35项
及四份各1项零跳过的MCP专项通过，后者实际执行上述两项专用检查。form/env两种首装
各通过目录22、扩展7、主题26、语言52、首次改密215、RBAC改密14及新增空资料26项。
空资料26项包含21项公开Java目录断言及生产OAuth检查；反射错误类型仅证明Java签名
拒绝非String，不证明插件HTTP body返回400。未消费真实插件，不宣称根仓实际UI通过。
真实红测、镜像context缺目录失败及探针Accept失败均保留，不计为通过；最终双mode
使用同一固定脚本输入，退出只接受307并检查清除cookie，再完成原密码重新登录。

## 首次改密的 RBAC 协议激活点（2026-10-28）

消费项目为 `kestra-plugin-rbac`。部署主控在正式 `2906d795` 与匹配插件组合中复现：
临时密码生产登录返回 303 到 `/oidc/password`，匿名 GET 被 typed 授权门返回 401。
宿主独立 HTTP 回归在同时开启 RBAC 与 typed、没有普通认证主体时同样复现 GET 401。
已有 `/oidc/**` 匿名认证配置不能越过独立的 typed 授权过滤器；旧密码镜像门未开启 RBAC。

主控接收最小修复：0230 的协议分类只接受实际 `OidcPasswordChangeController`、精确
`/oidc/password`、GET 对应 `page` 或 POST 对应 `submit`，继续执行控制器自身的受限
interaction、单次消费、CSRF 与 Origin 校验。未知 controller/handler、其他方法、编码与
路径变体均不进入协议例外；不扩大 `/oidc/**`，不放宽业务 API，不新增公开 Java 类型。
匿名受限交互没有普通 Authentication，生命周期过滤器原有无主体分支已继续请求；
独立 HTTP 绿测证明本修复不需要新增生命周期绕过。组业务和管理授权继续归插件。

兼容影响仅为使已有受限改密流程在授权启用时可达，不使临时凭据取得正常会话/code/token。
独立门保留路由正反断言、真实 PostgreSQL/HTTP 生产登录→GET→Origin/CSRF 拒绝且数据库
不变→成功改密→重新登录，以及重放和退出。完整 local-ci 与相关镜像门仍须执行。
部署仓须在正式新镜像发布后复测匹配插件的生产首次改密；本地通过不表示正式发布或
Compose 验收通过，已有 SDK 与 949 job 不因该 Java 修复删减。

本修复完整本地 local-ci 执行 365 项后端检查（363 通过、2 项镜像专项前置跳过）及
87 项 UI 检查。Docker 存储恢复后，固定基础镜像与本次 executable 的新镜像已通过
classpath、OIDC 35 项和四份各 1 项零跳过的 MCP 专项。form/env 两种首装分别通过
目录 22、扩展 7、主题 26、语言 52、首次改密 215 及 RBAC 改密 14 项检查。
此前 Docker 只读失败保留为历史失败，未计通过。正式消费仍必须选择本修复对应提交
全部 CI 与镜像推广成功的产物；本地通过不能代替正式发布或部署仓组合验收。

镜像验收脚本必须为 PostgreSQL 显式创建带 owner/run 标签的测试卷，不能依赖镜像
自动生成无标签匿名卷。OIDC、MCP 与两种首装都只挂载本次新建卷；同名卷已存在时
失败退出，不复用未知数据。结束按精确 owner/run 标签清理容器、网络和卷，保留其他
部署资源。资源归属与测试前后卷清单是本地门证据，不以只查容器为空代替完整清理。

## 协议44补丁正式发布（64c4498）

0380–0383已随提交64c449867b09ec21a5462104783fd2b8c7a4b4c5通过正式CI40523539018，
四job及promote均成功。实际下载报告已核对364后端项、64UI项、4次镜像专项与两种
首装完整矩阵；两项后端中止已在镜像专项实际执行。正式镜像digest为
`sha256:bebf7a7c06a6205c151ffd35882c54965918357f4e1c71bc0cd2879c3177a22e`，
registry与双架构provenance匹配。此发布不含后续SDK0384，不证明插件或组合交付。

### 历史：2026-10-27本地发布前验证

本轮只接收0380–0383及必要协议钩子修复，不包含后续UI SDK扩容。固定BASE独立重放
44补丁并执行完整local-ci通过：后端364项中362通过、2项因运行镜像前置中止，失败0；
原UI8文件64项全部通过。随后独立构建44镜像，classpath发现、OIDC35项和真实MCP
四次专项全部通过，镜像专项实际执行了前述两项，不把local-ci中止计为通过。
两种生产首装分别完成目录HTTP22项、扩展入口7项、认证主题26项、语言52项及首次
强改密码215项，全部通过；拒绝、刷新、导航、退出、重启与缺投影零授权回归均保留。
以上是该提交正式发布前的本地证据，正式状态以本节顶部为准。下方带日期的“候选/
未发布/未运行”记录保留历史语境，不代表当前协议发布状态，也不替代后续输入的检查。

## REQ-0380–0382 账号与 client 凭据生命周期（2026-10-27，授权实施、候选未发布）

消费项目为 `kestra-plugin-rbac`。R24 同连接删除、R25 维护轮换为部署主控裁决，维护者
可以复核设计。本节不表示接口、测试或镜像已经发布。宿主只处理标准身份和认证凭据；
组、授予、最后管理员规则、管理权限和业务页面仍归扩展，不复制组业务。

### 实际缺口与现有机制

基线 `c2390ff22705135ba2773bce23aab27bb4e9472b` 的 `UserDirectoryV1` 无删除和临时
密码创建；内部 delete 自开连接，不能和插件清理原子提交。`password_change_required`
只有建表定义，登录未消费。内部 updateSecret 无公开修订、提示和维护阶段；owner API
不是实例凭据管理。这些为源码缺失证据，不是已执行的新功能失败测试。

复用 `OidcProtocolStateV1.lockSecurityState` 和同连接 guard，不另建组锁表。
`TrustedIdentityV1.current()` 自开连接并取得同一锁，不能在已持锁参与者中调用以完成
同连接重验。现有 guard 没有账号删除事件和明确可信操作者。

### 版本化公开候选

| 契约 | 方法/DTO | 最小职责 |
|---|---|---|
| `UserDirectoryV2` | 继承 V1；`createTemporary(username,name,email)` → `TemporaryUser(user,temporaryPassword)`；`delete(subject,revision)` | 宿主生成临时密码，仅本次返回；宿主拥有删除事务 |
| `TrustedIdentityV2` | 继承 V1；`current(Connection)` → 既有 `Identity` | 当前已认证请求在借用连接重验账号/client/投影；任意 DTO 不能自证身份 |
| `IdentityLifecycleParticipantV1` | `beforeChange(Connection,Change)`，含操作、目标、可信 actor | 唯一 provider；插件同连接重验业务授权和最后管理员，删除时清理所有组授予 |
| `ClientCredentialsV1` | `status(clientId)` → `CredentialStatus(clientId,clientType,secretSet,maskedHint,credentialRevision,rotationMode)`；`rotate(clientId,revision)` → `IssuedCredential` | 无旧明文/哈希；public 和配置登录 client 在线轮换拒绝 |

候选仅供插件设计，不能用于正式编译。V1 保留签名；组功能开启时生产账号变更要求新
参与者，不退回只实现旧 guard 的插件。因此宿主与插件必须按发布顺序选择匹配组合。
最终签名和稳定错误以实现、独立
探针及 README 为准。类型、版本变化必须同步文档，不静默修改旧 create 的输入语义。

### 安全与失败规则

变更使用 READ_COMMITTED；公开安全锁→插件目录→插件策略→标准身份行锁。actor 在同
连接重验。组功能开启时参与者缺失/重复/异常失败关闭；扩展写入与宿主清理一起提交或
回滚，拒绝删除当前 actor。账号删除不删历史执行和审计；持久退役 subject 禁止同名
重建复活旧凭据，不修改现有 subject 等于登录名的契约。

临时密码只建立短期受限改密交互，不产生正常 IdP/UI 会话或 code/token。改密必须检查
单次交互、同源 Origin、原认证版本和密码边界；成功原子清除强改标记、推进认证版本，
销毁交互后重新生产登录。退出可用；重放、故障、旧版本和弱密码均不签发正常会话。

R20 提示在生成/轮换时以头3字符和尾4字符与哈希同事务保存。历史缺提示为 null，显示
“已设置，提示不可用”，不得从哈希猜测。轮换比较 credentialRevision，不自动重试；
新值仅本次返回，响应丢失只能再轮换。普通轮换不改变已签发用户 token 的有效期。

配置登录 client 仅走宿主维护 CLI：prepare 生成待激活版本且旧登录仍有效；cancel
丢弃待激活材料；停止 JVM、同步消费配置后 activate 比较版本替换有效哈希；失败使用
专用 rollback 恢复匹配旧配置；真实登录成功后 confirm 清除回退材料。不长期接受双值。
CLI 不读取插件业务表，不经 HTTP 暴露维护材料；URL、日志、异常和报告不得泄密。

### 必需测试与发布门

#### T7 普通 confidential client 登记前置（2026-10-27，主控已接收，候选未发布）

README 的“confidential client 需要由部署方预先注册”未给出通用公开入口。当前正式配置
只注册首装登录 client；标准 DCR 只支持 public，现有公开/维护 CLI 无普通 confidential
登记。因此仅通过内部 create 或测试 SQL 建行不能作为 new-install 的真实 T7 输入。

最小候选是在通用维护 CLI 增加 `register-confidential`，输入 clientId、ownerSubject、
精确 redirectUris、标准 grantTypes 和 protocol scopes，不接收组/角色/权限/应用声明。
宿主核对安装凭据和 issuer、实际存在可登录 owner、当前配置登录 client 排除、输入长度
和回调安全、允许协议 scope、数量限制及重复 client 冲突；生成高熵 secret，在同一公开
安全锁事务中保存标准 owner 注册、哈希、头3尾4提示及 credentialRevision=1，只本次下发。
不增加在线管理 UI，不把普通登记当 UI 配置客户端，不修改已有 client 或读取插件表。

必须独立测试真实 CLI 登记→生产 authorize/PKCE/token→轮换新旧值、重复不覆盖、错误
owner/安装/回调/协议项/配置登录client拒绝无副作用、并发冲突、public语义不变和脱敏。
根仓只可在正式镜像发布后使用此入口准备 T7，不把候选类或内部方法当正式输入。
主控已接收此窄范围标准机制补足，纳入 REQ-0382；不扩大为业务管理 UI。

0380 必须验证同连接重验、参与者唯一性、写后抛错/宿主删除失败全部回滚、并发管理员
互删/停用、当前主体拒删、退役 subject、认证数据清理和历史保留。0381 必须验证一次性
临时密码、生产受限改密、Origin/CSRF/重放/旧版本/弱密码拒绝、改密后真实登录。
0382 必须验证 public/登录 client 在线拒绝、哈希提示修订原子变化、并发冲突、新旧值、
历史无提示、token 有效期不变、维护 prepare/cancel/activate/rollback/confirm 全链。
全部包含真实 PostgreSQL/HTTP；拒绝必须比较副作用，不能只看状态码。

宿主使用自己的最小参与者，不读取/构建真实插件。完整本地门→主控审查→独立 CI 与
正式发布→插件从正式 digest 独立编译→根仓正式组合真实 UI/OAuth/MCP、缺组件与关闭
回归。当前没有新增通过或发布证据，不能沿用旧 CI 证明此提案已交付。

## 应用组职责纠正提案（2026-10-21，源代码归属已纠正，功能验收与发布未通过）

### REQ-0383：R19 资源 Audience 与登录受众分离（2026-10-27，主控已接收，候选未发布）

消费项目为 `kestra-plugin-rbac`。主控原型实测已有 public client 的资源 audiences 为空
可以登记，详情显示空态；当前正式协议投影却要求 approved 时 audiences 非空。插件
业务输入与宿主协议语义需要分别纠正，不能为表单方便直接删掉宿主 aud 校验。本轮
0380–0382 不承担 Audience 语义变更；独立 REQ-0383 已由主控接收实施，仍须独立发布。

可核对源码：0370 的 `ApplicationGroupProtocolProjectionV1.Projection` 拒绝
`approved && audiences.isEmpty()`；0362 的 `OidcTrustedIdentity.validateCurrent` 先要求
投影 audiences 包含全部已验证 token aud，再对 UI 要求精确 `{clientId}`、对 MCP Bearer
要求精确 `{resource}`。两种受众的集合语义混在同一字段。

当前真实签发不是“未请求 resource 就没有 aud”：`OidcTokenService.issueAccessToken`
明确 `.audience(List.of(resource == null ? clientId : resource))`；`issueIdToken` 的
IDTokenClaimsSet 始终以 clientId 为 audience。`validateApplicationGroupAudience` 在
resource 为空时仍要求投影包含 clientId，带 resource 时要求包含该 resource；现有 token
在线复查同样用投影包含 JWT aud。以上都是指定源码事实，本轮未以新镜像复测。

最小候选新增 `ApplicationGroupProtocolProjectionV2`，把 `resourceAudiences` 明确定义为
“应用允许的资源 audience 集合”，允许空集，
仍逐值拒绝空字符串/控制字符/通配符。不得把 clientId 自动填进资源列表，也不得把
空资源列表解释为全域。V1 的 DTO、approved 非空 audience 及其包含登录 audience 的
语义保持原样，不静改已发布 V1。V2 继承 V1 仅用于既有唯一 provider 发现槽，提供
`currentResources(Connection, V1.Request)` → V2.Result；V1 的 `current` 在 V2 实现中
默认明确拒绝，不把空资源集伪装成含 clientId 的 V1 投影。V2.Result 的 contractVersion=2，
其 Projection 复用 V1 的请求字段及 scope 元数据，只将资源字段命名为 resourceAudiences。
插件只实现一个版本的 provider，重复实例继续拒绝。不得将未发布类型作为插件编译输入。

| 已验证凭据用途 | 最小候选校验（其余签名/issuer/账号/client/组/epoch/scope 检查保持） |
|---|---|
| ID token / 配置 UI 会话 | token aud 必须精确为当前已验证 clientId；UI 仍要求当前配置登录 client，不依赖资源列表是否包含 clientId |
| 未带 resource 的标准 access token | 维持现有线上 aud={clientId}，逐项核对 token client_id、标准注册和请求目标；不制造资源授权，也不把 clientId 写入资源列表 |
| 带 resource 的 access token | 请求 resource 必须精确属于资源列表，JWT aud 必须精确对应资源；空列表拒绝 |
| MCP | 继续要求当前 Bearer、精确资源 URL/audience、当前标准 client 和业务授权；普通无 resource 的 access token 仍不可调用 MCP |

所有签发、授权码绑定、refresh、已有 token 在线复查和 UI 当前身份读取使用同一版本门。
V2 组 claim 追加签名字段 `audience_contract_version=2`，不改变 claim 的组 ID、epoch、
issuer 或协议 scope。V2 code/refresh 使用 `application-group-v2.<组ID>.<epoch>.` 前缀；
V1 的无标记 claim 和 v1 前缀仍只对应 V1。provider 在 V1/V2 间切换时旧组 code/refresh/
access/UI 身份因版本不匹配而拒绝，用户必须重新生产登录，不自动转换。V2 带资源 access 另签名
精确 `resource`，无资源 access 和 ID token 不附加该值；JWT aud 分别仍为精确资源或clientId。
旧 code/refresh 不得凭新解释扩大资源范围；资源列表收窄后旧带资源
凭据继续按当前投影拒绝。元数据空态不赋权，不改变 protocol scope 与应用 scope 分层。

拟定独立正反探针：① approved 且资源空集的纯投影合法；② 标准登录和配置 UI 的精确
clientId audience 成功，错误/额外 client audience 拒绝；③ 未请求 resource 的 access JWT
仍是 clientId，普通非 UI client 不因字段为空成为 UI client；④ 空资源集合拒绝所有
resource 签发和 MCP，不能产生 token/code 副作用；⑤ 单一已登记精确资源允许，错路径/
尾斜线/额外 aud/资源外请求拒绝；⑥ refresh 与在线复查覆盖空→非空、非空→空及撤权，
旧凭据不自动扩权；⑦ 错 issuer/client/组/epoch、缺失重复投影、存储异常和关闭功能
回归。必须包含真实 PostgreSQL、生产签发/验签和 HTTP/MCP 拒绝无副作用。

候选实现已覆盖生产预览、consent 提交前同连接复查、code 资源绑定、签发、refresh、
在线复查与可信 UI/MCP 身份。预览拒绝不创建 consent/code/token；consent 期间资源
撤销时不消费交互，不创建 code/token。code 签发还重新核对其持久资源，不能把无资源
code 在资源登记扩张后换成资源 token。候选定向测试不替代完整 CI、正式镜像或部署仓
浏览器/真实业务组合验收；先宿主正式发布，再插件消费，不绕过本轮 UI 正式输入缺口。

### 2026-10-22 当前状态

组合验收发现的新机制缺口：`OidcIdentityLifecycleFilter` 对没有组 claim 的标准 UI 会话
也调用严格组身份读取，缺插件时使生产回调后的文档返回 401。候选修复将会话有效性
与组授权身份分开：无组 claim 时只允许精确配置登录 client、当前账号认证版本，以及
缺失或未激活的投影；重复 provider、激活后未重新登录及已有组 claim 仍严格拒绝。
不会制造组身份或给予业务权限。新增三项定向检查全部执行，可信身份 suite 由 10 项
增至 13 项；完整本地 CI 再次通过。镜像专项还检查完整功能开关开启且无组 provider 时
标准登录与匿名静态资源可用、业务 API 拒绝、普通 client 授权返回 invalid_scope 且无 code。
这属于宿主认证机制，插件业务模型不进入宿主。新正式 CI 与镜像发布仍须取得。

权限恢复后，在新的 `.work/application-group-unrestricted-ci` 验证树完整运行
`scripts/local-ci.sh` 通过。40 个补丁顺序重放，Micronaut 编译与索引生成、定向测试、
UI 构建、UI 单元测试 64 项及 executable 打包均通过；实际 executable 通过职责边界门。
后端最终报告共 322 项，其中 320 项通过、2 项因镜像专项前置条件未设置而中止，失败为零。
两项分别为 `OidcSecondUserFixtureTest` 与 `McpSdkInstanceTest`，必须由后续镜像验收
实际执行，不能计为通过。全部必需协议及授权报告数量门通过，含真实 PostgreSQL
签发 4 项、集成 9 项、账号 guard 4 项和 client guard 3 项，无失败或跳过。
日志为 `.work/application-group-unrestricted-ci.log`。后续镜像验收实际运行了上述两项
专项测试：真实 SDK 成功、scope 拒绝和撤权后无新增执行通过。OIDC 镜像黑盒 35 项通过，
classpath 探针实际装载通过，表单首装与环境变量首装的 UI 镜像验收均通过。
本地 ego-browser 使用与 CI 共享的断言，扩展页面 7 项、认证主题 26 项和语言 52 项通过。
原始日志为同目录 `application-group-unrestricted-{oidc,classpath,mcp,ui-form,ui-env}.log`；
保留的 XML 与浏览器报告在 `.work/application-group-unrestricted-evidence/`。
正式 CI 尚待验证，本地候选不是插件正式编译输入。下文源码阶段未执行记录保留为历史证据。

标准账号与 client 生命周期均已接入 `IdentityLifecycleGuardV1` 和统一协议安全锁。账号状态
与密码变更使用 `READ_COMMITTED`，先核对修订，再在同一连接调用 guard，最后更新账号、
认证版本、token 与授权码。client 撤销/删除先核对标准所有者与账号，再调用 guard，随后
取得私有锁、再次核对所有者并消费管理交互；拒绝不消费交互。缺失、重复或异常 provider
失败关闭。guard 的明确拒绝原因保留；owner HTTP 入口返回无缓存的 403/409/503，响应不含
用户、凭据或内部异常内容。关闭功能时保留标准 OIDC 生命周期行为。

宿主已移除旧 `ApplicationDirectoryV1`、`ApplicationGroupManagementV1`、全部组业务实现、
组初始化 CLI、组表迁移及 `0363/0364` 补丁，不提供旧目录代理或旧 API 转发。公开 README
也已移除旧宿主组初始化命令。组、scope、支持登记、用户授予、内置/退役和初始化计划归插件。

固定 BASE 的40补丁重放、57份相关主源码编译、源码职责门和补丁结构门通过。可信身份、
授权投影、账号/client guard 与异步检查共38项进程内探针通过，协议契约/查询11项通过；
24份源码与测试逐字节核对为重放结果。PostgreSQL 签发/集成12项及 guard7项只完成源码
编译，未执行，不证明真实数据库回滚、并发或插件最后管理员判断已通过。

构建与本地 CI 还在实际 executable 装载前核对新公开类型、旧业务类型/表及字节码依赖。
本轮用本仓保留的旧 executable 实际验证拒绝；没有新 executable 的通过证据。旧宿主业务
契约7项、业务数据库20项、业务引导4项和目录迁移上下文1项随错误归属实现退役，不记通过。
新业务用例的落实归插件；根仓完整 new-install 门保持不变。旧共享意图、首方成员和旧迁移
行为不得作为新目标恢复。只有真实 PostgreSQL、完整构建、HTTP/浏览器与正式 CI 通过后
才能发布新镜像。

普通 client 接入的前置顺序冲突已在源码修复，见下节。真实 HTTP、浏览器、数据库与发布门
尚未通过，不能把控制器方法探针称为生产登录或完整授权流程验收。

证据树为 `.work/application-group-host-boundary-final-replay`。原始日志保留重放、主源码、
测试源码和进程内结果；部署仓 `.work/application-group-ownership-review/host-lifecycle-*`
保存本轮审查副本。下方带日期的旧候选调查与失败门属于此前阶段，不代表当前源码状态。

### Pending consent 与最终签发的阶段边界（2026-10-22，候选未发布）

新增只读 `OidcProtocolStateV1.pendingClient(Connection, issuer, clientId)`，仅返回仍启用、
未过期且状态确为 pending 的注册信息。它不返回可用于签发的 active client，也不包含
client secret、组业务数据或资源权限。正常 `client` 查询仍将 pending 视为不可用于当前授权。

生产 authorize 控制器改用 `OidcTokenService.previewConsentScopes`。预览允许有效 pending
client 展示已经在应用组登记、获批且该用户可获得的 scope；仍检查精确 issuer、client、
协议注册、应用支持和用户授予。不允许未登记应用、未知 scope、越界范围或 UI selector。
应用权限说明使用同一预览规则，避免在渲染 consent 时误调用严格签发检查。

接入顺序为：标准 DCR 建立 pending client → 插件为该 client 登记应用支持 → 生产
authorize/owner consent → 标准所有权确认 → 重新核对当前状态并绑定授权码 → token 签发。
插件登记 pending 元数据时必须通过上述公开查询核对目标与有效期；登记不代表 client
已经可以取得 token。标准所有权确认仍由宿主执行，组业务登记仍由插件执行。

授权码绑定、token、refresh、现有 token 复查不调用预览分支，仍要求当前有效 client。
预览只返回 scope，不创建 token、授权码或绑定。批准后如果支持或用户授予已经变化，
绑定重新校验并拒绝失效请求；控制器向原注册回调返回标准 `invalid_scope` 与 state，不
返回授权码。该变化不扩大缺 provider 的零授权登录例外，也不自动给旧凭据增加组身份。

检查结果：40补丁重放、57份相关主源码及源码职责门通过；授权/当前身份/生命周期与
控制器方法探针45项，协议契约/标准查询13项通过。新增5项控制器探针使用生产控制器与
真实 token-scope 逻辑，但 JDBC、session、ownership 为模拟协作者，未启动 HTTP server，
不作为网络或浏览器证据。PostgreSQL 集成增加过期 pending 检查，并把已有 client 接入
用例改为先登记、先预览、确认后签发；签发/集成/guard 共20项仅源码编译，尚未执行。

原始树为 `.work/application-group-pending-consent-replay`；部署仓审查副本为
`.work/application-group-ownership-review/pending-consent-*`。新 executable 尚未生成并
通过产物门，完整构建、真实 PostgreSQL、HTTP/浏览器、正式 CI 与镜像发布仍未通过。

### 扩大源码编译范围与构建阻塞（2026-10-22）

在同一固定 BASE 重放树上，另从40份补丁提取全部受影响 Java 文件，编译通过140份主源码
和82份测试源码。主源码覆盖 core24、jdbc7、queue1、webserver108，不再只检查协议子集。
此诊断使用宿主自己既有 executable、测试工具类和已缓存公开依赖，启用 Lombok；没有
生成 Micronaut bean/index，也没有执行 JUnit、PostgreSQL 或 HTTP，不是完整构建证明。

再次使用项目指定的 Gradle9.7.1、仓内可写 Gradle home 和只读依赖缓存尝试
`:webserver:compileTestJava`，构建在创建 `FileLockContentionHandler` 时被
`java.net.SocketException: Operation not permitted` 阻断，尚未进入任务执行。未通过禁用
安全限制或替换未验证产物绕过。诊断日志为重放树同名前缀的 `.all-main-compile.log` 和
`.all-test-compile.log`；完整构建失败报告保留在部署仓审查目录。正式发布门保持未通过。

消费项目为 `kestra-plugin-rbac`。维护者最新边界要求应用组、scope、支持登记、用户授予和业务存储归插件；本仓仅提供公开宿主机制和激活点。当前 `0363` 候选的 `JdbcApplicationDirectoryV1` 仍实现组 CRUD、scope 删除约束、内置/退役 ID、审批和 `oidc_application_group_*` 表；`ApplicationDirectoryCommand` 也属于组业务初始化。每次组业务变更都迫使宿主改 patch 和发布镜像，插件还需跨两套存储分步登记支持关系。这些源码和使用路径证明当前归属沿用了旧项目目录，不符合最新边界；不是标准 OIDC 基础设施例外。

裁决：停止扩展和发布上述宿主业务目录候选。组业务迁回插件，本仓只保留签发和校验需要的版本化只读状态投影及标准身份生命周期激活。现有 OSS 没有此输入契约，已有资源授权 V2 只能评估资源操作，不能作为 OIDC token/refresh 签发的当前组、client 支持和用户授予输入；已有声明副本只描述应用权限 key/name，也不能替代组成员与授予。

最小契约方向：宿主在已验证的 issuer、client、subject 和标准协议上下文中请求唯一投影 provider，取得明确组 ID、tenant、启用/撤权版本、scope 元数据、应用支持和用户授予。host 保持单一 issuer、共享端点、签名 claim 和严格 issuer/audience 校验；不提供业务 CRUD 或建组表。缺组件、重复组件、版本不符、错误目标、异常或数据不可用时，应用组签发与业务身份必须失败关闭。缺插件的配置 UI client 可以按已有裁决走标准协议零授权登录，但不得合成应用组授权；恢复组件后也不得把旧零授权会话自动提权。

插件需要的账号/client/安装前置从本仓最小公开协议服务取得，只暴露存在、有效状态、可登录性和安装审批前置，不暴露凭据或要求读取私有表。账号停用和密码重置需要通用安全 guard，组内最后管理员由插件业务判断。连接复用、锁顺序、并发一致性和异常回滚必须先冻结契约并由本仓最小假 provider 与插件独立测试分别证明，不读取相邻源码或编译真实插件验证宿主。

兼容和发布：不保留旧可写目录、组表、组 CLI 或转发 API；当前60份源码编译、16项纯契约和13项进程内探针是原候选的指定证据，不能证明职责迁移已完成。先宿主只读契约独立测试和正式发布，再插件使用正式 digest，最后 root 选择正式组合。此前本文件关于“宿主保存组目录、生命周期与 CLI”的候选段落均被本提案替代，保留作为调查记录，禁止据此交付。

### 最小接口与事务裁决（2026-10-21，设计已接收，候选部分激活、未发布）

2026-10-21 的职责纠正调查确认以下旧调用点，不能只删除 `0363` 业务存储后发布。2026-10-22 已替换签发和可信身份读取；账号与 client 生命周期的替换仍未完成，进度见本节后续记录：

- `OidcUserDirectory.authenticationChange` 直接注入 `JdbcApplicationDirectoryV1` 并调用 `guardSubjectDeactivation`。这使标准账号生命周期依赖具体组业务类；当前事务隔离为 `REPEATABLE_READ`。
- `OidcTokenService.applicationGroupAuthorization` 使用 `ApplicationGroupDirectoryState.forClient(Connection, clientId)`，又查询 `oidc_application_group_bootstrap.ui_client_id` 并读取成员 `firstPartyUi`。标准 UI client 的确认仍依赖组业务表和额外成员类别。
- `OidcTrustedIdentity.validate` 读取完整组快照、所有成员和用户授予，再在宿主内部寻找当前 client/subject。宿主所需信息只对应当前已验证的协议身份，不需要接收其他用户的授予或管理目录分页。
- `OidcOwnershipService.revoke` 在持有私有 ownership 锁后修改标准 client 状态。新生命周期机制必须覆盖此路径，并在取得 client 行锁及其他私有锁之前建立统一安全锁顺序。

裁决的公开面收窄为以下三个接口。名称和方法清单为本轮设计基线；它们还不是可供插件编译的正式 Java 产物：

| 接口 | 必需行为 | 明确边界 |
| --- | --- | --- |
| `ApplicationGroupProtocolProjectionV1` | 在宿主传入的事务 `Connection` 中，按精确 issuer、tenant、client、subject 和可选的 token 组 ID 返回当前组启用状态、组修订/撤权版本、该应用的 audience 与支持 scope 元数据、该用户获授 scope key | 只返回请求目标，不能提供组、scope、应用或授予的写入方法；不返回其他用户清单、`firstPartyUi` 或应用实际资源权限 |
| `OidcProtocolStateV1` | 提供事务内标准账号是否存在、启用和可登录，标准 client 是否有效及其协议注册，当前安装凭据与配置登录 client 的精确核对，以及统一安全锁入口 | 本仓读取自己的标准 OIDC 表和安装凭据；不暴露密码、secret、凭据哈希或组业务数据；插件不得自行查询这些私有表 |
| `IdentityLifecycleGuardV1` | 在标准账号停用、密码重置及 client 撤销/删除提交前，调用唯一启用 provider，并传递同一事务连接与明确变更目标 | host 执行标准变更和认证版本失效；plugin 在自己的目录和实际策略中判断最后管理员与业务约束；guard 拒绝或异常使整个标准变更回滚 |

`UserDirectoryV1` 继续负责已有账号 CRUD。新增 `OidcProtocolStateV1` 的理由不是重复该目录，而是它当前的 `find/list` 会另开连接，不能证明检查和生命周期变更使用同一事务。配置登录 client 由宿主标准配置和注册核对；它在应用组中仍是普通应用成员，不在插件成员模型中新增首方标志。UI selector 只控制标准登录请求中的 scope 选择，不授予任何资源权限。

统一安全锁入口使用事务级锁，不建立宿主组表。所有影响授权的宿主签发/refresh、账号认证状态变更、client 撤销，以及插件目录、实际策略和声明写入，必须先经同一已发布入口取得锁。执行顺序固定为：安全锁 → 插件目录锁 → 实际策略/声明锁 → 标准账号/client 行锁。不得在已经持有标准身份行锁后回调组 provider；不得在 provider/guard 内提交、回滚或关闭宿主传入连接，也不得打开另一个连接替代事务内标准身份检查。

变更事务使用 `READ_COMMITTED`。不能把当前账号变更的 `REPEATABLE_READ` 直接用于新 guard：第二个并发停用可能在等待目录锁前固定旧快照，从而再次看到刚被另一个事务停用的管理员仍然有效。实际读取和判断必须在取得安全锁后发生。已有纯只读账号分页可以保留自身快照策略。安全锁异常、超时、provider 缺失/重复、投影版本或目标不符，均不得继续签发或提交组相关变更；不通过重试未验证快照或读取旧缓存维持允许。

缺插件标准零授权 UI 登录仍按前述裁决单独处理。它不得产生应用组 claim，也不得接受带旧应用组 claim 的会话。组 provider 恢复后必须重新执行生产登录，不能自动给零授权会话补入 scope。协议投影对 scope 的上限仍为应用主动支持与该用户授予的交集；应用资源授权始终由应用自己的策略决定。

实施和验收门：先替换宿主上述调用点并删除旧组 DTO/可写目录/CLI/迁移表；使用本仓最小假 provider 验证签发、refresh、组 ID/epoch、scope 交集和 UI client 精确识别。再用真实 PostgreSQL 并发验证两个管理员停用、目录撤权与 refresh、client 撤销与 token 签发、guard 失败无副作用以及锁等待后的最新状态。插件独立验证自己的业务目录和最后管理员，不进入宿主 CI。接口与锁机制正式发布后才允许插件接线和编译，不能将本段设计或当前候选源码当作发布证明。

### 0370 候选源码与明确未通过门

`0370-oidc-protocol-projection.patch` 新增上述三个接口、协议值校验、`OidcProtocolState` 标准查询与事务锁实现，以及独立测试。投影只允许当前请求身份，精确核对 issuer/tenant/client/subject/组 ID，并返回支持与授予交集；集合不可变，未激活结果不能携带组身份。标准协议查询只返回账号状态/认证版本/可登录性和 client 的协议注册，不返回凭据；安装核对同时要求本地安装凭据、标准数据库安装 ID 和有效的配置登录 client。所有查询复用调用方连接，不提交、回滚或关闭该连接。

从固定 BASE 顺序重放42个补丁并编译65份相关宿主主源码通过。新投影5项纯契约测试、标准查询与连接所有权6项探针在最终重放树通过；7份新增源码与测试均逐字节核对为补丁重放结果。标准查询探针使用模拟 JDBC 和真实临时安装凭据文件，未运行真实 PostgreSQL，也未证明生命周期 guard 已经被调用。旧纯契约16项仍通过，只证明该重放树的指定既有断言。

`scripts/check-application-group-boundary.py` 已接入正式构建和本地 CI 的编译前阶段。它拒绝旧宿主业务目录、组表及缺少新协议机制的调用点，结构检查不替代授权行为测试。当前重放树实际被此门拒绝，旧 `0360/0363/0364` 业务目录和标准服务调用点尚未迁移。此候选不能发布，不能作为插件编译输入。证据树为 `.work/application-group-protocol-state-replay`，原始日志为同名前缀的 `.replay.log`、`.compile.log` 及树内 `protocol-tests.log`。

### 只读签发与可信身份接线（2026-10-22，候选未发布）

`OidcTokenService` 与 `OidcTrustedIdentity` 已改为消费 `ApplicationGroupProtocolProjectionV1` 和 `OidcProtocolStateV1`。这两个运行路径不再读取宿主组表、完整目录快照或成员 `firstPartyUi`。宿主从配置登录 client 的标准注册识别 UI selector；该应用在组中仍是普通成员。scope 上限只使用当前应用支持与当前用户授予的交集，并检查标准 client 的协议 scope 注册。混入未知或不可获得的 scope 必须整单拒绝。

应用权限声明副本只用于授权页展示。`applicationScopeDescription` 现在还接收已登录 subject，只展示该请求允许的 scope 元数据；权限 key/name 的副本、缺少副本或编辑副本不另行授予资源权限，也不成为独立的 scope 撤销开关。OAuth 流程的支持撤销以插件返回的当前应用支持登记为准。scope key、人类角色名和应用权限 key/name 保持不同概念。

签发、授权码绑定、refresh 和当前身份复查在明确的 `READ_COMMITTED` 事务中通过统一安全锁入口读取当前账号、client 和投影。旧授权码或 refresh 的组 ID/epoch 必须匹配；已经绑定的授权码不得重新绑定。缺投影 provider 或目录未激活时，只有经过标准注册核对的配置 UI client 可以取得标准协议 scope，且不产生组 claim。重复 provider、查询失败或错误投影不进入此分支。无组绑定的旧凭据在 provider 恢复后不能自动换取带组 claim 的凭据；已绑定组的凭据也不能在 provider 缺失时降格继续使用。

标准协议查询现在把 `legacy/pending/未知 kind` 的 client 视为不可用于当前授权。未配置 UI client 不影响标准账号/client 查询，但不能确认 UI 登录资格或安装资格，避免给不使用 UI 的标准 OIDC 场景增加启动配置前置。

检查结果：固定 BASE 的42补丁重放与65份相关主源码编译通过；可信身份10项、只读授权10项、MCP异步5项进程内探针通过，接口/标准查询11项探针也通过。MCP保留允许输出、等待时账号/epoch撤权、缺 HTTP 来源及主体错配检查。PostgreSQL签发4项和协议集成8项已改用本仓最小测试投影，保留真实签名、授权码消费、refresh撤权、无新增 token 行、单连接与标准注册上限断言；只完成源码编译，尚未运行。最小测试投影不证明插件业务存储或最后管理员已通过。

选择器辅助函数的布尔输入也已明确为标准配置登录 client，不再命名为首方应用；scope 输入明确区分已定义、应用支持与用户获授的 key。最终重放树为 `.work/application-group-protocol-activation-final-contract-replay`；原始日志为同名前缀的 `.replay.log`、`.compile.log`、`.test-compile.log` 及树内 `trusted-tests.log`、`protocol-tests.log`。17份激活/契约源码和测试均核对为重放结果。职责边界门仍明确拒绝旧组业务类/表，以及 `OidcUserDirectory`、`OidcOwnershipService` 未接入新生命周期机制的路径。完整 Gradle、PostgreSQL、HTTP/浏览器、正式 CI 和镜像发布均未通过，不得用本轮定向检查替代。

## 0. 当前认证裁定与实施门（2026-10-09，优先于旧记录）

### OAuth 错误回调安全处理（REQ-0367，已接收、未发布）

消费方在正式镜像的应用项目迁移中遇到真实 `invalid_scope` 回调返回 500。
Micronaut Security OAuth2 4.15.2 在错误分支先抛出
`AuthorizationErrorResponseException`，既有通用错误控制器将它处理为服务器异常。
0367 新增宿主内部专用错误控制器，不新增公开 SPI，不读取插件策略。

处理器仅接受 RFC 6749 授权错误，要求返回 state 与当前 cookie 中的完整 state 相等，
并调用框架 `StateValidator`。state 绑定的 redirect URI 必须匹配当前 callback；绝对 URI
精确比较 scheme、authority、path，相对 URI 精确比较 path。origin-form 请求使用
`HttpHostResolver` 的完整 origin，遵循部署的 Host/Forwarded 信任配置，不声称默认
resolver 能抵抗任意代理头。注册 redirect URI 的检查保留在发起授权链；处理器不查询
client 目录。UI 注册地址来自 issuer 加 `/oauth/callback/<client-name>`。

只支持已确认的 `CookieStatePersistence`，其他存储返回 400。有效错误返回固定同源
`micronaut.security.redirect.login-failure` 的 303，允许配置 `/oidc/login?error=1`。
只清除临时 state cookie，保留 JWT 和 IdP 会话，不回显 provider 描述或 state。
缺失、错配、未知错误或不安全失败 URL 均拒绝，错配不消耗当前合法 state。
cookie 清除证明正常浏览器重放被拒绝；不提供持有原 cookie 的服务端一次性保证。
成功回调的 PKCE、nonce 和 token 校验路径保持原契约。

源需求提交为 `4b99df01c211dab20af8a961ae2086aec012c72e`，实现关键提交为 `6affe5f`。
宿主独立 HTTP/边界六项已通过且无失败或跳过，最终 BASE 全部 39 个补丁顺序重放通过，
测试源码与重放源码逐字节一致。宿主 CI 和发布尚待通过；部署仓还必须验证真实登录、
错误回调、现有合法会话保留及安全拒绝。

**生产审计修复契约（2026-10-11）**：invalid_scope/resource/owner 等拒绝不能消耗
原 refresh，轮换并发仅一次成功；pending quota 饱和返回 429，数据库故障仍 503。
confidential client 服务端仅保存版本化哈希，UI client 配置仍持原 secret；迁移旧
明文后不回退明文存储，public 空 secret 语义不变。实现和 PG 回归同批。

当前已交付：0150/0160/0170/0180/0190补owner/pending/consent、MCP资源认证、能力门、
OAuth-only与管理/DB限速；详见mcp-oauth-integration.md与README配置/API段。
扩大镜像门覆盖生产创建B用户、真实第二server、撤销后已有session/refresh及RBAC缺bean；
异常 Authorizer 由真实 handler→gate→queue 单元路径验证，非生产外部 jar。
协议、MCP 与两种首次安装浏览器镜像门已通过真实 CI。

**最新用户归属裁定（维护者多轮澄清，优先于下述已交付记录）**：选定“DCR 返回
短期 pending client_id→浏览器登录确认→原子绑定用户 owner→授权码/token→以该
用户调用 MCP”。正式动态 client 不共享、无管理员特例；另一用户不得授权、使用
或管理。拒绝删除 pending，超时清理；额度分 pending 全局与正式用户维度。
完整可行性、标准衔接、抢占边界、数据隔离及实施门见
[面向集成方的 MCP OAuth2 文档](mcp-oauth-integration.md)。历史REQ-0134仅全局public
DCR；当前0150/0190已增加pending/owner/consent与管理，不宣称外部RBAC数据隔离。
MCP 认证面已由维护者重新接收并交付（OAuth2-only，删除 Basic Auth），
不得将旧“MCP 全面除外”覆盖此裁定；具体动刀仍须消费仓/BASE 行为证据与验收定稿。
**能力/资源授权最新分层**：本仓预制 MCP 资源大类 read/write/delete scope 门，
write 不含 delete，用户二次授权只能收窄，执行门独立于外部 RBAC。R-EE-RBAC
启用后必须覆盖全部现有 MCP 工具/子操作/异步执行，与 REST 统一主体、资源、动作
判定；scope 与 RBAC 同时允许才执行，组件异常失败关闭。具体权限模型留在扩展仓。

**REQ-0134 动态 public client 注册（维护者接收）**：标准 OAuth2 动态注册
RFC7591/OIDC Registration，不新增 MCP 专属端点。公开 MCP/桌面/浏览器消费方
不持有 secret：POST `/oidc/register`，`token_endpoint_auth_method=none`，仅
authorization_code/refresh_token、response_type=code、openid/profile/email，强制
PKCE S256，随机不可预测 client ID，返回 201、无 client_secret，discovery 广播
registration_endpoint。注册以 `kestra.oidc.registration.enabled=true` 显式启用，
默认关闭；允许匿名注册时部署侧限制请求速率，服务端限制元数据长度、回调数和
注册总量（默认 1000，含现存 client，并发不能绕过），不信任客户端角色/租户声明。
回调仅 HTTPS 或 loopback HTTP（localhost/127.0.0.1/[::1]），禁止 fragment、
userinfo、通配符与非 loopback HTTP；精确回调匹配不放宽。元数据不得触发远端抓取。
首次初始化必须完成后才能注册，完成标记异常失败关闭。不交付 RFC7592 管理 API。
验收从生产首装路径开始：注册 public client→S256 登录授权→无 secret 换三件套→
userinfo，缺/错 verifier、空 challenge、非法回调/授权类型、quota/并发与关闭门拒绝。

**第三方验收缺陷收尾**：完成状态过滤器先于 setup body 绑定，空/坏 body 的 POST
统一 404；显式空 code_challenge 返回 400（缺席仍遵守 confidential/public 规则）；
部署白名单健康端点使用 `/ping`；README 区分 IdP oidc_session 与应用 JWT/Bearer。

**REQ-0133 首次安装引导（维护者授权，实施前契约）**：空目录首次访问 UI 进入
`/oidc/setup`，设置用户名、显示名、邮箱和密码；存入 OIDC 用户目录（bcrypt），
同时按配置注册本实例 UI confidential client，随后进入完整 OIDC 登录链。
UI client 名称默认 `kestra`，ID/secret 从 Micronaut OAuth2 客户端配置取得，回调
由公开 issuer + `/oauth/callback/<name>` 推导；不预置公共默认密码或固定 secret。
镜像支持 `KESTRA_OIDC_BOOTSTRAP_USERNAME`、`KESTRA_OIDC_BOOTSTRAP_PASSWORD`、
`KESTRA_OIDC_BOOTSTRAP_EMAIL`、`KESTRA_OIDC_BOOTSTRAP_NAME` 环境变量跳过表单；
username/password 必须成对，email/name 可选。仍须配置 UI client ID/secret/issuer。
变量只用于首次初始化，重复启动不覆盖密码/client；初始化完成状态持久化，即使
删空用户也不重新开放匿名 setup。已有用户部署视为已初始化，保留账号与 client。
初始化事务涵盖账号、bcrypt 凭据、UI client 和完成标记，数据库串行锁防并发首建；
失败回滚、错误不回显密码/secret；已有冲突 client 不可静默覆盖。
表单 POST 必须校验短期 CSRF token 与同源请求，初始化后 setup GET/POST 关闭。
验收同批：空库引导、环境变量跳过、坏/部分配置、并发一次成功、重启不覆盖、
完成后拒绝 setup、真实 OIDC/token/UI 登录与刷新；镜像不得依赖人工 SQL 才能首登。

**REQ-0133 再审加固（维护者追加，实施前）**：首次初始化身份同时绑定数据库标记
与独立持久化安装凭据（默认 `/app/storage/.oidc-installation`，部署侧卷）。二者
任一存在均不得重新创建首个账号；身份不一致、凭据损坏或凭据存在但数据库标记缺失
一律失败关闭，不退回匿名引导。数据库标记存在但凭据缺失时只重建对应凭据，不改账号。
写凭据在数据库提交之前完成；中断遗留凭据表示待人工恢复，不能自动重启初始化。
凭据格式/大小/符号链接/权限检查；CSRF、Origin、并发串行与原子事务继续强制。
可用 `KESTRA_OIDC_SETUP_ALLOWED=false` 显式封闭网页首装（环境变量初始化仍可用）；
完成后必须持久保存独立凭据卷，禁止将删除数据库标记视为重新安装操作。
验收增加：删除数据库标记、删除凭据、损坏/替换凭据、并发重入、完成后重新 POST、
失败事务留下锁存凭据、重启与环境变量再次注入均不激活。仅凭一个可删数据库字段
不得决定安装是否可用。拥有数据库和凭据卷的同时管理权限仍属于部署信任边界，
需由部署权限与显式禁用配置封闭；镜像不能声称能抵抗同时重置全部持久化状态。

维护者裁定：OIDC 模式下完整关闭 Basic Auth 认证链。后端过滤器、凭据登录/退出、
前端路由守卫、401 跳转、setup 引导与退出统一使用 OIDC；不兼容 BASIC_AUTH 或
kestraBasicAuthenticated，不伪造旧登录标志。OIDC 未启用时保留 vanilla 行为。
内置 OIDC 登录页可以复用上游 Basic Auth 页面外观，提交仍验证 OIDC 用户目录，
随后完成真实授权码/PKCE/token/callback。认证主体由服务端验证，前端不得自证登录。

UI patch 例外已写入 AGENTS §2：仅限本认证链替换与登录外观，保留其他 BASE UI。
实施需求 REQ-0132（认证模式替换）；归属 = R-OIDC-SERVER，协议基础设施 patch 路线。
上次 CI 37911602095 全绿仅证明首轮 HTTP 流程，未覆盖刷新/导航；不得引用其作为
完整前端认证已完成的证据。当前问题已证实：BASE UI 忽略 oidcAuthEnabled，
仅检查 Basic Auth 标志；框架重读 ID token 时调用 userinfo 返回 401 也须闭环。

实施顺序：先固定本文/差异表/机制/README/manifest 的新契约，再在 BASE 开发树
按增量提交法实现；实现与验收同批生成 patch；重放全部 patch 后测试与构建。
验收必须包括：匿名 UI/API 拦截、坏凭据拒绝、用户名密码登录、PKCE/state/nonce、
真实 token 签发、首次 UI 渲染、刷新 dashboards、再次导航、认证 API、过期/无效
cookie 后重认证、退出同时清应用与 IdP 会话、退出后 UI/API 拒绝；OIDC 模式
Basic Auth 登录/退出端点不得认证或改变会话，旧 Basic Auth cookie 不得放行。
UI 认证检测通过服务端受保护端点，401 后进入 OIDC 客户端；避免 SPA Basic Auth 登录页。

REQ-0133 实现引导与环境变量一次性初始化；旧 `kestra.oidc.users` 预留模型不使用。
首个 UI client 自动按客户端配置注册，无需人工 SQL。用户管理 API 仍待独立实施。

REQ-0132 实施证据：UI 不再在 OIDC 模式检查旧标志，受保护 `/configs` 成功后
更新内存状态；刷新重新验证，401 进入框架 OAuth2 客户端。旧 API 登录/退出/setup
由服务端拒绝；内置 logout 同时撤销 IdP 会话并清 JWT cookie。新增后端禁用测试，
前端测试验证旧标志不能认证；黑盒覆盖刷新、导航、旧端点、无效 cookie、退出。
ego-browser 已实测无旧标志时 dashboard 刷新、Flows 导航及 API 200；logout 后
重新出现 OIDC 登录表单且 API 401。此前 userinfo 401 是框架对 ID token 尝试
access-token userinfo 验证的回退日志，本轮有效 JWT 刷新实测仍通过，不放宽 userinfo。

> **状态**：首批 patch 已实施并本地全绿（2026-10-09，REQ-0100/0110/0120/0130；
> 8 测试类 36 用例，Testcontainers 真 PG + 验证树 5-patch 重放 + executableJar 全绿）。
> 浏览器链修复（2026-10-09）：REQ-0120 统一 `from` 回跳；REQ-0130 登录 POST 后
> 303 转 GET、浏览器经配置进入框架 OAuth2 客户端；REQ-0131 内置 issuer 的 discovery
> 直接复用生产元数据，避免启动监听前本机 HTTP 请求失败。原版 UI 必须随 jar 打包。
> REQ-0132 本轮全重放：44 后端用例、2 前端用例、UI 构建与 executableJar 全绿。
> 剩余：REQ-0140（用户管理端点 + F1/C3/F2 专项）。浏览器链最终验收以新 CI 为准。
> 本轮本地证据：6-patch BASE 重放、42 定向用例、原版 UI 构建、executableJar，
> 协议黑盒 30 PASS；UI/OIDC HTTP 链黑盒全绿；ego-browser 实测 localhost:8080
> 输入 tester 后显示 Overview，认证 cookie 请求 `/api/v1/configs` 返回 200。
> REQ-0133 同批增加 10 个首装/环境变量/事务并发/CSRF 用例（总 54），镜像黑盒
> 分别从空库走真实安装表单与环境变量跳过；真实 OIDC 登录/刷新/导航/退出/重启
> 验收。CI Chromium 直接填写首装表单，测试不再用 SQL 预置首个用户与 UI client。
> 再审加固后总 61 后端用例：删除数据库标记/用户、删除或替换文件、权限/符号链接、
> 中断事务锁存、显式封闭网页首装。镜像门额外验证容器重建后注入不同初始化账号无效，
> 删除数据库标记返回 500、删除文件只恢复原身份、替换文件失败关闭。
> 维护者追加一致性要求：旧协议镜像黑盒也改为环境变量生产初始化，移除用户/client
> SQL 预置；UI 黑盒分别由 Chromium 安装表单或环境变量从空库初始化。保留的 SQL
> 仅用于读取证据与模拟删标记攻击，不用于绕过首装。README 提供 kestra.environment
> 直接填值示例，不再包含首次手工 psql 指南。
> **归属**：`docs/oss-ee-gap.md` §2-A/§4 R-OIDC-SERVER 行的展开；宪章依据 AGENTS §0 归属
> 例外、§2 三处例外、§3-7、§4 测试同批。
> **一句话**：以 patch 路线在 webserver 内内置 OAuth2/OIDC 授权服务器 + 认证链（一体化），
> 让 kestra 无需外部 IdP 即具备完整 OIDC 认证；外部 IdP 场景走同一内置链的配置。

### 认证页面主题兼容（REQ-0132 / REQ-0310）

本节定义本次修订的实现与验收要求；是否已发布以对应提交 CI 和镜像发布门为准。
独立渲染的 `/oidc/login` 与宿主内的 `/ui/access-denied` 使用宿主的主题选择：
`light`、`dark`、`dark-2`、`syncWithSystem`。登录页在首屏绘制前读取同源
`localStorage.theme`，不改写偏好。拒绝页直接消费宿主语义颜色变量；登录页只携带固定
BASE 设计系统的必要颜色，不装载业务配置、身份或权限数据。

登录页的偏好缺失、值未知或浏览器禁止存储时跟随系统；系统偏好变化时更新配色。
脚本不可用时，CSS 媒体查询提供系统配色。背景、文字、输入框、错误提示、按钮及键盘
焦点必须兼容主题。主题处理不得改变凭据验证、表单提交、回跳检查或会话撤销。
风格统一按页面用途取舍元素；拒绝页不复制登录页的 K 字母标志。

`scripts/auth-theme-cases.mjs` 是本地 Ego 和宿主 CI Chromium 共用的浏览器矩阵。
两种屏幕宽度均检查主题实际颜色、文字对比度、键盘焦点、横向溢出和拒绝页无标志；
登录页另检查偏好缺失、未知值和存储不可用的回退。CI 保留 JSON 报告，既有错误密码、
生产登录、刷新、导航和退出测试继续执行。零授权账号退出换号由部署仓组合验收。

### 认证页面国际化（REQ-0320）

本次修订复用固定 BASE 的 `vue-i18n`、`translations/i18n.ts`、`languages.ts` 和
现有 JSON 翻译目录。拒绝页使用 `errors.403.title`、`errors.403.content` 和 `setup.login`。
独立登录页通过 Vite 入口 `/ui/assets/oidc-login-i18n.js` 装载同一翻译机制，读取宿主保存的
`localStorage.lang`；缺失、不支持或不可读取时使用英文。页面标题、标签、按钮、错误
提示和 HTML 的 BCP 47 语言标记同步更新。表单字段名、提交路径、回跳校验和认证逻辑不变。
入口只翻译页面，不启动业务 UI，不读取业务配置。无脚本时保留可提交的英文表单。

现有 `setup.login_title`、`setup.form.username`、`setup.form.password`、`setup.login`
及 `setup.validation.incorrect_creds` 覆盖登录文案，无需新增翻译键。不得在 Java 中
维护平行翻译表；今后确需新增文案时进入上游同类翻译源、生成和检查流程。
`scripts/auth-i18n-cases.mjs` 由本地与 CI 复用，核对全部 13 种语言在桌面和窄屏的
实际文案、页面标题、语言标记和溢出。测试预期来自固定 BASE 的既有翻译，不作为产品资源。

全量上游翻译检查另发现既有 MCP 定制键 `mcp.built_in_oidc_hint` 缺少非英文翻译，
且它与 `mcp.no_oauth_providers` 的生成指纹未同步。本次页面复用不新增此缺口；
完整检查未通过不得表述为全量国际化检查通过。处理新增翻译需按上游生成机制执行。

## 1. 裁定记录（全部 2026-10-07，维护者）

| # | 裁定 | 依据 |
|---|---|---|
| 路线 | 定位为预留扩展点，**patch 路线**（区别于 jar 路线的外部扩展实现） | 协议稳定 + 实现标准 ⇒ 大粒度仍为薄层；「overlay 先行，jar 路线跟随」 |
| 前置② | **链一体化**：认证链与服务器同进 patch；`kestra-auth-chain.jar` 契约行已退役；外部 IdP 场景由内置链经配置指向 | fork 实证（同模块）；上游 M 面 OIDC 相关仅 MiscController=REQ-0011 |
| 前置③ | **持久化 = 同 datasource 新表（postgres 起步）**；migration 进 patch（源码级 MigrationScript bean + SQL 成对）；h2/mysql 留待需求 | fork 实证（19 个 postgres migration）；Testcontainers 真 PG 测试形态 |
| 前置① | 宪章修订已落地（commit `021ba1b`）：§0 归属例外/§2 三处例外/§3-7/§4 测试同批/§8-1·2 注记 | 防实施期 agent 读旧条款出幻觉 |
| 前置④ | **已闭合**：§5 安全清单即验收基准（测试先行铁律，随各需求同批落地） | 维护者「写好 CI 测试再实施」 |

## 2. fork 参考协议（会话内维护者解禁，用途限定）

- **路径**：`/Users/xuybin/dsh-monorepo/app-kestra`（仅此子模块；其余 dsh-monorepo 不读）。
- **归因口径与用途边界（2026-10-07 修正）**：merge-base `f6dbbb49fe02ac18d2be88419df33083cf8a7256`
  （相对 `upstream/develop`）圈定 fork 定制面。**两基分叉**（v2.0.5 @ 172dd0f3 与该
  merge-base 互不为祖先，基间 webserver/core/cli/jdbc 演进 278 文件 +10595/-1628）⇒
  定制 diff **只作规格参考**（端点/职责/表结构/测试语义），**禁止直接 diff 成 patch**
  ——移植走 AGENTS §5.2「跨基移植规则」（漂移清单 + BASE 重写 + 逐文件核对，陷阱 #9）。
- **纪律**：只作 `[dsh]` 证据与移植底稿，**不作路线图**；移植后漂移核对（§7）；
  判断依据只落差异表行 + 机制证据。

## 3. fork 证据摘要（R-OIDC-SERVER 实施底稿）

**形态**：顶层 `oidc-provider/` 模块 = 43 主文件（`io.kestra.oidc`：10 controllers +
11 services + 19 migration bean + config）+ 12 测试文件。fork 用 settings.gradle 模块
include 装配——**我们不采用**（trap-#1）：patch 路线直接进 webserver 模块，零 include。

**上游 M 面（OIDC 相关）**：仅 `MiscController` = REQ-0011（本仓已实施）⇒ patch 化的
M 面预估 ≈ 零，全部为新文件。

**类清单**（controllers）：`OidcDiscoveryController`（RFC 8414/discovery）、
`OidcProviderController`（authorize/token）、`OidcLoginController`（UI 登录）、
`OidcUserAdminController`、`OidcAuthorizationExceptionHandler`（未认证→登录重定向）、
`OidcRedirects`；（services）：`OidcAuthorizationCodeService`/`OidcClientService`/
`OidcJwkService`（JWKS）/`OidcSessionService`/`OidcTokenService`/`OidcUserService`/
`NimbusHttpAdapter`。

**依赖清单**（→ webserver/build.gradle 增 5 行，宪章 §2 唯一例外；漂移清单核定后由 4 行上调）：
`com.nimbusds:oauth2-oidc-sdk:11.38.2`、`org.mindrot:jbcrypt`、
`io.micronaut.security:micronaut-security-oauth2`、`micronaut-security-jwt`、
`io.micronaut.data:micronaut-data-connection-jdbc`（migration 走 DelegatingDataSource，
fork webserver/build.gradle 同款加法）。

**持久化**：19 个 postgres migration（用户 schema、client〔含 public/active〕、machine
identities、role assignment、secret schema、多个 redirect 修正）；bean 继承
`AbstractSQLMigrationScript`，bean+SQL 成对。

**测试底稿**（移植核对，缺则补）：`OidcAuthorizationCodeFlowTest`/
`OidcClientCredentialsFlowTest`/`OidcIntrospectionTest`/`OidcJwtSignVerifyTest`/
`OidcClientServiceTest`/`OidcUserServiceTest`/`OidcUserAdminServiceTest`/
`OidcSessionServiceTest`/`OidcBearerAuthFilterTest`/`OidcLoginControllerTest`；基建
`OidcPostgresTestBase`（Testcontainers 真 PG + 施放生产 migration）。
另 webserver 侧 `DshAdminAuthorizerTest`/`DshNativeEndpointGuard*Test` 属授权线
（R-EE-RBAC 未来底稿，不随本项目移植）。

**剥离清单**（不移植，头部「手工适配」须声明）：`DshSecretAdminController`/
`DshSecretService`/`PostgresSecretStore`/`DshNamespaceService`；`OidcRedirects` 的客户
专属 redirect；migration 中 dsh 专属（dsh-ui-redirect/dsh-pc-web×2/nacos-logout/
tailscale-nipio/dsh-secret×2）；**MCP 面（`OidcMcpOAuthController`/
`OidcMcpBearerAuthFilter`——首批移植时排除，后续 MCP 认证重新接收须重新推导）**；AI 保留面。

## 3.5 API 漂移清单（动刀前第一工件，2026-10-07 完成——方法见 §2 跨基规则）

**类级**（剥离 MCP/Secret/Namespace 面后，剩余移植面的上游依赖仅 3 类）：

| 依赖类 | v2.0.5 | 档 |
|---|---|---|
| `io.kestra.jdbc.migration.AbstractSQLMigrationScript`（19 个 migration bean 的基类） | 存在（jdbc 模块在用） | ✅ 直接可用 |
| `io.kestra.core.tenant.TenantService` | 存在（S2 桩，恒 `main`） | ✅ 可用（桩语义已知） |
| `io.kestra.core.serializers.JacksonMapper` | 存在 | ✅ 可用 |

归因注：`EncryptionService`/`EncryptionConfig`/`FlowMetaStoreInterface`/
`DefaultNamespaceService`/`QueryFilter`/`ArrayListTotal`/`McpServer(Cache)` 的引用
**全部来自剥离面**（`PostgresSecretStore`/`DshSecretService`/`DshNamespaceService`/
`OidcMcp*`）——剥离后不进入移植面。

**框架级**：

| 轴 | fork（develop 基） | v2.0.5 | 档 |
|---|---|---|---|
| Micronaut 平台 | 5.1.5 | **4.10.18** | ⚠️ 代际适配轴（主要注意力所在） |
| Jackson | 平台是 Jackson 3，但**本模块 import 全部为 Jackson 2**（`com.fasterxml`，零 `tools.jackson`，实测计数 5+4） | Jackson 2 | ✅ 同代，无需改写 |
| micronaut-security import | 仅 3 个：`Authentication`/`AuthorizationException`/`JwtTokenGenerator` | 4.x 均有 | ✅ 稳定 API |
| micronaut-data | `DelegatingDataSource`/`Pageable` | 需加 `micronaut-data-connection-jdbc` 依赖（已入依赖清单） | ⚠️ 随依赖行解决 |
| 其余 Micronaut import | http/context/core/scheduling 稳定面（Controller/Filter/@Replaces/@Requires 等） | 4.x 同名 | ✅ |

**结论**：无 ❌ 档（无需替代实现）。主要适配注意力 = Micronaut 4↔5 的**行为差异**
（注解处理/bean 装配细节），由双锚验证兜底（§6 步骤 4：测试全过 + 逐文件漂移核对）。

## 4. 持久化设计（前置裁定③展开）

须持久：**用户、client 注册、JWKS 签名私钥**（重启换钥 = 已发 token 全失效 + 客户端
JWKS 缓存撕裂；轮换走双钥并存期）。免持久：access token（JWT 无状态）、auth code
（短命，单机内存）。表结构以 fork migration 为底稿，剥离 dsh 专属后按需求拆分。

## 5. 安全专项清单（**已闭合 = 验收基准**；各用例随所属需求 patch 同批落地，门绿为准）

| # | 类别 | 用例 | 来源 |
|---|---|---|---|
| A1 | 协议流 | 授权码流全链（discovery→authorize→token→userinfo） | fork 移植 |
| A2 | 协议流 | PKCE（public client 强制；错 verifier 拒绝） | fork 核对，缺则补 |
| A3 | 协议流 | client 凭证流 | fork 移植 |
| A4 | 协议流 | token introspection | fork 移植 |
| B1 | 密码学 | JWT 签发/验签 | fork 移植 |
| B2 | 密码学 | `alg=none` 拒绝、算法混淆攻击拒绝 | 新增 |
| B3 | 密码学 | JWKS 轮换（双钥并存期，旧 token 不撕裂） | 新增 |
| C1 | 凭证 | client secret 校验失败 401（不泄露存在性） | fork 核对 |
| C2 | 凭证 | 口令 bcrypt 哈希存储（库内无明文断言） | 新增 |
| C3 | 凭证 | 日志与错误响应不泄露 secret/code/token | 新增 |
| D1 | 会话 | auth code 一次性（重放拒绝）+ 短 TTL | fork 核对 |
| D2 | 会话 | session 生命周期 / logout | fork 移植 |
| E1 | 重定向 | `redirect_uri` 精确匹配（开放重定向防护，含子串/后缀伪装变体） | 新增（fork 有 self-redirect 修正 migration，测试固化待核对） |
| F1 | 暴露面 | 匿名可达面最小化（discovery/JWKS/authorize 匿名；token 需 client 认证；管理端点 401） | 新增 |
| F2 | 回归 | 未启用该功能时行为与 vanilla 逐字节一致 | 新增（本仓铁律） |
| F3 | 回归 | REQ-0011 语义保持（内置服务器形态下 `oidcAuthEnabled` 取值） | 新增 |
| G1 | 基建 | 全部测试跑 Testcontainers 真 PG + 生产 migration | fork 基建 |

## 6. 实施顺序（定稿后执行）

1. ~~API 漂移清单~~ **已完成**（见 §3.5：类级全 ✅、框架级仅 Micronaut 4↔5 代际轴 ⚠️，
   无 ❌ 档；依赖清单由此定为 5 行）。
2. ~~临时实施文档~~ 见 `.work/impl-plan.md`（仓外，完成即删）。
3. **开发树重写**：`.work/dev` 树（v2.0.5）按 §5.3 增量提交法逐需求重写
   （来源标注：「参考 fork 实现逻辑重写（跨基）」；依赖行随首个需求 patch；
   头部按 §3-7 四条件）。
4. **本地全链循环到完美**：`scripts/local-ci.sh` 在 `.work/verify` 树重放 patch →
   定向测试（Testcontainers 真 PG，需 Docker）→ executableJar；双锚验证：安全清单 §5
   全用例过 + **逐文件**漂移核对（diff 归因于基差或剥离项，不留抽样）。
5. 本地全绿 → 组织 patch 提交推送 → 真 CI（定向门 + apply 链 + 镜像 + 镜像级黑盒）
   全绿为 DoD；差异表 §2-A/§4、manifest、README 运行线随实施状态同步。

## 登录账号目录公开契约（2026-10-15）

**状态：REQ-0350 已正式发布（2026-10-15）。** 宿主 `8d46953` 的 CI `38732224758`
全部通过并推广镜像 `sha256:f2b2cb7fc3bb3286148dbdce8a5e6bc70c59e152e74a3d42079e26cd0c169253`。
实际下载的两种首次安装目录 HTTP 报告各 22 项通过，无失败。该结果只证明宿主机制，
不替代插件管理 API 和部署组合验收。消费项目 `ai-specs/kestra-plugin-rbac` 要在自己的
用户管理页面列出、创建、编辑、停用登录账号及重置密码，并单独管理插件授权绑定。
宿主负责账号真实性、凭据和会话；插件负责管理操作授权、页面及角色绑定，不直接访问
宿主目录表。历史 REQ-0140 待项不是发布或本次自动接收的证明。

### 实际缺口与现有机制

固定 BASE `172dd0f37` 加本仓补丁后，`oidc/controllers/` 只有协议、登录、首装、动态
client 注册与 owner 管理控制器，没有用户管理控制器。`services/OidcUserService` 有
list、create、setPassword、updateUserState、delete 等内部方法，发布 executable 也有
这些类，但 README 未定义独立扩展可消费的目录 SPI。内部 `public` 不等于公开契约。
首装完成后 setup 关闭，不能用于后续账号创建；owner client API 不能管理账号。

另一个具体失败路径：当前内部 create 使用 `ON CONFLICT DO NOTHING`，之后独立调用
setPassword。若直接包装为管理创建接口，重复账号可能被更改密码；两个连接也不能保证
用户及凭据原子创建。故不得将该方法直接宣布为已可用管理接口。

本仓 `scripts/directory-probe/` 已直接调用正式发布宿主 jar，并应用 jar 内实际 SQL 到
独立 PostgreSQL：重复 create 改变旧密码，setPassword 后 IdP session 和 access token
仍有效；停用拒绝密码与 access token，但 session subject 仍存在，重新启用恢复旧 token。
主控亲自运行并核对结果。session 查询不是完整 HTTP authorize 证明，UI JWT、refresh
和完整 MCP 链仍须生产测试；本证据不能写成完整认证漏洞或目录交付。已发布基线为
CI `38686689513` 的镜像
`sha256:878be36bcb1a2d15266f6c7c05921f77d836136604bd956a5318671c2f34186c`；此基线
证明协议与首装能力，不证明目录管理交付。

### 候选最小契约与职责

建议新增版本化 `UserDirectory` Java SPI 与稳定 DTO，通过发布镜像取得编译类型，
避免同源 HTTP 回环和跨服务凭据传递。SPI 只提供分页 list、detail、原子 create、
资料 update、active 状态更新、password reset。返回稳定 subject、登录名、显示名、
邮箱、状态、revision 和必要诊断，不返回密码／哈希／token。首期不改登录名、不物理
删除、不提供任意可信 roles 编辑。当前 subject 等于 username，身份复用风险必须在
未来删除／重建能力接收前解决，不能由插件猜测 UUID。

新账号默认不附加 admin 等管理声明，角色绑定留在插件。密码校验复用首装长度／字节
边界，create 与凭据在同一事务中写入，重复登录名返回 conflict 且不改变原账号密码。
修改按 revision 比较，非法状态／不存在／冲突／存储故障有稳定的类型化失败，敏感
错误不回显密码或底层 SQL。不得暴露 storedPasswordHash 一类测试内部方法。

SPI 是服务器内受信 classpath 能力，不代替调用者鉴权。插件控制器必须先经过宿主认证、
CSRF 和统一授权门，插件再要求当前实例管理员。普通用户不得通过可见页面访问目录。
宿主不依赖插件角色模型，不为业务扩展增加匿名 `/oidc/users` 接口。如果后续采用 HTTP
管理面，必须重新明确认证与 CSRF，不能继承 README 的 `/oidc/**` 匿名规则。

停用／密码重置必须定义对既有 UI JWT、IdP 会话、access/refresh token 及 MCP session
的失效语义。建议在持久目录维护认证 revision，校验入口拒绝旧 revision；具体激活点须
先追踪框架 JWT 恢复和所有 token/session 校验路径再裁决。不能只阻止下一次密码登录
就声明账号已停用。宿主只处理认证有效性，插件授权绑定保留并在恢复账号时明确展示。
受保护账号、允许自助修改的范围和最后管理员防锁死均由消费项目授权规则决定。
本目录不得接收角色名、管理员清单或应急账号配置来执行这些业务判断，也不得从
任意调用者传入的字段推断可信身份。消费项目负责鉴权与受保护账号检查，宿主负责
原子写入、revision 冲突和认证失效。没有跨项目数据库事务的承诺。

### 接收、兼容与检查

这是标准协议之外的目录管理面，现有协议基础设施 patch 例外不自动覆盖全部 CRUD。
实施前必须按入口 B 明确接收窄化的公开目录适配能力及必要认证失效激活点；若需要
超出薄适配的业务实现，应收窄提案，不能借用历史 REQ-0140 扩大范围。

主控依据独立目录探针接收 REQ-0350：宿主公开 UserDirectoryV1 与唯一内置 OIDC 适配，
支持分页／详情、原子创建、资料更新、状态变更和重置密码；不暴露管理 HTTP 端点，
不包含授权绑定、受保护账号或业务页面。subject／登录名不可改，重复 create 返回冲突
且不改原密码；资料／状态使用 revision 乐观锁；不得返回密码、哈希或 token。
密码采用与生产首装相同的长度／UTF-8 字节边界，新账号无管理角色。

认证失效先复用已有 ACTIVE 与 token 撤销检查，再补用户认证版本以覆盖 UI ID-token
cookie 和 IdP session：停用或重置原子推进认证版本，旧 token/session 不匹配则拒绝，
重新启用不得复活旧凭据。旧账号迁移默认版本为 0；缺失版本的旧 token 只在账号仍为
版本 0 时兼容，发生认证变更后必须拒绝。资料编辑不撤销登录。外部 issuer 身份不得
错误地当成本地目录账号。必须验证内置正常登录、外部 issuer 兼容范围、关闭 OIDC
回归、数据库异常失败关闭和全部已存在会话链。此接收不增加目录业务授权或一般 UI patch。

本候选与角色／授权管理线路独立。目录 revision、JWT 校验激活点和升级 migration 先
调查已有机制，再明确最小适配面；不能预先认定必须新增认证 revision 列。必须比较
已有账号状态／token 撤销机制与 revision 方案对 UI、IdP、access/refresh 和 MCP 的
覆盖及额外查询成本；缺一条校验链都不能声明账号停用交付。

无消费扩展时不增加用户管理 HTTP 暴露面。没有 provider、多个 provider、版本不符或
数据库异常时失败关闭，插件显示功能不可用，不直接读表或退回旧内部服务。升级保留
已有账号和安装凭据，不重开 setup；新增 revision migration 必须有向前升级和旧 token
处理策略，先发布宿主再由插件独立消费。

宿主独立测试必须覆盖原子创建、重复创建不改密码、并发更新冲突、分页与总数、非法
输入、故障回滚、无敏感字段、账号身份稳定和升级；真实登录后停用／重置，验证既有
UI、IdP、access token、refresh token 和 MCP session 拒绝，新增密码登录行为正确。
插件使用公开测试替身独立验证管理权限和错误转换；部署仓使用发布产物从真实 UI 创建
账号、零授权登录、授权绑定、撤销及退出换号，并比较拒绝前后目录与策略状态。
仅源码有方法、编译成功或原 OIDC CI 通过，都不能替代本契约的发布和组合验收。

### 应用组签发与目录契约重构提案（部分已发布，目标未交付）

消费项目为 `kestra-plugin-rbac`。用户需要按应用组授予用户 scope，并由应用主动登记支持范围；OAuth2 授权页需要展示该应用对 scope 的权限声明名称。旧发布 `ApplicationDirectoryV1.ScopeDefinition` 只有 `scope/description`，`ClientMembership` 只有 `allowedProjectScopes`，签名身份 claim 使用 `kestra_project_v1/project_id/project_scopes`。`0361458` 的正式 CI `39453574911` 已通过，并发布镜像 digest `sha256:f42f4bc98b419e59f165287ea460f0f9900a33ae76562784e9bbe2d5d6e11881`；该版本增加 scope `name`、声明只读 SPI、新 claim 和部分在线复查，但仍保留旧项目对象、意图字段与恢复机制。证据入口为 `patches/webserver/0360-application-project.patch`、`0362-application-project.patch` 和 `0363-application-project.patch`；不能把该镜像描述为应用组目标模型已交付。

裁决：保持单一 issuer、共享 discovery/authorization/token 和标准 `iss` 精确校验。将宿主共享目录的公开身份对象改为应用组、scope `key/name/description`、应用成员支持的 scope key 与用户 scope 授予；签名并验证 `kestra_application_group_v1` 私有 claim。scope 的权限声明 `key/name` 是消费扩展管理的应用元数据，宿主只通过最小只读公开 SPI 在授权页获取展示投影和当前支持范围，不读取插件策略、完整 grants 或数据库表。未安装声明提供者、多个提供者、版本不符、读取异常、未知 scope 或范围外请求都拒绝；不根据声明元数据授予 Kestra 资源访问。`openid` 等协议 scope 按标准机制处理；refresh 重新验证当前成员、授予和支持集合。内置组标识由安装事务持久化，删除和改标识必须拒绝。

兼容与升级：本轮 `new-install` 空库初始化目标 schema，不为旧 `project` API、配置、字段或 claim 建立别名。历史 schema1 和物理回滚只进入显式 `legacy-migration` profile。宿主先独立构建、测试、通过 CI 并发布镜像；插件从正式镜像获取公开类型后独立编译和发布 jar。宿主测试覆盖错误 issuer/audience/client/应用组、签名 claim、防伪造、范围外整体拒绝、撤权/refresh、scope key 不可改和受限删除、组件缺失及关闭回归。根仓以正式镜像和 jar 执行 OAuth2、REST、MCP、真实 UI 与拒绝无副作用组合验收。提案已同步差异表和机制文档；当前发布只证明 scope 名称、受限删除、声明投影 SPI、部分签发与旧凭据在线复查，不能称为目标模型交付。

### 缺声明组件的首方协议登录（已接收、待发布）

消费项目 `kestra-plugin-rbac` 缺失时，部署仓隔离 `new-install` 的 REST `56/56` 通过，随后缺插件用例在生产 `/oauth/login/kestra` 流程循环，报告位于本仓外部署仓 `.work/application-group-acceptance/local-run.log` 对应的隔离报告。失败来自 `OidcTokenService.projectAuthorization` 在取目录成员后要求唯一声明提供者；它把无法签发任何应用组 scope 的情况升级为整个标准 OIDC 登录失败。用户必须能登录后看到受保护业务拒绝并退出换号。

裁决：声明组件缺失或不唯一时，宿主仍可对已批准的首方 UI client 签发标准协议 scope，应用组 scope 集合必须为空。普通应用组 scope 请求仍整体拒绝；签名 claim 中不出现伪造的授权。业务 REST、MCP 和 UI 授权入口继续因缺插件拒绝，不能把零 scope 登录当作资源权限。组件恢复后的新请求按当前登记重新评估，不复活旧 token 的业务 scope。宿主独立测试须覆盖首方无组件协议登录、普通应用组 scope 拒绝、旧 token 复查和关闭功能；部署仓复测缺 jar 的真实登录、拒绝、无副作用与退出。候选源码已加入 `0160`/`0362` 需求补丁及定向测试，正式 CI 和镜像发布尚未通过，不能引用上一镜像作为修复产物。

`dd5f6c3` 的正式镜像通过 CI 后，部署仓隔离组合又发现 `/oauth/callback/kestra` 跳转的 UI 文档返回 401。实际失败路径是宿主 `OidcIdentityLifecycleFilter` 调用 `OidcTrustedIdentity.validate`，后者在声明组件缺失时拒绝已经签发的零应用组 scope 身份。修正的最小边界：可信身份仍逐项验证签名后的 issuer、audience、client、目录成员、用户状态与 epoch；缺声明组件时只接受空应用组 scope，任何非空 scope 整体拒绝。业务评估提供者仍缺席并拒绝全部资源操作。对应 `0362` 测试验证零 scope 身份与非零 scope 拒绝；正式镜像和根仓缺插件组合门仍待重跑。

### 应用组管理授权边界提案（已接收、未实施、未发布）

宿主命名候选更新（2026-10-21，未发布）：公开目录值类型改为 `ApplicationDirectoryV1.ApplicationGroup` 和 `ApplicationGroupInput`；目录访问使用 `applicationGroups/applicationGroup`。可信身份字段使用 `applicationGroupId/applicationGroupScopes`，成员支持范围为 `supportedScopeKeys`，scope 定义与输入使用 `key/name/description`。目录快照及安装计划使用 `applicationGroup/applicationGroups`，内部目录包为 `io.kestra.webserver.oidc.applicationgroups`，状态接口为 `ApplicationGroupDirectoryState`。持久化表统一为 `oidc_application_group_state/bootstrap/invalidation`。不保留旧 project 类型、字段、包、表名或旧 JSON 重试；协议标准 `iss`、`scope` 和共享端点保持原义。

删除安全补充裁决（2026-10-21，候选未发布）：当前组创建从 revision/authorizationVersion=1 开始；若允许删除后复用同一 ID，新组版本可能在后续操作中再次等于旧组凭据的版本，不能仅以“删除时无现存成员”证明旧凭据永不恢复。组 ID 在同一安装内按生命周期唯一。删除事务在授权、内置保护、修订及空引用校验之后，先向 `oidc_application_group_retired` 写入退役 ID，再删除目录记录；两步使用同一目录写锁与数据库事务。创建事务在同一写锁中检查现存和退役 ID，任一存在均返回冲突，不提供复用或恢复接口。被拒绝的删除不得留下退役记录；内置组仍不进入删除或退役路径。

创建和更新方法已补齐为 `createApplicationGroup/updateApplicationGroup`，删除方法为 `deleteApplicationGroup`，没有旧方法别名。数据库测试新增退役持久化、缺管理 provider 拒绝且不写退役记录、错误修订回滚、删除与重建并发串行化探针；目录 PostgreSQL 套件目标计数现为 20。这 20 项尚未在本候选执行，不能计为通过。

本次验证树为 `.work/application-group-retirement-replay`，从固定 BASE 重放 41 个补丁通过；60 份相关主源码编译通过，纯目录/身份/scope/安装计划 `16/16` 通过，PostgreSQL 与登录集成测试源码编译通过。证据为 `.work/application-group-retirement-replay.log`、`application-group-retirement-compile.log`、`application-group-retirement-test-compile.log`、`application-group-retirement-tests.log`、`application-group-retirement-structure.log`。此前 naming-replay-3 不含本次退役机制与方法补正，不作为最终候选验证树。Docker socket 访问仍被执行环境拒绝，数据库、完整 CI、镜像和真实组合没有新增通过证据。

签发契约清理后续（2026-10-21，候选未发布）：签发代码中公开的 `bindProjectCode` 及相关 claim、audience 和 token 辅助方法已改为应用组名称，不保留旧方法别名；授权评估的应用组探针类同步改名，两个发布检查器均要求新测试类。最新验证树为 `.work/application-group-token-contract-replay`：41 补丁重放、60 份主源码编译、纯契约 `16/16`、结构门通过。另实际运行无需数据库的可信身份 6 项、V2 授权边界 2 项、MCP 异步身份与撤权 5 项，共 `13/13`，覆盖正常输出、等待期间 epoch/账号撤权、缺来源、主体错配、声明撤销、缺声明组件的零 scope 身份与业务 scope 拒绝。该组探针使用模拟目录和进程内执行链，不替代 PostgreSQL、真实 OAuth、HTTP 或 Compose。

证据为 `.work/application-group-token-contract-replay.*.log`、`application-group-token-runtime-compile.log`、`application-group-token-runtime-tests.log`。首次额外探针运行的临时执行器误用固定 16 项计数，原始日志保留为 `application-group-token-runtime-runner-mismatch.log`；修正为明确期望 13 项后全部重跑通过，没有删除断言或将未运行项计为通过。发布门的 18 个必需类名及源码测试注解计数已静态核对，记录为 `application-group-token-release-gate-source-audit.log`；此计数核对不证明数据库套件或全部测试已经执行。

完整 Gradle 编译仍未启动：wrapper 写用户目录锁失败，改用工作区缓存及已安装 Gradle 后，本机 FileLockContentionHandler socket 创建仍被沙箱拒绝。失败日志分别为 `.work/application-group-retirement-gradle-compile.log` 和 `application-group-retirement-workspace-gradle-compile.log`。未修改全局 Gradle 配置或重试绕过 socket 权限，不把 javac 定向编译写成 Gradle 全量构建通过。

此候选在 `.work/application-group-naming-replay-3` 从固定 BASE 顺序重放 41 个补丁通过；60 份相关宿主主源码编译通过；目录 DTO、可信身份 DTO、scope 交集和内置计划共 `16/16` 定向测试通过。PostgreSQL 和登录集成测试源码编译通过，但数据库、完整宿主 CI、镜像和真实组合未运行。证据分别为 `.work/application-group-naming-replay-3.log`、`application-group-naming-compile.log`、`application-group-naming-test-compile.log`、`application-group-naming-tests.log`、`application-group-naming-structure.log`。先前 `.work/application-group-model-dev` 使用旧命名，不得覆盖或当作本次最终验证树。插件仍固定旧正式宿主输入，必须等待本候选正式发布后再适配并完整编译，不能使用本地候选 jar。

内置应用组约束补充裁决（2026-10-21，已接收、未发布）：消费项目为 `kestra-plugin-rbac`。当前安装记录只保存 UI client，目录没有不可变的内置组标识和受限组删除机制；缺少删除方法不能证明内置组保护已实现。安装计划新增必填 `builtInApplicationGroupId`，必须精确指向计划中的唯一组，且当前 UI 应用为该组已批准的普通成员。此标识进入审批 hash，并在目录首次激活的同一事务写入安装记录；不得从数组顺序、显示名称或现存首方成员记录推断。旧缺字段计划拒绝，不加默认或兼容重试。

宿主新增只读内置 ID 查询和受限应用组删除公开操作。删除沿用现有可信身份、管理 SPI、目录写锁和对象修订；内置 ID 始终拒绝删除，其他组仅在 scope、应用成员和用户授予均为空时可删除。数据库保存内置 ID 对目录主键的引用，避免记录与组脱离。标识不提供修改入口；组 ID 更新接口仍不存在。宿主独立测试必须验证审批 hash 绑定标识、计划顺序无关、UI 成员归属、数据库持久化后重新装载、内置删除和错误修订无副作用、非空组拒绝、空组删除、并发和缺组件拒绝。插件随后只消费正式 SPI 并展示内置状态；根仓使用正式镜像/jar 验证安装、删除拒绝、其他组操作和资源清理。当前未实现项不得由旧 CI 或 UI 隐藏按钮代替。

候选实施证据：`0360/0363` 已加入 `builtInApplicationGroupId()`、`deleteApplicationGroup(id,revision)` 和安装记录的非空外键；计划中的同名字段必填并参与审批 hash，不能由 UI 成员或数组顺序推断。计划选中的组必须含已批准的当前应用，首方标志仍由原宿主登录安全规则独立检查。`0362/0363` 的安装测试配置已同步新必填字段。纯计划测试 `4/4` 通过，相关主代码及 PostgreSQL/组合测试源码编译通过，固定 BASE 的 41 个补丁逐项检查及顺序重放通过，结构门 `PASS=15 FAIL=0`。证据位于 `.work/application-group-builtin-tests.log`、`application-group-builtin-postgres-compile.log`、`application-group-builtin-replay.log` 和 `application-group-builtin-structure.log`。其中 PostgreSQL 的新持久化、外键与删除探针仅完成源码和编译，数据库、并发、镜像及正式 CI 均未在本候选运行。上一 scope 候选的本地 CI 结果不能替代本次候选验收。

消费项目仍为 `kestra-plugin-rbac`。目标要求应用组 scope 仅有 `key/name/description`；当前 `ApplicationDirectoryV1.ScopeDefinition` 保存 `resourceIntents/managementIntents`，`JdbcApplicationDirectoryV1.authorize` 和 `hasAdministrator` 依赖这些字段，插件 `ProjectPolicyBoundary` 将其作为 Kestra 实际权限上界。管理员更改 scope 名称或成员登记会推进全组目录修订，插件随后要求“完整项目恢复”。这些是目标模型的实际失败路径；代码入口见 `patches/webserver/0360-application-project.patch`、`0363-application-project.patch` 与插件当前组合失败的待补探针。OSS 没有独立应用组管理授权入口；已发布的 typed 资源授权只接收宿主已解析的资源操作，不能直接替代目录事务内的管理决策。

候选最小契约：宿主目录 CRUD 在原事务内向唯一版本化管理决策 SPI 提交已验证的主体、应用组、client、scope key、目标与动作；插件只返回允许或拒绝，不能改写宿主目录。首次安装由安装凭据和显式批准计划完成，不使用普通 HTTP 决策旁路。最后管理员保护由宿主枚举实际可登录的主体、成员和 scope，交由同一 SPI 判断候选操作后仍有管理员；插件从自身 Kestra 运行时策略读取管理 grant。宿主不保存 Kestra 资源意图、管理意图或插件策略。缺 provider、多实例、版本不符、数据库错误、异常、超时和未解析目标均拒绝，事务回滚且不改变目录或会话。显示名称和说明变化不要求全组人工恢复；撤权仍逐请求检查。候选需要评估共享事务连接的公开边界，避免目录持锁时插件再借连接导致单连接池死锁。

兼容性：新安装只使用新公开契约，不保留旧意图字段、旧全组恢复 API 或项目 claim。宿主独立探针须覆盖同 scope 完整管理权限、READ/MANAGE 分离、最后管理员、并发写入、缺组件、存储故障、候选失败回滚和关闭功能。插件独立测试须证明 Kestra 实际策略是唯一资源授权事实来源；根仓用正式产物复测用户授予、应用支持交集、撤权、refresh、REST/MCP/UI 与无副作用。

主控裁决：接收移除共享意图及完整恢复的最小机制需求。新公开接口在宿主事务中接收已经验证的当前身份、目标应用组、动作和当前目录快照，只返回允许或拒绝；用于最后管理员检查的候选快照必须另设只读方法，不能把候选主体伪装成已登录身份。插件只从自己的已提交 Kestra 实际策略读取管理 grant；声明元数据 `key/name` 不参与决策。宿主先核对 issuer、client、audience、用户状态、scope 授予和应用支持，再调用唯一 provider；provider 不能读取宿主表或调用宿主写 API。跨连接一致性必须用真实 PostgreSQL 并发探针验证，当前没有跨仓共享事务承诺。内置应用组首次激活由安装凭据和批准计划控制，不能调用普通管理授权接口；其后写入缺 provider 时失败关闭。此裁决未冻结 Java 方法签名，须以独立探针确认事务访问路径后再实施。

候选实现进度：验证树已新增 `ApplicationGroupManagementV1` 和目录写入激活点；普通管理写入先由宿主核对可信身份、应用组成员、用户授予和 scope 状态，再要求唯一 provider 返回允许。缺 provider 或拒绝均不写库，独立 PostgreSQL 探针已复现。最后管理员检查已将候选用户、首方 UI 成员和有效 scope 交集交给同一 provider，专门测试证明即使共享 scope 没有 `managementIntents`，最后管理员撤权也被阻止；普通 client 即使登记相同管理 scope，也不能替代首方 UI 管理员。首次安装仍只按安装凭据与结构性首方 owner 判定，不把候选主体当成真实登录。旧 `resourceIntents/managementIntents`、目录上界和完整恢复仍在公开模型中，因此该候选不得发布为完整目标契约。下一步移除共享意图并更新插件独立策略，再执行双方完整构建与组合验收。

组合反馈：正式 `3ee3f8e` 镜像与插件 `e90c590` 通过各自 CI，但根仓空库组合在首个测试账号创建后的完整策略保存返回 409。宿主 `PolicyBoundary.reachableManagementScopes` 曾误调用仅判断 `IDENTITY.MANAGE` 的新 provider，漏报只持 `LOCAL_POLICY.MANAGE` 的策略 scope；插件于是拒绝策略管理员可达性。裁决把该投影恢复为宿主可实际登录、获授且受首方 UI 成员支持的 scope 集合，不在宿主推断该 scope 的管理动作。`IDENTITY.MANAGE` 的正常写入与最后管理员保护继续由新 provider 决策。独立 PostgreSQL 测试验证“可达但非身份管理”的策略 scope 会进入投影；该修正仍须镜像 CI、插件正式输入和根仓组合复测。

目标模型的下一项候选：`ApplicationDirectoryV1.ScopeDefinition` 与 `ScopeInput` 已收窄到 `projectId/scope/name/description/revision` 和 `scope/name/description`，不再保存 `active/resourceIntents/managementIntents`。`scope` 暂为稳定 key 的 Java 字段名，名称及说明可以独立更新；撤权由应用成员支持范围或用户授予撤销并推进 epoch，不再通过停用全组 scope。宿主不再比较应用资源意图，也不替其他应用定义 namespace/动作。候选从干净 BASE 重放成功，宿主定向测试 `47/47` 与完整 `scripts/local-ci.sh` 通过；正式 CI 和镜像发布仍待执行。

插件适配设计：目录投影只提供 scope 标识、名称和说明；Kestra 资源授权从插件自己的已提交策略读取，管理决策由 `ApplicationGroupManagementV1` 提供。插件须使用本次正式发布的宿主镜像重新编译并独立测试，不得使用宿主开发树或候选 jar。原消费方不能直接装载到变更后的宿主；部署方必须等待匹配插件正式发布。此次宿主发布只证明收窄后的公开机制；旧 `project` 类型与字段命名、`reconciliation` 用户流程和全组版本联锁仍须后续移除，不代表完整目标模型已交付。

### 已接收的 UI 项目 scope 选择器（REQ-0360）

UI 不需要因新增项目 scope 修改 Compose。内置 issuer 只允许目录显式登记的第一方 UI client 申请协议 scope `kestra:project-scopes`。签发事务将该选择器展开为该 client 获批的项目 scope 集合，再与当前 subject assignment、项目 active 状态和用户 consent 求交；选择器本身永远不写入 `projectScopes`，不授予本地权限。UI 第一方可以显式免重复 consent，但不能免 subject 授权。普通 client 与 DCR client 必须逐名申请实际项目 scope，不自动展开。未授予请求返回 `invalid_scope`；没有 assignment 的 UI 用户仍可完成协议登录，但业务 projectScopes 为空。access token 的可信上下文只保存实际 project scopes；ID token 不假定标准 `scope` claim，若服务端 cookie 需要恢复上下文，必须使用同一签发事务产生的版本化私有 claim 并在线检查 project epoch。不得从 `roles` 改名为 scope。

### Compose 与关闭模式边界（REQ-0360）

新 Compose 由部署仓设置 `kestra.rbac.application-projects.enabled` 与 RBAC 开关，并在 UI client scopes 中显式加入 `kestra:project-scopes`；不再使用 `management-admin-subjects`。该配置尚未部署到正式镜像。RBAC/project 模式关闭时，未引导目录不得阻断首次 setup、协议登录或 selector 的协议消费；selector 不授项目 scope。project 模式启用而目录未初始化时，受保护业务必须失败关闭。旧 code/access/refresh/UI/IdP/MCP 凭据只在显式切换工具提交批准计划时失效，重启本身不触发迁移。


### 应用项目候选链与发布前置（未发布）

共享项目、scope 语义上界、成员 client 与 subject assignment 的事实源为宿主 PostgreSQL
目录。插件只消费公开目录投影，不读取宿主表，不向宿主写入本地 grants。

| 路径 | 候选实现与安全边界 |
|---|---|
| 申请与同意 | `OidcProviderController` 在真实登录后调用 `authorizeScopes`；UI selector 只对第一方获批 UI 成员展开，普通 client 逐名申请；实际 scope 再经用户同意收窄 |
| 授权码与签发 | 目录激活后授权码绑定项目 epoch；签发交集为启用项目、启用 scope、获批 member、subject assignment 和 consent；签名 claim 分离 protocol/project scopes |
| UI cookie / REST | ID token 携带与 access token 相同的签名项目 claim；Micronaut callback 完成标准 OIDC 校验；每请求 lifecycle 与可信身份机制核对 issuer、精确配置 UI audience、当前目录和 epoch |
| MCP | resource-bound access token 校验签名、issuer、有效期、持久化记录、账号、client、资源 audience 和 epoch；每次调用消费当前 Bearer 身份，不缓存 initialize 权限 |
| 撤权 | 项目、scope、member 或 assignment 写入推进项目 epoch；提交后新请求拒绝旧 cookie/access token；旧 code/refresh 不能恢复旧授权；已开始的不可变授权评估不混入新修订 |
| 管理引导 | 仅宿主本地 CLI 预览完整计划并核对批准 hash、安装凭据、源修订和源 hash；事务激活后消费一次性引导、撤销旧凭据；正常管理继续要求可信 scope，不提供 subject 永久旁路 |

`directoryRevision` 对应 `Project.revision`；`authorizationVersion` 对应独立的
`Project.authorizationVersion`。二者不得互换。共享 scope 的现有语义只允许收窄；
扩大授权必须新建稳定 scope 标识，并显式完成本地绑定、client 批准、subject 授予与
重新登录。完整新项目管理流程见 `r-ee-rbac.md`，本地策略恢复归消费扩展。

上述为源码与本地独立测试的候选链说明，不能替代正式 HTTP callback、真实浏览器、
双 client 撤权时限与拒绝无副作用组合验收。发布前必须通过宿主 CI、镜像级 OIDC/MCP
黑盒和发布门；消费扩展必须等正式产物后独立编译插件 jar。


协议上界候选修正：全局 protocolScopes 只负责分类，签发和 refresh 必须另外与当前
active client 的真实注册协议 scopes 求交；未注册协议项返回 invalid_scope，不把它
当作项目项继续处理。项目 scope 仍使用获批成员上界，不要求写入旧 client.scopes。
selector 必须显式注册且匹配安装凭据中的第一方 UI client。独立回归通过生产 DCR
注册、owner 同意和目录 membership 复现限制，不以手工 principal 代替签发证据。

### 目录迁移数据源修正（REQ-0364，待镜像验证）

提交 24a2b48 的 CI 39086467333 在 MCP 镜像启动时复现 NoConnectionException。
目录组件接收 Micronaut contextual DataSource，却在无请求连接上下文的迁移中自行开启
事务。组件必须先用宿主已有 DelegatingDataSource.unwrapDataSource 取得实际数据源，
再按自身短事务管理连接。独立测试须调用实际注入的迁移 bean，不能只验证 bean 存在。
此修正不改变目录模型、本地 grants 或启动认证边界；镜像启动仍须再次验证。

### 应用项目宿主发布状态（2026-10-18）

上述应用项目机制及目录迁移数据源修正已在 `4b017f6` 的正式 CI
[39087229293](https://github.com/ai-specs/kestra-overlay/actions/runs/39087229293) 通过，
镜像已推广为 `sha256:ba19764bf232306e6501c5226af015d3e18d006da75a4e96a55c6baecee457af`。
先前段落中的“候选／未发布”描述提案与实施时状态；本条只确认指定提交的宿主公开机制、
镜像级 MCP/OIDC/浏览器检查和发布，不确认独立插件业务、完整迁移或 Compose 组合。
使用契约与范围以 README 的应用项目章节为准；后续提交须检查自身 CI，不沿用此记录。
