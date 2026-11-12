export type GhAccount = { login: string; isActive: boolean }

export type RepoState = {
  path: string
  branch: string
  hasUpstream: boolean
  ahead: number
  behind: number
  dirty: number
  // owner/repo of each GitHub remote, the first one the repo's main
  slugs: string[]
  remoteNames: string[]
  branches: string[]
}

// GitHub remote (owner/repo) -> signed-in login -> what that account may do there
export type Access = Record<string, Record<string, 'read' | 'push'>>

declare module 'claude-code' {
  interface PluginState {
    'accounts-band': {
      github: GhAccount[]
      isHidden: boolean
      repos: string[]
      selected: string | null
      info: RepoState | null
      access: Access
      isExpanded: boolean
    }
  }
}
