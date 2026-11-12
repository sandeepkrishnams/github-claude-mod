# accounts-band

A Claude Code mod that puts your GitHub account and the project's repos in one row right above the prompt box:

- **Account**: a dropdown of your signed-in `gh` accounts; picking one runs `gh auth switch`. `●` marks accounts that can reach the project's repos.
- **Each repo**: the repo the session is in and every separate repo nested up to 3 folders down, each with a branch dropdown (refuses to switch with uncommitted changes), ahead/behind/uncommitted counts, and `⟳` fetch, `⇣` pull (fast-forward only), `⇡` push. Hover a symbol to see its name.
- `↻` refreshes, `×` hides the band.

On opening a project it switches to the account you last picked there, or else to one that can push to its first GitHub repo. A repo the active account can't read is left out.

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
