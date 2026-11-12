export type GhAccount = { login: string; isActive: boolean }

export type Remote = { name: string; slug: string | null }
export type Worktree = { path: string; branch: string; isCurrent: boolean }
export type Ci = 'pass' | 'fail' | 'running' | 'none'
export type Pr = {
  number: number
  state: string
  isDraft: boolean
  review: string
  ci: Ci
}

export type RepoState = {
  path: string
  branch: string
  ahead: number
  behind: number
  dirty: number
  remotes: Remote[]
  branches: string[]
  worktrees: Worktree[]
  pr: Pr | null
  branchCi: Ci
  openPrs: number
  reviewPrs: number
}

export type Creating = 'branch' | 'worktree' | null

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
      creating: Creating
    }
  }
}
