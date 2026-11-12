import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Access, GhAccount, RepoState } from '../types'

const github = atom({ plugin: 'accounts-band', key: 'github' } as const, [] as GhAccount[])
const isHidden = atom({ plugin: 'accounts-band', key: 'isHidden' } as const, false)
// Keyed apart from the old 'repos' list: $.state outlives a reload, so a renamed shape needs a new key
const repos = atom({ plugin: 'accounts-band', key: 'repoStates' } as const, {} as Record<string, RepoState>)
const access = atom({ plugin: 'accounts-band', key: 'access' } as const, {} as Access)
const isLoading = atom({ plugin: 'accounts-band', key: 'isLoading' } as const, false)
const currentRepo = atom({ plugin: 'accounts-band', key: 'currentRepo' } as const, null as string | null)

type Gh = { hosts: Record<string, { login: string; active: boolean }[]> }
type Run = { ok: boolean; out: string; err: string }

const GITHUB_LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#8B949E" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>'

const DOT = { active: '#3FB950', idle: '#8B949E', warn: '#D29922' } as const
// One hue per meaning, readable on light and dark: ahead/pull green, behind/push blue,
// branch purple, the selected repo orange
const HUE = { ahead: '#3FB950', behind: '#58A6FF', branch: '#A371F7', repo: '#F0883E' } as const
const TIP = { fill: '#161B22', border: '#30363D', text: '#E6EDF3' } as const
const GITHUB_SLUG = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/

// Names longer than this are cut short where they are shown as plain text
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
    git('for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'),
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

async function syncAll($: EngineInterface, path: string | undefined): Promise<void> {
  if (path !== undefined) {
    const r = await sh($, ['git', 'fetch', '--all', '--prune'], path)
    $.ui.toast(r.ok ? `${baseName(path)}: fetched` : `${baseName(path)}: ${r.err.split('\n').pop()}`)
  }
  await refreshAll($)
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

// The pickers are plain text buttons that open Claude's choice dialog: a dropdown
// carries a background the band cannot take off. The dialog shows 2 to 4 choices
// and "Other", where any name can be typed.
async function pickAccount($: EngineInterface): Promise<void> {
  const accounts = await read($, github)
  const active = accounts.find(a => a.isActive)?.login
  // Accounts that can reach the project's repos come first
  const levels = await read($, access)
  const reaches = (login: string) => Object.values(levels).some(l => l[login] !== undefined)
  const others = accounts
    .filter(a => !a.isActive)
    .map(a => a.login)
    .sort((x, y) => Number(reaches(y)) - Number(reaches(x)))
  const choices = [...others, ...(active ? [active] : [])].slice(0, 4)
  if (choices.length < 2) {
    return
  }
  const login = await $.ui.ask('Switch to which GitHub account?', { header: 'Account', options: choices }).catch(
    () => null,
  )
  if (login !== null && login !== active) {
    await switchGithub($, login.trim(), true)
  }
}

async function pickBranch($: EngineInterface, repo: RepoState): Promise<void> {
  // Most recently committed first; a remote branch only when no local one shares its name
  const local = new Set(repo.branches.filter(b => !repo.remoteNames.some(r => b.startsWith(`${r}/`))))
  const choices = repo.branches
    .filter(b => b !== repo.branch)
    .filter(b => {
      const remote = repo.remoteNames.find(r => b.startsWith(`${r}/`))
      return remote === undefined || !local.has(b.slice(remote.length + 1))
    })
    .slice(0, 4)
  if (choices.length < 2) {
    choices.push(repo.branch)
  }
  const branch = await $.ui
    .ask(`Switch ${baseName(repo.path)} to which branch?`, { header: 'Branch', options: choices })
    .catch(() => null)
  if (branch !== null) {
    await switchBranch($, repo, branch.trim())
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // A reload also starts here: show the band again even if it was closed before
    await update($, isHidden, () => false)
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

    const action = (key: string, value: string, onPress: () => unknown, hue?: string) => (
      <Button
        key={key}
        label={value}
        plain
        dimColor
        hover={hue ? { dimColor: false, color: hue } : { dimColor: false }}
        onPress={onPress}
      />
    )
    const quiet = (value: string, color?: string) => (
      <Text size="caption" mono color={color} dimColor={color === undefined}>
        {value}
      </Text>
    )
    // A symbol-only button whose name appears above it while the pointer is on it
    const iconAction = (key: string, icon: string, name: string, onPress: () => unknown, hue?: string) => (
      <Box key={key} position="relative">
        {action(`${key}-button`, icon, onPress, hue)}
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
    // Ahead, behind and uncommitted counts, each in its own colour, only when not zero
    const counts = (repo: RepoState) =>
      [
        repo.ahead ? quiet(`↑${repo.ahead}`, HUE.ahead) : null,
        repo.behind ? quiet(`↓${repo.behind}`, HUE.behind) : null,
        repo.dirty ? quiet(`●${repo.dirty}`, DOT.warn) : null,
      ].filter(Boolean)


    const account =
      accounts.length > 1 ? (
        <Button
          key="account"
          label={`${shortName(active?.login ?? 'signed out')} ▾`}
          plain
          hover={{ color: DOT.active }}
          onPress={() => pickAccount($)}
        />
      ) : (
        quiet(shortName(active?.login ?? 'signed out'))
      )

    // The tab picked by hand while it is still listed, else the first repo
    const picked = await read($, currentRepo)
    const current = visible.find(r => r.path === picked) ?? visible[0]

    const tab = (repo: RepoState) => {
      const isCurrent = repo.path === current?.path
      return (
        <Box key={`tab-${repo.path}`} flexDirection="row" alignItems="center" gap="xs">
          {isCurrent ? <Text color={HUE.repo}>▸</Text> : null}
          <Button
            key={`tab-button-${repo.path}`}
            label={baseName(repo.path)}
            plain
            dimColor={!isCurrent}
            hover={{ dimColor: false, color: HUE.repo }}
            onPress={() => update($, currentRepo, () => repo.path)}
          />
          {counts(repo)}
        </Box>
      )
    }

    // One quiet row: account and repo tabs on the left; the current repo's branch and
    // actions, then close, pushed to the right
    return (
      <Box key="band" flexDirection="row" alignItems="center" width="100%">
        <Box key="left" flexDirection="row" alignItems="center" gap="sm">
          <Box key="who" flexDirection="row" alignItems="center" gap="xs">
            {githubLogo}
            <Text color={active ? DOT.active : DOT.idle}>●</Text>
            {account}
          </Box>
          {visible.length
            ? visible.map(tab)
            : quiet(loading ? 'looking for repos…' : 'no git repo here')}
        </Box>
        <Box key="spacer" flexGrow={1} />
        <Box key="right" flexDirection="row" alignItems="center" gap="xs">
          {current ? (
            <Box key="branch" flexDirection="row" alignItems="center" gap="xs">
              {quiet('⎇', HUE.branch)}
              <Button
                key={`branch-${current.path}`}
                label={`${shortName(current.branch)} ▾`}
                plain
                hover={{ color: HUE.branch }}
                onPress={() => pickBranch($, current)}
              />
              {iconAction(`pull-${current.path}`, '⇣', 'pull', () =>
                gitAction($, current.path, ['pull', '--ff-only'], 'pulled'), HUE.ahead,
              )}
              {iconAction(`push-${current.path}`, '⇡', 'push', () => push($, current), HUE.behind)}
            </Box>
          ) : null}
          {/* The one refresh: fetches every remote of the current repo, then re-reads
              accounts and repos; with no repo it only re-reads */}
          {iconAction('sync', '⟳', current ? 'fetch & refresh' : 'refresh', () => syncAll($, current?.path), HUE.branch)}
          {action('hide', '×', () => update($, isHidden, () => true))}
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
