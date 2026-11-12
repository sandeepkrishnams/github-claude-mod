# accounts-band

A Claude Code mod that shows which GitHub and Zoho Sprints accounts are connected, in a band just above the prompt box.

- **GitHub**: the active `gh` account in bold, plus a `↔ <login>` button for each other signed-in account. Clicking one runs `gh auth switch`.
- **Zoho Sprints**: `✓` when the connected Zoho account can read your workspace, `✗ no access` when it can't. Clicking re-checks; to change the Zoho account, reconnect the connector in `/mcp` or claude.ai → Connectors.
- **Hide** turns the band off for the session.

It refreshes when a session starts and after any `gh auth …` command.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install accounts-band --marketplace sandeepkrishnams/github-claude-mod
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```bash
claude plugin install accounts-band --marketplace sandeepkrishnams/github-claude-mod
```

In the desktop app: click + next to the prompt box → Plugins → Add marketplace `sandeepkrishnams/github-claude-mod` → Add plugin.

## Setup

In the plugin's config, set:

- `zohoTeamId`: your Zoho Sprints workspace (team) ID
- `zohoLabel`: the name to show for it

Needs the [GitHub CLI](https://cli.github.com/) and the Zoho Sprints connector.

## Notes

- `gh auth switch` changes the active account for every terminal on the machine. Git over SSH still uses your SSH keys.
- The Zoho connector has no "who am I" call, so the band shows access to the workspace, not the user name.
