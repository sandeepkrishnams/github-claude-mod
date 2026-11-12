export type GhAccount = { login: string; isActive: boolean }
export type ZohoStatus = 'unknown' | 'ok' | 'denied'

declare module 'claude-code' {
  interface PluginState {
    'accounts-band': { github: GhAccount[]; zoho: ZohoStatus; isHidden: boolean }
  }
}
