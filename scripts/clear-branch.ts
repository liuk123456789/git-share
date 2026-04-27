import { execSync } from 'child_process';
import checkbox from '@inquirer/checkbox';
import confirm from '@inquirer/confirm';

const PROTECTED_BRANCHES = [
  'main',
  'master',
  'release',
  'develop',
  'dev',
  'test',
  'pre',
  'prod',
];

function run(cmd: string): string {
  try {
    const output = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output?.trim() ?? '';
  } catch {
    return '';
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function getGitUserName(): string {
  return run('git config user.name');
}

function getGitUserEmail(): string {
  return run('git config user.email');
}

function getCurrentBranch(): string {
  return run('git branch --show-current');
}

function getDefaultBaseBranch(): string {
  const remoteHead = run('git symbolic-ref --short refs/remotes/origin/HEAD');
  if (remoteHead.startsWith('origin/')) {
    return remoteHead;
  }

  for (const candidate of ['origin/main', 'origin/master', 'origin/develop','origin/test','origin/pre','origin/prod','origin/dev','origin/release']) {
    if (run(`git rev-parse --verify ${candidate}`)) {
      return candidate;
    }
  }

  return '';
}

function parseBranchNames(output: string, isRemote: boolean): string[] {
  if (!output) return [];

  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((rawName) => (isRemote ? rawName.replace(/^origin\//, '') : rawName).trim())
    .filter((name) => !!name && name !== 'HEAD' && name !== 'origin')
    .filter((name) => !PROTECTED_BRANCHES.includes(name));
}

function getLocalBranches(): string[] {
  const output = run('git for-each-ref --format="%(refname:short)" refs/heads');
  return parseBranchNames(output, false);
}

function getRemoteBranches(): string[] {
  const output = run('git for-each-ref --format="%(refname:short)" refs/remotes/origin');
  return parseBranchNames(output, true);
}

function isBranchCreatedByMe(branchRef: string, baseRef: string, myName: string, myEmail: string): boolean {
  if (!baseRef) return false;

  const firstCommit = run(`git rev-list --reverse --max-count=1 ${baseRef}..${branchRef}`);
  if (!firstCommit) return false;

  const authorInfo = run(`git show -s --format="%an|%ae" ${firstCommit}`);
  if (!authorInfo) return false;

  const [authorName = '', authorEmail = ''] = authorInfo.split('|');
  const nameMatched = normalize(authorName) === normalize(myName);
  const emailMatched = !!myEmail && normalize(authorEmail) === normalize(myEmail);

  return nameMatched || emailMatched;
}

function getMyLocalBranches(myName: string, myEmail: string, baseRef: string): string[] {
  return getLocalBranches().filter((branch) =>
    isBranchCreatedByMe(`refs/heads/${branch}`, baseRef, myName, myEmail),
  );
}

function getMyRemoteBranches(myName: string, myEmail: string, baseRef: string): string[] {
  return getRemoteBranches().filter((branch) =>
    isBranchCreatedByMe(`refs/remotes/origin/${branch}`, baseRef, myName, myEmail),
  );
}

function deleteLocalBranch(branch: string): void {
  execSync(`git branch -D "${branch}"`, { stdio: 'ignore' });
}

function deleteRemoteBranch(branch: string): void {
  execSync(`git push origin --delete "${branch}"`, { stdio: 'ignore' });
}

async function main(): Promise<void> {
  const myGitName = getGitUserName();
  const myGitEmail = getGitUserEmail();
  const currentBranch = getCurrentBranch();

  if (!myGitName) {
    console.log('未读取到 git 用户名，请先设置：git config user.name "<your-name>"');
    return;
  }

  run('git fetch --prune origin');
  const baseRef = getDefaultBaseBranch();

  if (!baseRef) {
    console.log('未找到 origin 默认分支，请先检查远程并执行 git fetch。');
    return;
  }

  console.log('Git 分支清理工具（仅清理自己创建的分支）');
  console.log(`当前用户：${myGitName}`);
  if (myGitEmail) {
    console.log(`当前邮箱：${myGitEmail}`);
  }
  console.log(`基准分支：${baseRef}`);
  console.log(`核心分支已保留：${PROTECTED_BRANCHES.join(', ')}`);
  console.log('判定规则：按“分支相对基准分支的首个独有提交作者”识别创建者');
  console.log('-----------------------------------\n');

  const localMine = getMyLocalBranches(myGitName, myGitEmail, baseRef);
  const remoteMine = getMyRemoteBranches(myGitName, myGitEmail, baseRef);
  const allMine = Array.from(new Set([...localMine, ...remoteMine])).filter(
    (branch) => branch !== currentBranch,
  );

  if (allMine.length === 0) {
    console.log('没有可清理的个人分支');
    return;
  }

  const selected = await checkbox({
    message: '勾选要删除的分支（空格选择，回车确认）',
    choices: allMine.map((branch) => ({ name: branch, value: branch })),
  });

  if (selected.length === 0) {
    console.log('未选择任何分支');
    return;
  }

  const ok = await confirm({
    message: `确定删除 ${selected.length} 个分支？`,
    default: false,
  });

  if (!ok) {
    console.log('已取消');
    return;
  }

  console.log('\n开始删除...\n');

  for (const branch of selected) {
    if (branch === currentBranch) {
      console.log(`跳过当前分支：${branch}`);
      continue;
    }
    try {
      if (localMine.includes(branch)) {
        deleteLocalBranch(branch);
        console.log(`删除本地：${branch}`);
      }
      if (remoteMine.includes(branch)) {
        deleteRemoteBranch(branch);
        console.log(`删除远程：${branch}`);
      }
    } catch {
      console.log(`删除失败：${branch}`);
    }
  }

  console.log('\n清理完成');
}

void main();
