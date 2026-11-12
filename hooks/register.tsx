import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GhAccount, ZohoStatus } from '../types'

const github = atom({ plugin: 'accounts-band', key: 'github' } as const, [] as GhAccount[])
const zoho = atom({ plugin: 'accounts-band', key: 'zoho' } as const, 'unknown' as ZohoStatus)
const isHidden = atom({ plugin: 'accounts-band', key: 'isHidden' } as const, false)

const ZOHO_SERVER = 'claude.ai Zoho Sprints'
const RECONNECT_HINT =
  'Zoho Sprints: switch accounts by reconnecting it in /mcp or claude.ai → Connectors'

type Gh = { hosts: Record<string, { login: string; active: boolean }[]> }

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

// ponytail: the connector has no whoami tool, so access to the team stands in for identity
async function checkZoho($: EngineInterface, teamId: string): Promise<void> {
  if (!teamId) {
    return
  }
  const { isError } = await $.mcp.call(ZOHO_SERVER, 'ZohoSprints_GetProjects', {
    path_variables: { teamId },
    query_params: { action: 'data', index: 1, range: 1 },
    headers: { 'x-za-ui-version': 'v2', 'X-convert-response': 'true' },
  })
  await update($, zoho, () => (isError ? 'denied' : 'ok'))
}

async function switchGithub($: EngineInterface, login: string): Promise<void> {
  const { exitCode, stderr } = await $.process.run([
    'gh', 'auth', 'switch', '--hostname', 'github.com', '--user', login,
  ])
  $.ui.toast(exitCode === 0 ? `GitHub: switched to ${login}` : `gh: ${stderr.trim()}`)
  await loadGithub($)
}

async function recheckZoho($: EngineInterface, teamId: string): Promise<void> {
  await checkZoho($, teamId)
  if ((await read($, zoho)) !== 'ok') {
    $.ui.toast(RECONNECT_HINT)
  }
}

export const register: Register = (on, options) => {
  const teamId = String(options.zohoTeamId ?? '')
  const zohoName = String(options.zohoLabel || teamId || 'set team ID in plugin config')

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await Promise.allSettled([loadGithub($), checkZoho($, teamId)])
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
    const zohoStatus = await read($, zoho)
    const { Box, Button, Text } = $.ui.resolve(e)
    const active = accounts.find(a => a.isActive)
    const zohoMark = { ok: '✓', denied: '✗ no access', unknown: '…' }[zohoStatus]

    return (
      <Box>
        <Text dimColor>GitHub: </Text>
        <Text bold>{active?.login ?? 'not signed in'} </Text>
        {accounts
          .filter(a => !a.isActive)
          .map(a => (
            <Button
              key={`gh-${a.login}`}
              label={`↔ ${a.login}`}
              onPress={() => switchGithub($, a.login)}
            />
          ))}
        <Text dimColor> · Zoho: </Text>
        <Button key="zoho" label={`${zohoName} ${zohoMark}`} onPress={() => recheckZoho($, teamId)} />
        <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })
}
