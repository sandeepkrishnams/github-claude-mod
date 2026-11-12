import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Access, GhAccount, RepoState } from '../types'

const github = atom({ plugin: 'accounts-band', key: 'github' } as const, [] as GhAccount[])
const isHidden = atom({ plugin: 'accounts-band', key: 'isHidden' } as const, false)
const repos = atom({ plugin: 'accounts-band', key: 'repos' } as const, [] as string[])
const selected = atom({ plugin: 'accounts-band', key: 'selected' } as const, null as string | null)
const info = atom({ plugin: 'accounts-band', key: 'info' } as const, null as RepoState | null)
const access = atom({ plugin: 'accounts-band', key: 'access' } as const, {} as Access)
const isExpanded = atom({ plugin: 'accounts-band', key: 'isExpanded' } as const, false)

type Gh = { hosts: Record<string, { login: string; active: boolean }[]> }
type Run = { ok: boolean; out: string; err: string }

const GITHUB_LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#8B949E" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>'

const DOT = { active: '#3FB950', idle: '#8B949E', warn: '#D29922' } as const
const TIP = { fill: '#161B22', border: '#30363D', text: '#E6EDF3' } as const
const GITHUB_SLUG = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/

// Names longer than this are cut in the collapsed row; the expanded one shows them whole
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

async function sh(
  $: EngineInterface,
  argv: string[],
  cwd?: string,
  env?: Record<string, string>,
): Promise<Run> {
  try {
    const r = await $.process.run(argv, { cwd, env, timeoutMs: 60_000 })
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

async function loadRepo($: EngineInterface): Promise<void> {
  const path = await read($, selected)
  if (path === null) {
    await update($, info, () => null)
    return
  }
  const git = (...args: string[]) => sh($, ['git', ...args], path)
  const [branch, sha, ab, status, remotesRaw, refs] = await Promise.all([
    git('branch', '--show-current'),
    git('rev-parse', '--short', 'HEAD'),
    git('rev-list', '--left-right', '--count', '@{u}...HEAD'),
    git('status', '--porcelain'),
    git('remote', '-v'),
    git('for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'),
  ])
  const fetchLines = remotesRaw.out.split('\n').filter(line => line.endsWith('(fetch)'))
  const remoteNames = fetchLines.map(line => line.split(/\s+/)[0] ?? '')
  const slugs = [
    ...new Set(fetchLines.flatMap(line => GITHUB_SLUG.exec(line.split(/\s+/)[1] ?? '')?.[1] ?? [])),
  ]
  const [behind = 0, ahead = 0] = ab.ok ? ab.out.split(/\s+/).map(Number) : []

  await update($, info, () => ({
    path,
    branch: branch.out || sha.out,
    hasUpstream: ab.ok,
    ahead,
    behind,
    dirty: status.out ? status.out.split('\n').length : 0,
    slugs,
    remoteNames,
    branches: refs.out
      .split('\n')
      .filter(ref => ref && !remoteNames.includes(ref) && !ref.endsWith('/HEAD')),
  }))
}

// How each signed-in account can reach each GitHub remote of the selected repo
async function checkAccess($: EngineInterface): Promise<void> {
  const slugs = (await read($, info))?.slugs ?? []
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
  return r.ok
}

// The account remembered for this repo if it can still read it; else, when the active
// account cannot push, the first that can push, then the first that can read
async function autoPickAccount($: EngineInterface): Promise<void> {
  const repo = await read($, info)
  const slug = repo?.slugs[0]
  if (repo === null || slug === undefined) {
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
  await loadRepo($)
  await checkAccess($)
  await autoPickAccount($)
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
  $.ui.toast(`git ${args[0]}…`)
  const r = await sh($, ['git', ...args], repo.path)
  $.ui.toast(r.ok ? done : `git: ${r.err.split('\n').pop()}`)
  await loadRepo($)
}

async function push($: EngineInterface): Promise<void> {
  const repo = await read($, info)
  if (repo === null) {
    return
  }
  // A branch with no upstream yet is published to the first remote under its own name
  const args =
    repo.hasUpstream || repo.remoteNames[0] === undefined
      ? ['push']
      : ['push', '-u', repo.remoteNames[0], 'HEAD']
  await gitAction($, args, 'Pushed')
}

async function switchBranch($: EngineInterface, ref: string): Promise<void> {
  const repo = await read($, info)
  if (repo === null || ref === repo.branch) {
    return
  }
  if (repo.dirty > 0) {
    $.ui.toast(`Not switching: ${repo.dirty} uncommitted file(s) in ${baseName(repo.path)}`)
    await loadRepo($)
    return
  }
  // A remote branch (origin/x) is checked out as a local tracking branch x
  const remote = repo.remoteNames.find(name => ref.startsWith(`${name}/`))
  const name = remote ? ref.slice(remote.length + 1) : ref
  await gitAction($, ['switch', name], `Switched to ${name}`)
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
    if (/\bgit\b/.test(e.command)) {
      await loadRepo($)
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
    const levels = await read($, access)
    const expanded = await read($, isExpanded)
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    const hasSvg = 'Svg' in table
    const active = accounts.find(a => a.isActive)
    const mainSlug = repo?.slugs[0] ?? null
    const levelFor = (login: string) => (mainSlug ? levelOf(levels, mainSlug, login) : null)
    const activeLevel = active ? levelFor(active.login) : null
    // A repo shows only to an account that can read it (or when it has no GitHub remote)
    const shown = repo !== null && (mainSlug === null || activeLevel !== null) ? repo : null

    // The terminal draws no Svg: a glyph stands in for the logo there
    const githubLogo = hasSvg ? (
      <table.Svg source={GITHUB_LOGO} alt="GitHub" width={11} height={11} />
    ) : (
      <Text bold>◉</Text>
    )

    const text = (value: string, color?: string, isDim = false) => (
      <Text size="caption" mono color={color} dimColor={isDim}>
        {value}
      </Text>
    )
    const dot = (color: string) => <Text color={color}>●</Text>
    const action = (key: string, value: string, onPress: () => unknown) => (
      <Button key={key} label={value} plain dimColor hover={{ dimColor: false }} onPress={onPress} />
    )
    // A symbol-only button whose name appears above it while the pointer is on it
    const iconAction = (key: string, icon: string, name: string, onPress: () => unknown) => (
      <Box key={key} position="relative">
        {action(`${key}-button`, icon, onPress)}
        <Box
          position="absolute"
          top={-24}
          left={0}
          display="none"
          hover={{ display: 'flex' }}
          backgroundColor={TIP.fill}
          borderStyle="round"
          borderColor={TIP.border}
          paddingX={1}
        >
          <Text size="caption" mono color={TIP.text}>
            {name}
          </Text>
        </Box>
      </Box>
    )

    const summary = shown
      ? [
          shown.ahead ? `↑${shown.ahead}` : '',
          shown.behind ? `↓${shown.behind}` : '',
          shown.dirty ? `●${shown.dirty}` : '',
        ]
          .filter(Boolean)
          .join(' ')
      : ''

    // Collapsed: who you are, where you are, and whether anything needs a look
    const headline = (
      <Box key="headline" flexDirection="row" alignItems="center" justifyContent="space-between" width="100%">
        <Box flexDirection="row" alignItems="center" gap="sm">
          {githubLogo}
          {dot(active ? DOT.active : DOT.idle)}
          {text(shortName(active?.login ?? 'signed out'))}
        </Box>
        {shown ? (
          <Box flexDirection="row" alignItems="center" gap="sm">
            {text(baseName(shown.path), undefined, true)}
            {text(`⎇ ${shortName(shown.branch)}`)}
            {summary ? text(summary, shown.dirty ? DOT.warn : undefined, !shown.dirty) : null}
          </Box>
        ) : null}
        <Box flexDirection="row" alignItems="center" gap="sm">
          {action('toggle', expanded ? '▾ less' : '▸ more', () => update($, isExpanded, value => !value))}
          {action('hide', '×', () => update($, isHidden, () => true))}
        </Box>
      </Box>
    )

    if (!expanded || !('Select' in table)) {
      return headline
    }

    // Expanded: one labelled line per topic, the label column lined up
    const { Select } = table
    const section = (key: string, title: string, children: RenderChildren[]) => (
      <Box key={key} flexDirection="row" alignItems="center" gap="md" width="100%">
        {text(title.padEnd(8), undefined, true)}
        <Box flexDirection="row" alignItems="center" gap="md" flexGrow={1}>
          {children}
        </Box>
      </Box>
    )

    const accountLine = section('accounts', 'Account', [
      text(`${active?.login ?? 'signed out'}${activeLevel === 'read' ? ' (read only)' : ''}`),
      ...accounts
        .filter(a => !a.isActive)
        .map(a =>
          action(
            `sw-${a.login}`,
            `⇄ ${shortName(a.login)}${levelFor(a.login) ? ' ●' : ''}`,
            () => switchGithub($, a.login, shown?.path ?? null),
          ),
        ),
    ])

    return (
      <Box flexDirection="column" width="100%" gap="xs">
        {headline}
        {accountLine}
        {shown && repoList.length > 1
          ? section('repo', 'Repo', [
              <Select
                key="repo"
                value={shown.path}
                options={repoList.map(p => ({ value: p, label: baseName(p) }))}
                onSelect={p => selectRepo($, p)}
              />,
            ])
          : null}
        {shown
          ? section('branch', 'Branch', [
              <Select
                key="branch"
                value={shown.branch}
                options={(shown.branches.includes(shown.branch)
                  ? shown.branches
                  : [shown.branch, ...shown.branches]
                ).map(b => ({ value: b }))}
                onSelect={b => switchBranch($, b)}
              />,
              iconAction('fetch', '⟳', 'fetch', () => gitAction($, ['fetch', '--all', '--prune'], 'Fetched')),
              iconAction('pull', '⇣', 'pull', () => gitAction($, ['pull', '--ff-only'], 'Pulled')),
              iconAction('push', '⇡', 'push', () => push($)),
            ])
          : null}
      </Box>
    )
  })
}
