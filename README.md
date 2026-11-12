# accounts-band

A Claude Code mod that puts your GitHub account and the project's branch right above the prompt box.

Collapsed, it is one line: the active account, the repo and branch, and ahead/behind/uncommitted counts. `▸ more` opens:

- **Account**: the active `gh` account and a `⇄ <login>` button for each other one; `●` marks accounts that can reach the repo.
- **Repo**: a picker when the project holds several repos (nested up to 3 folders down).
- **Branch**: a branch picker (refuses to switch with uncommitted changes) and `⟳` fetch, `⇣` pull (fast-forward only), `⇡` push. Hover a symbol to see its name.

On opening a project it switches to the account you last picked there, or else to one that can push to the repo. If the active account can't read the repo, only the account shows. `×` hides the band.

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
