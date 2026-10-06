# patches

`BASE` 记录 overlay 所基于的上游固定 commit（kestra-io/kestra，develop）。
overlay CI checkout 该 SHA 构建，保证可复现。

**为什么薄 patch 而不是零 patch（实证）**：fork 镜像 = 运行时 base（temurin JRE25，
`Dockerfile.base` 实证不编译源码）+ **宿主编译 webserver executableJar**
（`build:kestra` → `gradlew executableJar` → `docker/app/kestra`，jar 内实证含
`DshEmployeeController` micronaut bean 索引）+ 插件 jar。webserver M 文件/migration
定制只能存在于**编译后的 webserver jar**——官方预编译 base 无法承载 → 必须 patch
源码并重新编译该 jar。Dockerfile/Dockerfile.base 本身用上游原样（无需 patch 构建文件）。

| 组 | 覆盖 | 阶段 |
|---|---|---|
| webserver | 9 核心 M 文件（控制器/filter/rooter/services） | 过渡期=fork 原样；出仓后收窄占位 |
| migration | 2.0.29/2.0.30/2.0.31 dsh sql（新增，挂上游 schema 链） | 同上 |
| build | settings.gradle（oidc 模块）、cli/build.gradle、OutputValues、docker-entrypoint | 同上 |

**已删除的零 patch 版本**（c2ae8d8）经复核撤销：当时只验证了"镜像可构建"，
未验证定制面（M 文件/migration）在官方预编译 base 形态下是否成立——结论不成立。
ui M 文件本轮不收（fork 镜像不编译 ui），见根 README。
