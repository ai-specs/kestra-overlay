# patches

`BASE` 记录 overlay 所基于的上游固定 commit（kestra-io/kestra，develop）。
overlay CI checkout 该 SHA 构建，保证可复现。

**本仓零源码 patch**：官方 Dockerfile 原生从构建上下文 `plugins/`（bind mount）拷贝到
`/app/plugins`——扩展仓 jar stage 进 `$WORK/plugins/` 即被烘焙，无需修改上游 Dockerfile。
历史 patches（webserver×11 / ui×9 / migration×4 / deploy 杂项）已全部删除，理由见根 README
「明确不属于本仓的内容」：镜像不编译 java/ui 源码，业务面归扩展仓。
