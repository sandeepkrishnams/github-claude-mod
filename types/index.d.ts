export type GhAccount = { login: string; isActive: boolean }

declare module 'claude-code' {
  interface PluginState {
    'accounts-band': { github: GhAccount[]; isHidden: boolean }
  }
}
