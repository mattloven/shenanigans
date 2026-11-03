# shenanigans

## Chrome extensions

- [Bitbucket Rich Diff](chrome-extensions/bitbucket-rich-diff) — Diff, rich diff, and preview tabs for Markdown and JSON files on Bitbucket Cloud pull requests, plus file-list filters that hide Markdown, chosen extensions, and JavaScript, TypeScript, and C# comments.

Clone so the repo lands in its own folder. In PowerShell and Command Prompt this path is correct, and `D:\Code\mattloven` has to exist already:

```powershell
git clone -b cursor/bitbucket-rich-diff-3ec3 https://github.com/mattloven/shenanigans.git D:\Code\mattloven\shenanigans
cd D:\Code\mattloven\shenanigans\chrome-extensions\bitbucket-rich-diff
npm install
npm run build
```

In Git Bash, backslashes are escape characters, so use `D:/Code/mattloven/shenanigans` instead. Build from `chrome-extensions/bitbucket-rich-diff`. The repository root has no `package.json`.
