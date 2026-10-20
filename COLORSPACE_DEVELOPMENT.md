# Colorspace development and release workflow

## Repositories and environments

- `ColorspaceMailCopilot`: Next.js backend and Copilot interface.
- `ProtonCopilot` (`tommie777/WebClients` on GitHub): customized Proton desktop app.
- Develop and test on the MacBook. `main` is the release branch in both repositories.
- The backend production host is `colorspaceserver2-lan` (fallback `colorspaceserver2`), verified as a Mac Studio M1 Max. Its deployment folder is `/Users/colorspaceserver2/colorspace-mail-copilot`.
- Production uses a committed source snapshot and Docker, not a Git checkout. A merge makes a release eligible for deployment; it does not deploy automatically.

## Start each change

Run in the repository being changed:

```bash
git switch main
git pull --ff-only origin main
git switch -c codex/describe-the-work
```

Keep changes focused. Never develop directly on `main` or edit production sources. If a change spans both repositories, use a branch and PR in each, and link the PRs with their compatibility and release order.

## Develop and validate

Use Node 24 (`nvm use 24`). In ColorspaceMailCopilot, run `npm run dev` for the backend on `http://127.0.0.1:3210`, then `npm run proton:dev` in another terminal for the desktop development app. The development app uses the local backend; configured FileMaker and AI services are real services. Use a non-sensitive test conversation and test customer.

Backend validation:

```bash
npm run verify
```

Desktop validation, from ProtonCopilot:

```bash
node .yarn/releases/yarn-4.17.1.cjs workspace proton-inbox-desktop test
node .yarn/releases/yarn-4.17.1.cjs workspace proton-inbox-desktop check
```

Visually verify affected flows: selecting a conversation, customer/order context, draft generation and insertion, and attachments when changed. Record any failed check explicitly; do not describe an unverified desktop build as release-ready.

## Push, review, then merge

```bash
git add <changed-files>
git commit -m "Describe the change"
git push -u origin HEAD
gh pr create --base main
```

Open the PR before merging. Include the problem, resulting behavior, validation evidence and any release dependencies. Merge only after review and successful relevant checks. Do not push feature commits directly to `main`. GitHub automatically deletes merged PR branches; default/protected branches are retained. Old inherited Proton release branches are not part of the Colorspace feature workflow and should not be bulk-merged.

After merging:

```bash
git switch main
git pull --ff-only origin main
git fetch --prune origin
```

Delete the old local branch with `git branch -d <branch>` after confirming its work is merged. With squash merges, Git may refuse this; verify the merged PR before deleting the local branch. Start the next task on a new descriptive branch.

## Deploy the backend

From a clean ColorspaceMailCopilot checkout on the MacBook:

```bash
git switch main
git pull --ff-only origin main
npm run deploy:production
```

The deployment command requires local `main` to exactly match freshly fetched GitHub `origin/main`. It runs tests, lint and build, archives the exact commit, backs up production sources, synchronizes the release while preserving production secrets/settings, and builds and starts the Docker image. Existing health checks and automatic image rollback remain in place. No production Git checkout or manual `git pull` is needed.

Deploy only when production release is authorized. Confirm `/api/health` reports the intended commit and perform an authenticated smoke test in the installed desktop app. A local test or successful merge is not production verification. Production keeps release metadata in `.deployment/current.env` and rollback metadata in `.deployment/previous.env`.

## Release the desktop app

A backend deployment does not update desktop installations. After merging desktop changes, update local ProtonCopilot `main`, validate, then use `npm run proton:install` from ColorspaceMailCopilot to build/install locally. Follow `CLIENT_INSTALLER.md` there to build and distribute signed installers. Record both backend and desktop commits for coordinated releases.

## Initial migration

The backend `main` baseline was created from the deployed commit `487a327`. The existing desktop integration is being reviewed through its own PR into `main`; its two previously unpushed commits are included. Do not assume the integration is on `main` until that PR is merged.
