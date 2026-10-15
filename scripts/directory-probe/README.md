# OIDC 目录机制调查探针

2026-10-15，宿主自有组件探针。只调用指定正式发布 executable 的内部目录／会话／
token 实现作调查，不把这些内部类型声明为扩展公开接口，不读取真实 RBAC 插件。

需要 Docker、Python 3.11+ 和 JDK 25。先从通过发布门的固定镜像提取 `/app/kestra`，
核对成功 CI 与 provenance，再传入该 jar 和已核实 SHA-256：

```bash
python3 scripts/directory-probe/run.py --host-jar <发布宿主jar> --host-sha256 <已核实sha256>
```

脚本使用独立的 PostgreSQL 容器，应用发布 jar 中的实际 OIDC migrations，编译并运行
最小组件程序；无论成功失败都写入 `.work/directory-probe/<本次ID>/report.json` 并清理
本次容器，不访问部署 Compose 或其数据。检查失败保留日志和退出码，不能仅凭调度脚本
结束判断通过。依赖路径使用当前系统的 classpath 分隔符，不写死个人目录。

在已发布基线执行的组件检查结果：

| 操作 | 实际结果 |
|---|---|
| 对已有账号再次调用内部 create | 旧密码失效、新密码有效，原角色未变；不能作为公开“创建冲突”语义 |
| 内部 setPassword | 密码改变，但原 IdP session 与 access token 仍有效 |
| 内部 updateUserState(INACTIVE) | 密码验证和 access token 验证拒绝，IdP session 的 subject 查询仍返回身份 |
| 再次设 ACTIVE | 原 access token 恢复有效，不要求使用新密码登录 |

这里检查的是内部服务直接调用和真实数据库结果，不是完整认证 HTTP 链。session 返回
subject 不证明后续 authorize 一定成功；没有验证 UI JWT、refresh、完整 MCP session
或浏览器。因此不能声称全部停用路径失效或全部失效路径有漏洞。

目录公开契约必须原子创建且冲突不改凭据；停用、重置、重新启用须定义全部认证链的
行为。优先复用已有 token 撤销和用户状态校验，只有证明不足的入口才补最小激活点；
受保护管理员判断仍属于消费插件。正式接收与实现见 OIDC 能力文档。
