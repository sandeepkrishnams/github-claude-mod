import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Access, Ci, Creating, GhAccount, Pr, Remote, RepoState, Worktree } from '../types'

const github = atom({ plugin: 'accounts-band', key: 'github' } as const, [] as GhAccount[])
const isHidden = atom({ plugin: 'accounts-band', key: 'isHidden' } as const, false)
const repos = atom({ plugin: 'accounts-band', key: 'repos' } as const, [] as string[])
const selected = atom({ plugin: 'accounts-band', key: 'selected' } as const, null as string | null)
const info = atom({ plugin: 'accounts-band', key: 'info' } as const, null as RepoState | null)
const access = atom({ plugin: 'accounts-band', key: 'access' } as const, {} as Access)
const creating = atom({ plugin: 'accounts-band', key: 'creating' } as const, null as Creating)

type Gh = { hosts: Record<string, { login: string; active: boolean }[]> }
type Run = { ok: boolean; out: string; err: string }
type Check = { status?: string; conclusion?: string; state?: string }

const GITHUB_LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#8B949E" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>'

const TIP = { fill: '#161B22', border: '#30363D', text: '#E6EDF3' } as const
const DOT = { active: '#3FB950', idle: '#8B949E', warn: '#D29922', fail: '#F85149' } as const
const CI_DOT: Record<Ci, string> = { pass: DOT.active, fail: DOT.fail, running: DOT.warn, none: DOT.idle }
const GITHUB_SLUG = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/
// Bash commands after which the GitHub side (PRs, CI) is worth fetching again
const GITHUB_CHANGING = /\bgh\b|\bgit\s+(push|pull|fetch|switch|checkout|merge|rebase|worktree)\b/

// Names longer than this are cut, the full one shown on hover
const MAX_NAME = 18

function shortName(name: string): string {
  return name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name
}

function levelOf(levels: Access, slug: string, login: string): 'read' | 'push' | null {
  return levels[slug]?.[login] ?? null
}

function baseName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function ciOf(checks: readonly Check[]): Ci {
  if (!checks.length) {
    return 'none'
  }
  const failed = ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'ERROR']
  if (checks.some(c => failed.includes(c.conclusion ?? c.state ?? ''))) {
    return 'fail'
  }
  const isRunning = (c: Check) =>
    c.state === 'PENDING' || (c.status !== undefined && c.status !== 'COMPLETED')
  return checks.some(isRunning) ? 'running' : 'pass'
}

async function sh(
  $: EngineInterface,
  argv: string[],
  cwd?: string,
  env?: Record<string, string>,
): Promise<Run> {
  try {
    const r = await $.process.run(argv, { cwd, env, timeoutMs: 20_000 })
    return { ok: r.exitCode === 0, out: r.stdout.trim(), err: r.stderr.trim() }
  } catch (error) {
    return { ok: false, out: '', err: String(error) }
  }
}

async function loadGithub($: EngineInterface): Promise<void> {
  const r = await sh($, ['gh', 'auth', 'status', '--json', 'hosts'])
  const accounts = r.ok
    ? ((JSON.parse(r.out) as Gh).hosts['github.com'] ?? []).map(a => ({
        login: a.login,
        isActive: a.active,
      }))
    : []
  await update($, github, () => accounts)
}

// The repo the session runs in, then any separate repos nested up to 3 levels below
async function discoverRepos($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const [top, nested] = await Promise.all([
    sh($, ['git', 'rev-parse', '--show-toplevel'], cwd),
    sh($, ['find', cwd, '-maxdepth', '3', '-name', 'node_modules', '-prune', '-o', '-name', '.git', '-print']),
  ])
  const found = nested.out
    .split('\n')
    .filter(Boolean)
    .map(p => p.replace(/\/\.git$/, ''))
  const list = [...new Set([...(top.ok ? [top.out] : []), ...found])]
  await update($, repos, () => list)
  await update($, selected, current =>
    current !== null && list.includes(current) ? current : (list[0] ?? null),
  )
}

function parseWorktrees(porcelain: string, path: string): Worktree[] {
  return porcelain
    .split('\n\n')
    .filter(Boolean)
    .map(block => {
      const wtPath = /^worktree (.+)$/m.exec(block)?.[1] ?? ''
      const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? '(detached)'
      return { path: wtPath, branch, isCurrent: wtPath === path }
    })
}

async function loadPr($: EngineInterface, path: string): Promise<Pr | null> {
  const r = await sh(
    $,
    ['gh', 'pr', 'view', '--json', 'number,state,isDraft,reviewDecision,statusCheckRollup'],
    path,
  )
  if (!r.ok) {
    return null
  }
  const pr = JSON.parse(r.out) as {
    number: number
    state: string
    isDraft: boolean
    reviewDecision: string
    statusCheckRollup: Check[]
  }
  return {
    number: pr.number,
    state: pr.state,
    isDraft: pr.isDraft,
    review: pr.reviewDecision,
    ci: ciOf(pr.statusCheckRollup ?? []),
  }
}

async function loadBranchCi($: EngineInterface, path: string, branch: string): Promise<Ci> {
  const r = await sh(
    $,
    ['gh', 'run', 'list', '--branch', branch, '--limit', '1', '--json', 'status,conclusion'],
    path,
  )
  if (!r.ok) {
    return 'none'
  }
  return ciOf(
    (JSON.parse(r.out) as { status: string; conclusion: string }[]).map(c => ({
      status: c.status.toUpperCase(),
      conclusion: c.conclusion.toUpperCase(),
    })),
  )
}

async function count($: EngineInterface, path: string, args: string[]): Promise<number> {
  const r = await sh($, ['gh', 'pr', 'list', ...args, '--limit', '200', '--json', 'number', '--jq', 'length'], path)
  return r.ok ? Number(r.out) || 0 : 0
}

async function loadRepo($: EngineInterface, withGithub: boolean): Promise<void> {
  const path = await read($, selected)
  if (path === null) {
    await update($, info, () => null)
    return
  }
  const git = (...args: string[]) => sh($, ['git', ...args], path)
  const [branch, sha, ab, status, remotesRaw, refs, wts] = await Promise.all([
    git('branch', '--show-current'),
    git('rev-parse', '--short', 'HEAD'),
    git('rev-list', '--left-right', '--count', '@{u}...HEAD'),
    git('status', '--porcelain'),
    git('remote', '-v'),
    git('for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'),
    git('worktree', 'list', '--porcelain'),
  ])
  const remotes: Remote[] = [
    ...new Map(
      remotesRaw.out
        .split('\n')
        .filter(line => line.endsWith('(fetch)'))
        .map(line => {
          const [name = '', url = ''] = line.split(/\s+/)
          return [name, { name, slug: GITHUB_SLUG.exec(url)?.[1] ?? null }] as const
        }),
    ).values(),
  ]
  const remoteNames = remotes.map(r => r.name)
  const [behind = 0, ahead = 0] = ab.ok ? ab.out.split(/\s+/).map(Number) : []
  const current = branch.out || sha.out
  const previous = await read($, info)
  const isSame = previous?.path === path && previous.branch === current
  const mainSlug = remotes.find(r => r.slug !== null)?.slug ?? null
  const active = (await read($, github)).find(a => a.isActive)?.login ?? ''
  const canRead = mainSlug !== null && levelOf(await read($, access), mainSlug, active) !== null

  let pr = isSame ? previous.pr : null
  let branchCi: Ci = isSame ? previous.branchCi : 'none'
  let openPrs = isSame ? previous.openPrs : 0
  let reviewPrs = isSame ? previous.reviewPrs : 0
  if (canRead && (withGithub || !isSame)) {
    ;[pr, branchCi, openPrs, reviewPrs] = await Promise.all([
      loadPr($, path),
      loadBranchCi($, path, current),
      count($, path, ['--state', 'open']),
      count($, path, ['--search', 'review-requested:@me']),
    ])
  }

  await update($, info, () => ({
    path,
    branch: current,
    ahead,
    behind,
    dirty: status.out ? status.out.split('\n').length : 0,
    remotes,
    branches: refs.out
      .split('\n')
      .filter(ref => ref && !remoteNames.includes(ref) && !ref.endsWith('/HEAD')),
    worktrees: parseWorktrees(wts.out, path),
    pr,
    branchCi,
    openPrs,
    reviewPrs,
  }))
}

// How each signed-in account can reach each GitHub remote of the selected repo
async function checkAccess($: EngineInterface): Promise<void> {
  const slugs = ((await read($, info))?.remotes ?? []).flatMap(r => (r.slug ? [r.slug] : []))
  const accounts = await read($, github)
  const result: Access = {}
  await Promise.all(
    accounts.map(async ({ login }) => {
      const token = await sh($, ['gh', 'auth', 'token', '--user', login])
      if (!token.ok) {
        return
      }
      for (const slug of slugs) {
        const r = await sh($, ['gh', 'api', `repos/${slug}`, '--jq', '.permissions.push'], undefined, {
          GH_TOKEN: token.out,
        })
        if (r.ok) {
          result[slug] = { ...result[slug], [login]: r.out === 'true' ? 'push' : 'read' }
        }
      }
    }),
  )
  await update($, access, () => result)
}

async function switchGithub(
  $: EngineInterface,
  login: string,
  rememberFor: string | null,
): Promise<boolean> {
  const r = await sh($, ['gh', 'auth', 'switch', '--hostname', 'github.com', '--user', login])
  $.ui.toast(r.ok ? `GitHub: switched to ${login}` : `gh: ${r.err}`)
  if (r.ok && rememberFor !== null) {
    await $.store.set(`account:${rememberFor}`, login)
  }
  await loadGithub($)
  // The new account may see PRs and CI the old one could not
  await loadRepo($, true)
  return r.ok
}

// The account remembered for this repo if it can still read it; else, when the active
// account cannot push, the first that can push, then the first that can read
async function autoPickAccount($: EngineInterface): Promise<void> {
  const repo = await read($, info)
  const slug = repo?.remotes.find(r => r.slug !== null)?.slug ?? null
  if (repo === null || slug === null) {
    return
  }
  const levels = (await read($, access))[slug] ?? {}
  const active = (await read($, github)).find(a => a.isActive)?.login ?? ''
  const remembered = await $.store.get(`account:${repo.path}`)
  const logins = Object.keys(levels)
  const target =
    typeof remembered === 'string' && remembered in levels
      ? remembered
      : levels[active] !== 'push'
        ? (logins.find(l => levels[l] === 'push') ?? (levels[active] ? undefined : logins[0]))
        : undefined
  if (target !== undefined && target !== active) {
    await switchGithub($, target, null)
  }
}

async function loadRepoWithAccess($: EngineInterface): Promise<void> {
  await loadRepo($, false)
  await checkAccess($)
  await autoPickAccount($)
  await loadRepo($, true)
}

async function refreshAll($: EngineInterface): Promise<void> {
  await Promise.all([loadGithub($), discoverRepos($)])
  await loadRepoWithAccess($)
}

async function selectRepo($: EngineInterface, path: string): Promise<void> {
  await update($, selected, () => path)
  await loadRepoWithAccess($)
}

async function gitAction($: EngineInterface, args: string[], done: string): Promise<void> {
  const repo = await read($, info)
  if (repo === null) {
    return
  }
  const r = await sh($, ['git', ...args], repo.path)
  $.ui.toast(r.ok ? done : `git: ${r.err.split('\n')[0]}`)
  await loadRepo($, true)
}

async function switchBranch($: EngineInterface, ref: string): Promise<void> {
  const repo = await read($, info)
  if (repo === null || ref === repo.branch) {
    return
  }
  if (repo.dirty > 0) {
    $.ui.toast(`Not switching: ${repo.dirty} uncommitted file(s) in ${baseName(repo.path)}`)
    await loadRepo($, false)
    return
  }
  // A remote branch (origin/x) is checked out as a local tracking branch x
  const remote = repo.remotes.find(r => ref.startsWith(`${r.name}/`))
  const name = remote ? ref.slice(remote.name.length + 1) : ref
  await gitAction($, ['switch', name], `Switched to ${name}`)
}

async function createFromInput($: EngineInterface, kind: Creating, name: string): Promise<void> {
  const repo = await read($, info)
  await update($, creating, () => null)
  if (repo === null || kind === null || !name.trim()) {
    return
  }
  const valid = await sh($, ['git', 'check-ref-format', '--branch', name.trim()], repo.path)
  if (!valid.ok) {
    $.ui.toast(`Not a valid branch name: ${name}`)
    return
  }
  const branch = valid.out
  if (kind === 'branch') {
    await gitAction($, ['switch', '-c', branch], `Created and switched to ${branch}`)
    return
  }
  const wtPath = `${repo.path}-${branch.replace(/[^\w.-]+/g, '-')}`
  await gitAction($, ['worktree', 'add', '-b', branch, wtPath], `Worktree ${branch} at ${wtPath}`)
}

async function openWorktree($: EngineInterface, path: string): Promise<void> {
  const wt = (await read($, info))?.worktrees.find(w => w.path === path)
  if (wt === undefined || wt.isCurrent) {
    return
  }
  // ponytail: a mod cannot start a session, so it drafts the ask for Claude to move this one
  await $.prompt.fill({ text: `Move this session to the worktree at ${wt.path} (branch ${wt.branch})` })
}

async function browse($: EngineInterface, target: string): Promise<void> {
  const repo = await read($, info)
  if (repo === null) {
    return
  }
  const argv =
    target === 'pr'
      ? ['gh', 'pr', 'view', '--web']
      : target === 'branch'
        ? ['gh', 'browse', '--branch', repo.branch]
        : ['gh', 'browse']
  const r = await sh($, argv, repo.path)
  if (!r.ok) {
    $.ui.toast(`gh: ${r.err.split('\n')[0]}`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refreshAll($).catch((error: unknown) => $.ui.toast(`accounts-band: ${String(error)}`))
    return result
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (/\bgh\s+auth\b/.test(e.command)) {
      await loadGithub($)
    }
    if (/\b(git|gh)\b/.test(e.command)) {
      await loadRepo($, GITHUB_CHANGING.test(e.command))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }

    const accounts = await read($, github)
    const repo = await read($, info)
    const repoList = await read($, repos)
    const canPush = await read($, access)
    const pending = await read($, creating)
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    const hasSvg = 'Svg' in table
    const active = accounts.find(a => a.isActive)
    const mainSlug = repo?.remotes.find(r => r.slug !== null)?.slug ?? null
    const levelFor = (login: string) => (mainSlug ? levelOf(canPush, mainSlug, login) : null)
    const activeLevel = active ? levelFor(active.login) : null

    // The terminal draws no Svg: a glyph stands in for the logo there
    const githubLogo = hasSvg ? (
      <table.Svg source={GITHUB_LOGO} alt="GitHub" width={11} height={11} />
    ) : (
      <Text bold>◉</Text>
    )

    const tip = (text: string) =>
      hasSvg && text.length > MAX_NAME ? (
        <Box
          position="absolute"
          top={-26}
          left={0}
          display="none"
          hover={{ display: 'flex' }}
          backgroundColor={TIP.fill}
          borderStyle="round"
          borderColor={TIP.border}
          paddingX={1}
        >
          <Text size="caption" mono color={TIP.text}>
            {text}
          </Text>
        </Box>
      ) : null

    const label = (text: string, color?: string) => (
      <Text size="caption" mono color={color} dimColor={color === undefined}>
        {text}
      </Text>
    )

    const chip = (
      key: string,
      dot: string,
      text: string,
      body: ReturnType<typeof Text> | null = null,
    ) => (
      <Box key={key} position="relative" flexDirection="row" alignItems="center" gap="xs" paddingX="xs">
        <Text color={dot}>●</Text>
        {body ?? (
          <Text size="caption" mono weight="medium">
            {shortName(text)}
          </Text>
        )}
        {tip(text)}
      </Box>
    )

    const accountRow = (
      <Box key="accounts" flexDirection="row" alignItems="center" gap="sm">
        {githubLogo}
        {chip(
          'gh-active',
          active ? DOT.active : DOT.idle,
          `${active?.login ?? 'signed out'}${activeLevel === 'read' ? ' (read only)' : ''}`,
        )}
        {accounts
          .filter(a => !a.isActive)
          .map(a =>
            chip(
              `gh-${a.login}`,
              levelFor(a.login) ? DOT.active : DOT.idle,
              a.login,
              <Button
                key={`sw-${a.login}`}
                label={`⇄ ${shortName(a.login)}`}
                plain
                dimColor
                hover={{ dimColor: false }}
                onPress={() => switchGithub($, a.login, repo?.path ?? null)}
              />,
            ),
          )}
      </Box>
    )

    // The account row alone: outside a repo, on a GitHub repo the active account cannot
    // read, and in the mobile app, which draws no Select or Input
    if (repo === null || (mainSlug !== null && activeLevel === null) || !('Select' in table)) {
      return (
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" width="100%" paddingX="sm">
          {accountRow}
          <Button key="hide" label="×" plain dimColor onPress={() => update($, isHidden, () => true)} />
        </Box>
      )
    }

    const { Input, Select } = table
    const prText = repo.pr
      ? `#${repo.pr.number} ${repo.pr.isDraft ? 'draft' : repo.pr.state.toLowerCase()}${repo.pr.review ? ` · ${repo.pr.review.toLowerCase().replace(/_/g, ' ')}` : ''}`
      : 'no PR'
    const ci = repo.pr?.ci ?? repo.branchCi

    return (
      <Box flexDirection="column" width="100%" paddingX="sm" gap="xs">
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" width="100%">
          {repoList.length > 1 ? (
            <Select
              key="repo"
              label="repo"
              value={repo.path}
              options={repoList.map(p => ({ value: p, label: baseName(p) }))}
              onSelect={p => selectRepo($, p)}
            />
          ) : (
            label(baseName(repo.path))
          )}
          <Select
            key="branch"
            label="⎇"
            value={repo.branch}
            options={(repo.branches.includes(repo.branch) ? repo.branches : [repo.branch, ...repo.branches]).map(b => ({
              value: b,
            }))}
            onSelect={b => switchBranch($, b)}
          />
          {label(
            `↑${repo.ahead} ↓${repo.behind}${repo.dirty ? ` ●${repo.dirty}` : ''}`,
            repo.dirty ? DOT.warn : undefined,
          )}
          {repo.worktrees.length > 1 ? (
            <Select
              key="worktree"
              label="worktree"
              value={repo.path}
              options={repo.worktrees.map(w => ({ value: w.path, label: `${baseName(w.path)} (${w.branch})` }))}
              onSelect={p => openWorktree($, p)}
            />
          ) : null}
          {repo.remotes.map(r =>
            label(
              `${r.name}${r.slug ? `: ${r.slug}${active && levelOf(canPush, r.slug, active.login) === 'push' ? ' ✓' : ' ✗'}` : ''}`,
            ),
          )}
          {pending === null ? (
            <Box key="actions" flexDirection="row" gap="sm">
              <Button key="fetch" label="⟳ fetch" plain dimColor onPress={() => gitAction($, ['fetch', '--all', '--prune'], 'Fetched')} />
              <Button key="pull" label="⇣ pull" plain dimColor onPress={() => gitAction($, ['pull', '--ff-only'], 'Pulled')} />
              <Button key="new-branch" label="+ branch" plain dimColor onPress={() => update($, creating, () => 'branch')} />
              <Button key="new-worktree" label="+ worktree" plain dimColor onPress={() => update($, creating, () => 'worktree')} />
            </Box>
          ) : (
            <Box key="create" flexDirection="row" gap="sm" alignItems="center">
              <Input
                key="create-name"
                placeholder={pending === 'branch' ? 'new branch name' : 'new worktree branch'}
                submitLabel="Create"
                autoFocus
                onSubmit={name => createFromInput($, pending, name)}
              />
              <Button key="cancel" label="cancel" plain dimColor onPress={() => update($, creating, () => null)} />
            </Box>
          )}
        </Box>
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" width="100%">
          {accountRow}
          {mainSlug ? chip('pr', CI_DOT[ci], `${prText}${ci === 'none' ? '' : ` · CI ${ci}`}`) : null}
          {mainSlug ? label(`PRs ${repo.openPrs} · review ${repo.reviewPrs}`) : null}
          {mainSlug ? (
            <Select
              key="open"
              label="↗"
              value="repo"
              options={[
                { value: 'repo', label: 'repo' },
                { value: 'branch', label: 'branch' },
                ...(repo.pr ? [{ value: 'pr', label: `PR #${repo.pr.number}` }] : []),
              ]}
              onSelect={target => browse($, target)}
            />
          ) : null}
          <Button key="refresh" label="↻" plain dimColor onPress={() => refreshAll($)} />
          <Button key="hide" label="×" plain dimColor onPress={() => update($, isHidden, () => true)} />
        </Box>
      </Box>
    )
  })
}
