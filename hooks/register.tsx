import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Access, GhAccount, RepoState } from '../types'

const github = atom({ plugin: 'accounts-band', key: 'github' } as const, [] as GhAccount[])
const isHidden = atom({ plugin: 'accounts-band', key: 'isHidden' } as const, false)
const repos = atom({ plugin: 'accounts-band', key: 'repos' } as const, {} as Record<string, RepoState>)
const access = atom({ plugin: 'accounts-band', key: 'access' } as const, {} as Access)
const isExpanded = atom({ plugin: 'accounts-band', key: 'isExpanded' } as const, false)
const isLoading = atom({ plugin: 'accounts-band', key: 'isLoading' } as const, false)

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

function baseName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

// Whether the active account may see a repo: yes without a GitHub remote, and yes until
// its access is known, so the band never hides a repo it has not checked
function isVisible(repo: RepoState, levels: Access, active: string): boolean {
  const slug = repo.slugs[0]
  return slug === undefined || levels[slug] === undefined || levels[slug]?.[active] !== undefined
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

async function readRepo($: EngineInterface, path: string): Promise<RepoState> {
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
  return {
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
  }
}

// The repo the session runs in, then every separate repo nested up to 3 levels below
async function loadRepos($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const [top, nested] = await Promise.all([
    sh($, ['git', 'rev-parse', '--show-toplevel'], cwd),
    sh($, ['find', cwd, '-maxdepth', '3', '-name', 'node_modules', '-prune', '-o', '-name', '.git', '-print']),
  ])
  const paths = [
    ...new Set([
      ...(top.ok ? [top.out] : []),
      ...nested.out
        .split('\n')
        .filter(Boolean)
        .map(p => p.replace(/\/\.git$/, '')),
    ]),
  ]
  const states = await Promise.all(paths.map(path => readRepo($, path)))
  await update($, repos, () => Object.fromEntries(states.map(s => [s.path, s])))
}

async function reloadRepo($: EngineInterface, path: string): Promise<void> {
  const state = await readRepo($, path)
  await update($, repos, current => ({ ...current, [path]: state }))
}

// How each signed-in account can reach each GitHub remote of the project's repos
async function checkAccess($: EngineInterface): Promise<void> {
  const slugs = [...new Set(Object.values(await read($, repos)).flatMap(r => r.slugs))]
  const accounts = await read($, github)
  const result: Access = Object.fromEntries(slugs.map(slug => [slug, {}]))
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

async function switchGithub($: EngineInterface, login: string, isRemembered: boolean): Promise<void> {
  const r = await sh($, ['gh', 'auth', 'switch', '--hostname', 'github.com', '--user', login])
  $.ui.toast(r.ok ? `GitHub: switched to ${login}` : `gh: ${r.err}`)
  if (r.ok && isRemembered) {
    await $.store.set(`account:${await $.session.cwd()}`, login)
  }
  await loadGithub($)
}

// The account remembered for this project if it can still read its repos; else, when the
// active account cannot push to the first GitHub repo, the first that can, then one that reads
async function autoPickAccount($: EngineInterface): Promise<void> {
  const slug = Object.values(await read($, repos)).find(r => r.slugs.length)?.slugs[0]
  if (slug === undefined) {
    return
  }
  const levels = (await read($, access))[slug] ?? {}
  const active = (await read($, github)).find(a => a.isActive)?.login ?? ''
  const remembered = await $.store.get(`account:${await $.session.cwd()}`)
  const logins = Object.keys(levels)
  const target =
    typeof remembered === 'string' && remembered in levels
      ? remembered
      : levels[active] !== 'push'
        ? (logins.find(l => levels[l] === 'push') ?? (levels[active] ? undefined : logins[0]))
        : undefined
  if (target !== undefined && target !== active) {
    await switchGithub($, target, false)
  }
}

async function refreshAll($: EngineInterface): Promise<void> {
  await update($, isLoading, () => true)
  try {
    await Promise.all([loadGithub($), loadRepos($)])
    await checkAccess($)
    await autoPickAccount($)
  } finally {
    await update($, isLoading, () => false)
  }
}

async function gitAction($: EngineInterface, path: string, args: string[], done: string): Promise<void> {
  $.ui.toast(`${baseName(path)}: git ${args[0]}…`)
  const r = await sh($, ['git', ...args], path)
  $.ui.toast(r.ok ? `${baseName(path)}: ${done}` : `${baseName(path)}: ${r.err.split('\n').pop()}`)
  await reloadRepo($, path)
}

async function push($: EngineInterface, repo: RepoState): Promise<void> {
  // A branch with no upstream yet is published to the first remote under its own name
  const args =
    repo.hasUpstream || repo.remoteNames[0] === undefined
      ? ['push']
      : ['push', '-u', repo.remoteNames[0], 'HEAD']
  await gitAction($, repo.path, args, 'pushed')
}

async function switchBranch($: EngineInterface, repo: RepoState, ref: string): Promise<void> {
  if (ref === repo.branch) {
    return
  }
  if (repo.dirty > 0) {
    $.ui.toast(`Not switching: ${repo.dirty} uncommitted file(s) in ${baseName(repo.path)}`)
    await reloadRepo($, repo.path)
    return
  }
  // A remote branch (origin/x) is checked out as a local tracking branch x
  const remote = repo.remoteNames.find(name => ref.startsWith(`${name}/`))
  const name = remote ? ref.slice(remote.length + 1) : ref
  await gitAction($, repo.path, ['switch', name], `switched to ${name}`)
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
      await Promise.all(Object.keys(await read($, repos)).map(path => reloadRepo($, path)))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }

    const accounts = await read($, github)
    const levels = await read($, access)
    const expanded = await read($, isExpanded)
    const loading = await read($, isLoading)
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    const hasSvg = 'Svg' in table
    const active = accounts.find(a => a.isActive)
    const visible = Object.values(await read($, repos)).filter(r =>
      isVisible(r, levels, active?.login ?? ''),
    )

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
    const counts = (repo: RepoState) =>
      [repo.ahead ? `↑${repo.ahead}` : '', repo.behind ? `↓${repo.behind}` : '', repo.dirty ? `●${repo.dirty}` : '']
        .filter(Boolean)
        .join(' ')

    const first = visible[0]
    const where =
      visible.length === 1 && first ? (
        <Box flexDirection="row" alignItems="center" gap="sm">
          {text(baseName(first.path), undefined, true)}
          {text(`⎇ ${shortName(first.branch)}`)}
          {counts(first) ? text(counts(first), first.dirty ? DOT.warn : undefined, !first.dirty) : null}
        </Box>
      ) : visible.length > 1 ? (
        text(
          `${visible.length} repos${visible.some(r => r.dirty) ? ` · ${visible.filter(r => r.dirty).length} with changes` : ''}`,
          undefined,
          true,
        )
      ) : (
        text(loading ? 'looking for repos…' : 'no git repo here', undefined, true)
      )

    // Collapsed: who you are, where you are, and whether anything needs a look
    const headline = (
      <Box key="headline" flexDirection="row" alignItems="center" justifyContent="space-between" width="100%">
        <Box flexDirection="row" alignItems="center" gap="sm">
          {githubLogo}
          {dot(active ? DOT.active : DOT.idle)}
          {text(shortName(active?.login ?? 'signed out'))}
        </Box>
        {where}
        <Box flexDirection="row" alignItems="center" gap="sm">
          {iconAction('refresh', '↻', 'refresh', () => refreshAll($))}
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
    const labelWidth = Math.max(8, ...visible.map(r => baseName(r.path).length + 1))
    const section = (key: string, title: string, children: RenderChildren[]) => (
      <Box key={key} flexDirection="row" alignItems="center" gap="md" width="100%">
        {text(title.padEnd(labelWidth), undefined, true)}
        <Box flexDirection="row" alignItems="center" gap="md" flexGrow={1}>
          {children}
        </Box>
      </Box>
    )
    const reachesAny = (login: string) =>
      visible.some(r => r.slugs[0] !== undefined && levels[r.slugs[0]]?.[login] !== undefined)

    return (
      <Box flexDirection="column" width="100%" gap="xs">
        {headline}
        {section('accounts', 'Account', [
          text(active?.login ?? 'signed out'),
          ...accounts
            .filter(a => !a.isActive)
            .map(a =>
              action(`sw-${a.login}`, `⇄ ${shortName(a.login)}${reachesAny(a.login) ? ' ●' : ''}`, () =>
                switchGithub($, a.login, true),
              ),
            ),
        ])}
        {visible.map(repo =>
          section(`repo-${repo.path}`, baseName(repo.path), [
            <Select
              key={`branch-${repo.path}`}
              label="⎇"
              value={repo.branch}
              options={(repo.branches.includes(repo.branch) ? repo.branches : [repo.branch, ...repo.branches]).map(
                b => ({ value: b }),
              )}
              onSelect={b => switchBranch($, repo, b)}
            />,
            counts(repo) ? text(counts(repo), repo.dirty ? DOT.warn : undefined, !repo.dirty) : null,
            iconAction(`fetch-${repo.path}`, '⟳', 'fetch', () =>
              gitAction($, repo.path, ['fetch', '--all', '--prune'], 'fetched'),
            ),
            iconAction(`pull-${repo.path}`, '⇣', 'pull', () => gitAction($, repo.path, ['pull', '--ff-only'], 'pulled')),
            iconAction(`push-${repo.path}`, '⇡', 'push', () => push($, repo)),
          ]),
        )}
      </Box>
    )
  })
}
