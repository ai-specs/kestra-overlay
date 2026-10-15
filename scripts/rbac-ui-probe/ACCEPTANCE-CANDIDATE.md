# 可接收的 UI 契约范围草案

本文件供主控技术接收。没有生产实现与发布。ShadowRoot 浏览器结果尚未生成，
相关条件不得记为已经满足。已完成证据入口为本目录 README。

## 已有机制与必要增量

已发布 Class-Path 和 UiController 能从外部 jar 读取真实 JS；不需要新的动态 bean
装载器，不需要覆盖 IAM，不需要构造假 task type，也不需要扩展业务模型进入宿主。
需要新增的宿主面仅为管理扩展描述发现、资源验证、菜单/根路由注册和生命周期桥接。
公开组件包是独立 npm 输入；宿主与组件包之间必须提供精确版本兼容清单。

## 最小协议

1. 清单描述独立扩展 ID、相对入口与样式、hash/MIME、语言标题和可选 capability API。
   ID 唯一；路径必须规范且留在本扩展目录。未知版本、缺资源、hash/MIME 不匹配拒绝注册。
2. 宿主注册 `/ui/{tenant}/extensions/{id}/...`，保留宿主导航、错误页与退出。
   不传 Vue/router/store/i18n 实例。扩展详情路径只通过数据 context 和受限 navigate 更新。
3. `contractVersion=1`；`mount(element,context)` 返回异步 update 与幂等 unmount。
   宿主在导航取消时 abort，等待中模块完成后必须立即卸载，不能覆盖新页面。
   update 串行执行；未知版本、加载失败和卸载异常需要明确诊断，不回退其他业务页面。
4. context 只包括 tenant、相对路径、API base、规范 locale、支持语言列表、解析后主题、
   用户主题偏好及 AbortSignal；宿主发起 system 变化更新。
5. request 限同源相对 API，处理 CSRF 与 401/403；navigate 限本扩展根。
   浏览器代码仍具有同源权限，服务器负责全部授权，菜单不形成安全边界。
6. 扩展拥有 shadow 根、CSS link 和 popup 内容器；宿主拥有外部元素。
   字体继承宿主；所有 UI 资源与组件弹出层必须留在扩展根。滚动锁策略需要显式约定。

函数签名参考 `api-candidate.d.ts`。这是原型语义，不是已发布 SDK。

## 必须补的公开产物

- 版本化清单 schema/Java 接收类型与 ESM 类型声明；文档说明静态资源目录、MIME、
  hash 和缓存策略。缺失 JS 返回真实 404，稳定入口重新验证。
- 与发布镜像绑定的 design-system 兼容版本和产物 hash。
- 可直接装入 shadow 的 CSS 产物，不能要求插件复制内部 SCSS；组件样式不得偷偷注入
  document。主题选择器、tokens、popup 样式与继承字体必须覆盖三种解析后主题。
- 独立轻量语言入口，包含 register/setLocale、locale ID 映射、回退规则、支持语言列表。
  现有 barrel 可加载 13 种语言，但引入大量组件、图表与编辑器代码；需要公开细粒度入口。
- 修复公开 KsPagination 的内部英文 locale，不能靠外层 i18n 注册假定生效。
  插件业务文案仍归插件。英文探针标签不是生产翻译需求。
- 公开业务翻译检查工具及其输入格式、缺键/多键/占位参数检查。现有包无宿主翻译生成与
  检查工具导出，插件不得读取宿主源码或平行复制内部 JSON。

## 接收门

必须保留 ShadowRoot 实测报告，包括失败、来源页面 console、焦点、窄屏与卸载。
随后才可据其决定 shadow 适配产物或组件修复的最小范围。
真正管理菜单点击、直接访问/刷新、清单非法/缺失、功能关闭和 request 的 CSRF/401/403
由宿主最小无业务扩展验证；正式插件 CRUD/权限与部署组合归各自项目。
本轮不通过删除失败断言将候选声明为可发布能力。
