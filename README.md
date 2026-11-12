# accounts-band

A Claude Code mod that shows your GitHub accounts in a band just above the prompt box and switches between them in one click.

- The active `gh` account, with a green dot.
- A `⇄ <login>` button for each other signed-in account. Clicking one runs `gh auth switch`.
- Long names are shortened; hover to see the full one.
- `×` hides the band for the session.

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

Needs the [GitHub CLI](https://cli.github.com/) with your accounts signed in (`gh auth login`).

## Notes

- `gh auth switch` changes the active account for every terminal on the machine. Git over SSH still uses your SSH keys.
