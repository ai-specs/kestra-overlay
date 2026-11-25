#!/usr/bin/env python3
"""Read-only upgrade inventory and isolated, ordered patch replay (stdlib only)."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


class AssessmentError(RuntimeError):
    pass


def git(repo, *args, check=True, data=None):
    env = dict(os.environ, GIT_OPTIONAL_LOCKS='0', GIT_TERMINAL_PROMPT='0')
    p = subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-C', str(repo), *args],
                       input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    if check and p.returncode:
        raise AssessmentError(p.stderr.decode('utf-8', 'replace').strip())
    return p


def text(raw):
    return raw.decode('utf-8', 'surrogateescape')


def resolve(repo, ref):
    if ref.startswith('-'):
        raise AssessmentError('revision cannot begin with -')
    return text(git(repo, 'rev-parse', '--verify', ref + '^{commit}').stdout).strip()


def changes(raw):
    """Parse the complete NUL-delimited name-status stream, including both rename paths."""
    fields = raw.split(b'\0')
    result = []
    i = 0
    while i < len(fields) and fields[i]:
        status = text(fields[i]); i += 1
        old = text(fields[i]); i += 1
        new = old
        if status[0] in 'RC':
            new = text(fields[i]); i += 1
        result.append({'status': status, 'old_path': old, 'new_path': new})
    return result


def patch_paths(repo, content):
    raw = git(repo, 'apply', '--numstat', '-z', '-', data=content).stdout
    fields = raw.split(b'\0'); paths = set(); i = 0
    while i < len(fields) and fields[i]:
        _, _, name = fields[i].split(b'\t', 2); i += 1
        if name:
            paths.add(text(name))
        else:
            paths.update((text(fields[i]), text(fields[i + 1]))); i += 2
    return sorted(paths)


def risks(paths):
    rules = {
        'migration': r'(?i)migrat|\.sql$',
        'dependency': r'(?i)(gradle|(^|/)pom\.xml$|package(-lock)?\.json$|yarn\.lock$|dockerfile)',
        'public_contract': r'(?i)(rbac|oidc|/models/|/services/|/controllers/|ui.sdk|interface|accesscontrol)',
        'test': r'(?i)(/test[s]?/|test\.|test\.java$|spec\.)',
    }
    return {name: [p for p in paths if re.search(pattern, p)] for name, pattern in rules.items()}


def assess(overlay, source, target, output, target_commit=None):
    overlay = Path(overlay).resolve(); source = Path(source).resolve(); output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise AssessmentError('output must not exist (exclusive directory required)')
    # Reports may live in overlay .work, but never alter the upstream work tree.
    if output.resolve().is_relative_to(source):
        raise AssessmentError('output must be outside the upstream repository')
    bare = text(git(source, 'rev-parse', '--is-bare-repository').stdout).strip() == 'true'
    if not bare and git(source, 'status', '--porcelain=v1', '-z', '--untracked-files=all').stdout:
        raise AssessmentError('dirty upstream source: commit or preserve changes before assessment')
    base_bytes = (overlay / 'patches/BASE').read_bytes()
    base_lines = text(base_bytes).splitlines()
    if len(base_lines) != 2 or not re.fullmatch(r'[0-9a-fA-F]{40}', base_lines[1]):
        raise AssessmentError('BASE must contain a tag and a full 40-character commit')
    base = resolve(source, 'refs/tags/' + base_lines[0])
    if base != base_lines[1].lower():
        raise AssessmentError('BASE tag and pinned commit mismatch')
    target_sha = resolve(source, target)
    if target_commit and resolve(source, target_commit) != target_sha:
        raise AssessmentError('target tag/ref and expected commit mismatch')
    manifest = (overlay / 'patches/manifest.tsv').read_bytes()
    files = sorted((overlay / 'patches').glob('*/*.patch'))
    rows = [line.split('\t') for line in text(manifest).splitlines() if line and not line.startswith('#')]
    registered = [r[1] for r in rows if len(r) >= 3 and r[2] != 'reserved']
    if sorted(registered) != sorted(p.name for p in files):
        raise AssessmentError('manifest and patch files differ')
    delta = changes(git(source, 'diff', '--name-status', '-z', '--find-renames', base, target_sha, '--').stdout)
    changed = {p for entry in delta for p in (entry['old_path'], entry['new_path'])}
    report = {'schema_version': 1, 'base_tag': base_lines[0], 'base_commit': base,
              'target_ref': target, 'target_commit': target_sha,
              'base_tag_object': text(git(source, 'rev-parse', 'refs/tags/' + base_lines[0]).stdout).strip(),
              'target_object': text(git(source, 'rev-parse', '--verify', target).stdout).strip(),
              'semantic_validation': 'NOT_VERIFIED',
              'limitations': ['Clean application does not prove compatibility or upstream absorption.',
                             'Risk labels are path heuristics; inspect implementation and public contracts.',
                             'No compilation, tests, migration execution, CI or image validation performed.'],
              'inputs': {'base_sha256': hashlib.sha256(base_bytes).hexdigest(),
                         'manifest_sha256': hashlib.sha256(manifest).hexdigest()},
              'upstream_changes': delta, 'upstream_change_count': len(delta),
              'upstream_risks': risks(sorted(changed)), 'patches': []}
    snapshots = []
    for path in files:
        content = path.read_bytes(); paths = patch_paths(source, content)
        previous = [p['patch'] for p in report['patches'] if set(p['paths']) & set(paths)]
        item = {'patch': str(path.relative_to(overlay)), 'sha256': hashlib.sha256(content).hexdigest(),
                'paths': paths, 'upstream_overlap': sorted(set(paths) & changed),
                'prior_patch_overlap': previous, 'dependency_risk': bool(previous),
                'risks': risks(paths), 'semantic_validation': 'NOT_VERIFIED'}
        report['patches'].append(item); snapshots.append(content)
    # All revision/object/manifest validation precedes creation of the exclusive output.
    output.mkdir(parents=True, exist_ok=False)
    with tempfile.TemporaryDirectory(prefix='overlay-upgrade-') as temporary:
        clone = Path(temporary) / 'upstream'
        git(source, 'clone', '--no-local', '--no-hardlinks', '--no-checkout', str(source), str(clone))
        # Explicit fetch also supports locally present commits outside advertised refs.
        git(clone, 'fetch', '--no-tags', str(source), target_sha)
        git(clone, 'checkout', '--detach', target_sha)
        blocked_by = None
        for item, content in zip(report['patches'], snapshots):
            if blocked_by:
                item.update(replay='blocked', blocked_by=blocked_by)
                continue
            # git apply itself checks new-file collisions in the evolving target tree.
            checked = git(clone, 'apply', '--check', '-', check=False, data=content)
            if checked.returncode:
                blocked_by = item['patch']
                item.update(replay='failed', diagnostics=text(checked.stderr))
                continue
            applied = git(clone, 'apply', '-', check=False, data=content)
            if applied.returncode:
                blocked_by = item['patch']
                item.update(replay='failed', diagnostics=text(applied.stderr))
            else:
                item['replay'] = 'applied'
    report['replay_complete'] = blocked_by is None
    (output / 'assessment.json').write_text(json.dumps(report, ensure_ascii=True, indent=2) + '\n')
    counts = {state: sum(p['replay'] == state for p in report['patches']) for state in ('applied', 'failed', 'blocked')}
    summary = (f"# 上游升级评估\n\nBASE `{base}` → `{target_sha}`。\n\n"
               f"完整变更 {len(delta)} 个条目；顺序重放：{counts}。\n\n"
               "语义兼容性：未验证。可应用不等于兼容；blocked 不等于独立冲突。\n"
               "完整路径、rename/delete、输入哈希、交叠、风险及失败诊断见 assessment.json。\n\n"
               "## 交给升级 agent 的提示词\n\n"
               "先读本仓 AGENTS.md、README.md、差异表和机制文档；以报告固定的 commit 为输入，"
               "重新核对标签与对象。不要把历史 trial-replay 当作当前证据。逐需求调查首个失败，"
               "保留已成功前缀后重新顺序重放，后继 blocked 不能定性为独立冲突。检查新增文件碰撞、"
               "删除和重命名两端、依赖/API 漂移、migration bean+SQL、认证授权失败关闭、公开契约和测试。"
               "路径风险只是线索，必须读实现；不把无交叠当作无风险，不把 clean apply 当兼容或吸收。"
               "只按授权范围修改；不得回移未来上游内容或扩大业务边界。按仓库要求完成本地门、"
               "真实 CI、固定 digest 发布和消费方验收后，才能声明对应交付；本报告未执行这些门。\n\n"
               "逐 patch 裁决台账必须记录：编号、输入哈希、需求与消费方、触达文件、上游证据、"
               "重放状态及 blocked_by、保留/吸收/冲突裁决、最小适配、API/依赖/迁移/公开契约影响、"
               "验证命令与结果、未验证项、负责人及移除条件。\n\n"
               "分别验证模式 A（关闭 RBAC、无扩展）和模式 B（启用 RBAC、正式兼容扩展）的"
               "首装、登录、刷新、退出、拒绝及允许操作；已有安装升级须先备份数据库、安装凭据、"
               "部署配置、插件与镜像摘要，验证恢复与回退。调查新 plugin-auto-install migration 的"
               "执行条件、持久化配置和自动安装副作用，不能只看部署开关。\n\n"
               "交付顺序：先正式 host 的 CI 与镜像 digest，再由 plugin 使用正式宿主独立构建发布，"
               "最后 root 部署仓固定组合验收。最终报告审计源码提交、对象/标签、补丁和产物哈希、"
               "镜像 digest、完整门结果、失败与跳过、备份恢复证据和剩余限制；不得用候选或历史门"
               "代替对应最终输入的证据。\n\n"
               "停止前必须执行 docs/upstream-upgrade-agent.md 的交付前文档时效性门："
               "核对 README、部署命令、manifest 和机制文档的版本及发布状态，历史候选明确标识。"
               "先收敛文档再冻结发布提交；精确部署 gitlink 必须对应成功发布 CI，不能借用父提交。"
               "已知缺陷以目标版本真实交互验证，不以指定提交包含关系或修复代码形态代替。"
               "下次升级的旧正式部署基线由 root 主控固定为升级前已发布组合，不能继续沿用更早版本。"
               "监控命令退出或网络 EOF 不代表 CI 失败，必须回读远端运行状态后再裁决。\n")
    (output / 'ai-summary.md').write_text(summary)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--overlay', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--upstream', type=Path, required=True)
    parser.add_argument('--target', required=True, help='local tag/ref/commit; annotated tags are peeled')
    parser.add_argument('--target-commit', help='optional expected target commit')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        assess(args.overlay, args.upstream, args.target, args.output, args.target_commit)
    except (AssessmentError, OSError, ValueError) as exc:
        parser.exit(2, f'assessment failed: {exc}\n')


if __name__ == '__main__':
    main()
