# accounts-band

A Claude Code mod that puts the GitHub side of the project you're in right above the prompt box.

**Accounts**
- The active `gh` account and a `⇄ <login>` button for each other one. A green dot marks accounts that can reach the repo.
- On opening a project it switches to the account you last picked there, or else to one that can push to the repo.
- If the active account can't read the repo, only the account row shows until you switch.

**Repository** (the repo the session runs in, plus separate repos nested up to 3 folders down)
- Repo picker, branch picker (refuses to switch with uncommitted changes), ahead/behind and uncommitted count.
- Every remote with its owner/repo and whether the active account can push (✓/✗).
- Worktree picker: choosing one drafts a prompt asking Claude to move the session there.
- Fetch, pull (fast-forward only), new branch and new worktree buttons.

**Pull requests**
- The PR for the current branch with its state, review status and CI, or the branch's latest CI run.
- Open PRs in the repo and how many wait for your review.
- `↗` opens the repo, branch or PR on github.com. `↻` refreshes everything; `×` hides the band.

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
