import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GhAccount } from '../types'

const github = atom({ plugin: 'accounts-band', key: 'github' } as const, [] as GhAccount[])
const isHidden = atom({ plugin: 'accounts-band', key: 'isHidden' } as const, false)

type Gh = { hosts: Record<string, { login: string; active: boolean }[]> }

const GITHUB_LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#8B949E" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>'

const TIP = { fill: '#161B22', border: '#30363D', text: '#E6EDF3' } as const
const DOT = { active: '#3FB950', idle: '#8B949E' } as const

// Names longer than this are cut, the full one shown on hover
const MAX_NAME = 18

function shortName(name: string): string {
  return name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name
}

async function loadGithub($: EngineInterface): Promise<void> {
  const { exitCode, stdout } = await $.process.run(['gh', 'auth', 'status', '--json', 'hosts'])
  const accounts =
    exitCode === 0
      ? ((JSON.parse(stdout) as Gh).hosts['github.com'] ?? []).map(a => ({
          login: a.login,
          isActive: a.active,
        }))
      : []
  await update($, github, () => accounts)
}

async function switchGithub($: EngineInterface, login: string): Promise<void> {
  const { exitCode, stderr } = await $.process.run([
    'gh', 'auth', 'switch', '--hostname', 'github.com', '--user', login,
  ])
  $.ui.toast(exitCode === 0 ? `GitHub: switched to ${login}` : `gh: ${stderr.trim()}`)
  await loadGithub($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await loadGithub($).catch((error: unknown) => $.ui.toast(`GitHub accounts: ${String(error)}`))
    return result
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (/\bgh\s+auth\b/.test(e.command)) {
      await loadGithub($)
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }

    const accounts = await read($, github)
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    const hasSvg = 'Svg' in table
    const active = accounts.find(a => a.isActive)

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

    const chip = (
      key: string,
      dot: string,
      label: string,
      body: ReturnType<typeof Text> | null = null,
    ) => (
      <Box key={key} position="relative" flexDirection="row" alignItems="center" gap="xs" paddingX="xs">
        <Text color={dot}>●</Text>
        {body ?? (
          <Text size="caption" mono weight="medium">
            {shortName(label)}
          </Text>
        )}
        {tip(label)}
      </Box>
    )

    // One row, every item spaced evenly across the full width
    return (
      <Box flexDirection="row" alignItems="center" justifyContent="space-between" width="100%" paddingX="sm">
        {githubLogo}
        {chip('gh-active', active ? DOT.active : DOT.idle, active?.login ?? 'signed out')}
        {accounts
          .filter(a => !a.isActive)
          .map(a =>
            chip(
              `gh-${a.login}`,
              DOT.idle,
              a.login,
              <Button
                key={`sw-${a.login}`}
                label={`⇄ ${shortName(a.login)}`}
                plain
                dimColor
                hover={{ dimColor: false }}
                onPress={() => switchGithub($, a.login)}
              />,
            ),
          )}
        <Button key="hide" label="×" plain dimColor onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })
}
