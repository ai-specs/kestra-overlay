# 独立管理页面装载探针

本目录是 2026-10-15 的调查探针。没有生产 patch，没有提交、推送或发布。
消费项目为 `kestra-plugin-rbac`；本探针不读取或编译真实插件。
本报告是主控技术接收输入，不是生产交付结论。首期结果以末节为准，前文保留比较过程。

## 输入与复现

实际环境为 Darwin arm64、Bash，仓库为 `~/kestra-monorepo`，`HERDR_ENV=1`。
Node 为 24.20.0，npm 为 11.19.0。浏览器使用 ego-browser，同一任务空间 9。
执行 `bash scripts/rbac-ui-probe/run.sh`。全部依赖和构建输出留在 `.work/rbac-ui-probe/`。
脚本只安装公开 npm 依赖、构建独立页面与无业务类静态 jar，不编译宿主。
随后按脚本输出启动隔离宿主和静态预览。端口为 18097 与 5198。
隔离宿主使用独立 tmpfs PostgreSQL，不挂载用户数据；OIDC 和认证关闭，只测试装载。
隔离宿主首次 UI 引导需要创建测试账号，随后跳过调查问卷。不得使用此配置部署生产。
结束时执行 `docker compose -p rbac-ui-probe -f scripts/rbac-ui-probe/compose.yaml down -v`。

公开输入：

- 镜像 `ghcr.io/ai-specs/kestra-overlay@sha256:878be36bcb1a2d15266f6c7c05921f77d836136604bd956a5318671c2f34186c`。
- 成功 CI `38686689513`，提交 `9a8dbdae8e13761e135f0e42ccd5ffe4a9635635`；本轮用 gh 重新查询成功状态，记录于 `published-ci.json`。
- 镜像中 executable SHA-256：`bc4c8645de85a2fe2fa395af5d7b13067c236ef276a33476662f68da49732ec7`。
- npm `@kestra-io/design-system@0.5.0`，直接从 registry.npmjs.org 安装和下载 tarball。
  tarball SHA-256：`e50deaa1ea23d0b351a8961dddb6b324b1d4d2c7915cb1c6d9ce839cab602b55`。
  npm integrity 和 gitHead 记录于 `npm-provenance.json`。
- 当前 overlay HEAD 为 `5e96c02764f9afb87f8f961c4278cee31470b088`。
  固定 BASE 为 `172dd0f3760fb1255d3b22bd1fd07ce31b173fa3`。
  调查旧树前核对 HEAD/status，并通过 `git show BASE:path` 核对机制；旧树未被 reset 或编译。
  旧树不是独立页面的构建输入，当前 patch hash 留在 `patches.sha256`。

## 实际结果与证据

以下证据均在 `.work/rbac-ui-probe/`。有失败的检查不得计为通过。

| 检查 | 实际结果 | 证据 |
|---|---|---|
| 初次 npm 安装 | exit 1；Vue 3.5.22 与自动选择的 router 5.4.0 冲突 | npm-install.log |
| 固定 Vue 3.5.39、router 5.0.6 后安装 | exit 0；未使用 force/legacy-peer-deps | npm-install-2.log、install-lock-evidence.json |
| 初次独立构建 | exit 1；公开包间接导入图标 `.vue`，需要 Vue 编译插件 | build.log |
| 添加公开 @vitejs/plugin-vue 6.0.7 后构建 | exit 0；字体解析警告仍存在 | build-2.log |
| 含公开语言入口的最终构建 | exit 0；442 个文件，26 MiB；barrel 引入编辑器和图表依赖 | build-4.log |
| ESM mount/update/unmount | 页面运行；路径变更可更新；重复挂载拒绝；未知版本拒绝；卸载幂等；重挂载与 AbortSignal 可用 | browser-lifecycle.json |
| 弹出层 | 实际打开 dialog，属于扩展根；法语关闭按钮正确；卸载后 DOM 和 body 滚动锁最终清除 | browser-lifecycle.json、esm-dark-fr.txt |
| CSS 隔离 | 失败：styleBase 改变根外字体和 body margin；卸载后字体仍为 Inter | harness 状态、browser-lifecycle.json |
| 主题 | light/dark/dark-2 背景分别为 #f7f7f8/#14181f/#111115；宿主偏好页实际点击四种选项，解析颜色一致 | themes.json、host-preferences.json |
| 公开语言 | 13 个公开 locale 的空状态可渲染；法语分页仍显示 Total/10 per page/英文可访问名 | published-language.json、language-matrix.json |
| locale 标识 | `zh-CN` 回退英文；包使用 `zh_CN`，必须明确宿主到组件包映射 | published-language.json |
| 字体资源 | tarball 无 woff；构建警告，不能以 CSS font-family 字符串证明字体加载成功 | build-4.log、npm-pack.log |
| 真实静态 jar | 独立 jar 通过已发布 Class-Path 装载；响应 MIME 为 application/javascript；浏览器 import 后实际执行 mount | classpath-module.headers、host-static-federation.json |
| 管理菜单与路由 | jar 已装载后无扩展菜单，仅原 IAM；扩展路径和刷新仍 Page not found | host-static-federation.json、host-route-with-jar.txt、host-route-missing.txt |
| 不存在 JS | 200 text/html，实际内容为 SPA；不得当作 JS 存在 | missing-js.json |
| 共享联邦 | 发布容器导出 get/init；`get('./management')` 明确抛不存在；真实共享表只有 Vue 3.5.39 | host-static-federation.json、发布 jar 内 remoteEntry 和 shared map |

`host-reference.png`、`host-form.png` 是实际宿主 MCP 管理列表和表单，已经打开图片核对。
宿主有导航、面包屑、标签页、内容卡片、Inter 字体和紫色主操作。
`esm-dark-fr.png` 与 `esm-narrow.png` 是独立页面。窄屏未出现主要内容横向溢出，
但 select 和次按钮存在低对比度，dialog 也需完整样式兼容检查，因此视觉一致性未通过。
探针英文标题属于测试标签，不代表插件业务翻译已实现。

## ESM 与共享联邦的比较

ESM 的 mount/update/unmount 可以只传数据和回调，独立 Vue/i18n 不依赖宿主实例。
本轮已证明生命周期原型能运行，但 CSS、字体、分页语言仍是实际缺口。
CSS 的模块副作用不会因 app.unmount 自动撤销。不得直接在宿主导入全局 styleBase。
需要限定根的样式产物和受控弹出层样式，或经实测可行的 ShadowRoot 方案。
本轮没有验证 ShadowRoot，不建议把它写成已经解决的方案。

现有联邦加载器按 task type/group/slot 查找插件，公开 slots 只有 topology details、
task drawer、task modal。源码中临时 registerShared 声明 vue-i18n 不等于发布容器已提供
i18n、router、组件包或全局实例。发布容器实际只提供 Vue；管理 expose 也不存在。
联邦方案还需要新增管理发现与装载、共享依赖版本协商和初始化协议，不能免除菜单/路由激活点。
本轮未构建双版本联邦 remote，不宣称完成联邦兼容验证。

## 最小 API 候选，等待裁决

签名见 `api-candidate.d.ts`，未实现、未接收、未发布。探针实现的字段少于候选，
特别是 request/CSRF、capability 与服务端清单校验均未实现。

1. 只公开版本化 descriptor：ID、声明的相对入口/样式/文件 hash/MIME、各语言标题。
   宿主验证重复 ID、路径穿越、缺文件、错误版本和 hash。资源缺失必须真实 404。
2. 宿主拥有 `/ui/{tenant}/extensions/{id}/...` 根路由、菜单位置、容器和生命周期。
   扩展解释根内路径，不传宿主 router、store、Vue app、i18n、身份对象或 token。
3. context 提供 tenant、相对路径、locale、supportedLocales、解析后主题和用户主题偏好。
   只有 update 一个偏好更新通道，不再添加重复订阅 API。system 由宿主解析后通知。
   locale 必须使用已声明映射；不把 zh-CN 自动等同 zh_CN。
4. mount 返回 update/unmount。宿主串行 update，离开时 abort 并清理迟到 mount；
   unmount 必须幂等。错误和未知版本显示装载错误，保留宿主导航与退出入口。
5. navigate 只允许扩展根内规范路径；request 只允许同源相对 API，桥接 CSRF 和 401/403。
   这是便利接口，不是脚本安全沙箱，服务器继续逐请求授权。
6. capability API 未知或失败隐藏菜单，直接访问显示错误；不能替代 API 授权。
   descriptor 不包含角色、grant、用户绑定或真实插件业务类型。

生产前由主控技术接收：最小路由/菜单激活点、不污染宿主的公开样式与字体产物、
分页语言修复或有限适配，以及公开语言工具。本探针不要求用户逐项批准。
公开包 README 引用仓内 ui/AGENTS.md，不能作为独立消费者唯一使用说明。

## 范围和限制

本轮没有生产 patch、真实角色管理页面、管理 API、权限矩阵或真实插件验收。
没有修改共享 docs、CI、patches 或用户部署数据/密码。工作期间观察到其他任务修改
共享 docs、增加 directory-probe/rbac-evaluation，均保留，不纳入本探针交付。
最初误用已有登录表单提交一次，返回凭据错误；未修改账号，随后全部宿主操作切到隔离端口。
首次 Compose 文件写入与相对复制路径曾失败，已在专属树内修正；这些不是宿主机制失败。
没有提交、推送、发布或启动子 agent。

## ShadowRoot 补充验证状态

`shadow-extension.js` 和 `shadow-build.mjs` 使用公开包入口构建独立 ESM；
CSS 经 PostCSS 只转换选择器并通过 shadow 内 link 装载，移除字体声明，继承宿主 Inter。
宿主测试字体从已发布镜像取出，不进入真实插件或组件构建图。
Dialog/Popover 指定 shadow 内容器，Dialog 使用 `lockScroll:false` 避免修改宿主 body。
这项选择意味着宿主页面仍可滚动，不能声称已实现全页模态滚动锁。
公开语言入口实际完成注册后分页仍英文；已进一步追踪发布 `KsPagination`：
内部创建英文 `paginationLocale`，覆盖外层 ConfigProvider，因此不是缺少注册调用。
证据为 `pagination-locale-trace.txt`，修复应在公开组件产物中完成，不复制宿主翻译。

原浏览器空间 9 已由上一轮 finish 关闭；恢复返回 task space not found。
新的 ShadowRoot 浏览器检查脚本为 `browser-shadow.mjs`，结果必须以实际运行报告为准。

## 首期收窄后的真实宿主验证

主控明确首期只支持公开按钮、输入、表格和自有 vue-i18n 分页。详情通过独立路由，
删除通过页内确认；Dialog、Popover、复杂下拉和 vendor 焦点陷阱均不属于首期支持面。
`phase1-extension.js` 不包含焦点修补、vendor 源码复制或弹出层组件。

`phase1-host-browser.json` 是**真实隔离发布宿主内**的最终报告，6 组检查通过，0 失败。
这与独立 harness 的 `shadow-browser.json` 分开，不混用两者结论。
`phase1-host-browser-final.log` 记录运行退出码对应的结果；进程 exit 0 不代替报告 failed=0。
初次宿主加载失败 `process is not defined` 已留在 `shadow-host-browser.log` 和
`shadow-host-first-failure.txt`。修复在独立 Vite build 中显式 define
`process.env.NODE_ENV="production"`，没有向宿主注入 process 垫片。
第二次浏览器读取固定入口旧缓存再次失败，保留该日志；带新查询参数取得新产物后通过。
这也证明稳定入口必须重新验证，不能继承一天的静态缓存策略。

最终实际检查：

- 发布宿主内导入 classpath ESM，真实按钮、输入、表格渲染 `probe-role/team.a`。
  表格使用稳定内容等待；初次过早读取空表格的失败保留于 `phase1-host-first-failed.json`。
- document head 样式数保持 10，宿主主按钮颜色、背景、padding、Inter 字体和 body margin
  在挂载、三主题更新和卸载后完全相同。CSS link 只进入 shadow 根。
- 真实加载的宿主 Inter 被继承，`document.fonts.check` 为 true。
- 三主题背景分别为 `rgb(247,247,248)`、`rgb(20,24,31)`、`rgb(17,17,21)`。
  system 通过真实 matchMedia 解析暗/亮结果，再以 context update 传入；两次更新通过。
  CDP 仿真未发出 media change 事件，因此**不宣称自动媒体监听已通过**。宿主自动订阅
  仍须由生产挂载点自身测试覆盖，扩展只消费解析后的数据更新。
- 自然 Tab 顺序为 Name→Description→Details→Delete；Shift+Tab 可以反向。
  输入无自定义陷阱；按钮具有可见焦点轮廓。窄屏与深色截图已经实际查看。
- 自有分页显示 `Page 1 sur 2` 和 `第 2 页，共 2 页`；不使用英文硬编码的 KsPagination。
  这些只是测试消息，不代表真实业务页面翻译完成。
- 390px 窄屏下 shadow 内容宽度等于容器宽度，无新增横向溢出。
- Abort 后 shadow 子元素为 0、无新增根外 overlay、无 body 滚动锁和样式变化。
  原宿主已有 6 个隐藏 popper，按挂载前具体 DOM 对象核对；没有把宿主对象当作插件泄漏。

首期公开直接 exports：

```js
import KsButton from "@kestra-io/design-system/components/Basic/KsButton/KsButton";
import KsInput from "@kestra-io/design-system/components/Form/KsInput";
import KsTable from "@kestra-io/design-system/components/Data/KsTable/KsTable";
import KsTableColumn from "@kestra-io/design-system/components/Data/KsTable/KsTableColumn";
```

独立产物仅 2 文件：JS 569.29 kB（gzip 161.67 kB）、CSS 134.97 kB（gzip 20.36 kB），
避免语言 barrel 的 26 MiB/442 文件图。版本锁与产物 hash 见 `phase1.sha256`。
CSS 由公开包构建产物转换选择器，不读取宿主源码；生产应发布正式 shadow 样式入口，
不要求真实插件维护这份探针转换。执行 `bash scripts/rbac-ui-probe/run.sh --phase1` 可重现。

弹出层历史报告 `shadow-browser-first-failed.json` 保留了原生焦点失败。后来加局部焦点适配
的六项通过仅证明原型，不作为首期承诺，不建议接收或发布该修补。首期无需该适配代码。
尚无任意第三方组件在 ShadowRoot 中可用的承诺。
