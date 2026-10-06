# patches

`BASE` 记录本批 patch 所基于的上游固定 commit（kestra-io/kestra，develop）。
overlay CI 先 checkout 该 SHA，再 `git apply`，避免上游演进破坏 patch。

| 目录 | 面 | 性质 |
|---|---|---|
| webserver/ | 9 个上游 M 文件 + webserver/build.gradle | 扩展点激活/注册/占位（ErrorController 注册 NotFoundResponseException 全局错误、UiIndexService 挂 apps shell、AiServiceManager 挂 Dsh provider 等） |
| ui/ | routes/i18n/main/override/kestraHttp/basicAuth | ui 集成点：路由注册、命名空间挂载、覆盖点（业务逻辑在扩展前端包） |
| deploy/ | Dockerfile/compose/entrypoint/cli.build.gradle/OutputValues | 部署与构建集成 |
| migration/ | V2_0_29~31 Dsh* sql + SqlScriptSplitter（A 类新增，挂上游 Flyway 链） | 见 A-FILES.txt；apply 脚本待生成 |

> 已知待精简项：UiIndexService 等个别 patch 内含少量业务逻辑（apps shell 渲染）。
> 按 §3.3 归属原则，后续演进为"委托钩子（占位）+ 外部 jar 实现"，把业务逻辑移出 patch。
