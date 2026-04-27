---
name: git
description: Run an end-to-end GitHub + Vercel release flow: prechecks, build, commit/push, env sync from .env.local, production deploy, and status output. Use when the user asks to deploy, release, push and deploy, update Vercel env, or run Git + Vercel together.
---

# /git

## Behavior

When user runs `/git`, execute this exact flow in order:

1. Validate repo state
2. Run build
3. Commit and push to GitHub
4. Sync env vars from `.env.local` to Vercel
5. Deploy to Vercel production
6. Return short status report + rollback command

## Required Guardrails

- Never print secret values in chat.
- Never include `.env.local` in commits.
- Stop immediately on first failing step.
- Ask for a commit message only if user did not provide one.

## Step 1: Validate Repo State

Run:

```bash
git status
git branch --show-current
git remote -v
```

Fail if:

- no git remote
- detached HEAD

If working tree has only generated build artifacts (like `.next`), ignore those for commit planning.

## Step 2: Build Check

Run:

```bash
npm run build
```

If build fails: return error summary and stop.

## Step 3: Commit + Push

Run:

```bash
git add -A
git commit -m "<message>"
git push
```

Rules:

- If nothing to commit, continue without failing.
- Do not amend unless user explicitly asks.
- Do not force push unless user explicitly asks.

## Step 4: Sync `.env.local` to Vercel

Use `.env.local` as source of truth.

Expected vars in this project:

- `MONDAY_API_TOKEN` (secret)
- `JWT_SECRET` (secret)
- `NEXT_PUBLIC_URL` (public)

Mapping:

- `NEXT_PUBLIC_*` -> client/public allowed
- everything else -> server secret

Run:

```bash
vercel link
```

Then sync each non-empty key from `.env.local` to all environments:

- `production`
- `preview`
- `development`

Finally run:

```bash
vercel env ls
```

## Step 5: Deploy Production

Run:

```bash
vercel --prod
```

Capture the production URL from output.

## Step 6: Output Format

Always return:

```markdown
## /git status
- Branch: <branch>
- Commit: <sha or "no new commit">
- Push: <ok/fail/skipped>
- Env sync: <ok/fail>
- Deploy: <ok/fail>
- URL: <vercel url or n/a>
- Rollback: `vercel rollback <deployment-url>` or `git revert <sha> && git push`
```

## Failure Recovery

If a step fails:

1. Show the exact failing command
2. Show concise error reason
3. Suggest the smallest safe fix
4. Stop (do not continue later steps)

