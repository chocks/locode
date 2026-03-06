# GitHub Actions CI/CD Design

## Goal

Automate test + lint on every PR, and publish to npm on every version tag push.

## ESLint Setup

Add `eslint` and `typescript-eslint` as devDependencies. Use a minimal flat config (`eslint.config.js`) with the `typescript-eslint` recommended ruleset applied to `src/**/*.ts`.

Add two scripts to `package.json`:
- `"lint": "eslint src"` — runs ESLint with typescript-eslint rules
- `"typecheck": "tsc --noEmit"` — type-checks without emitting files

## Workflow: ci.yml

Trigger: `pull_request` targeting `main`

Steps:
1. `actions/checkout@v4`
2. `actions/setup-node@v4` (Node 20, npm cache)
3. `npm ci`
4. `npm run lint`
5. `npm run typecheck`
6. `npm test`

## Workflow: publish.yml

Trigger: `push` with tag pattern `v*`

Steps:
1. `actions/checkout@v4`
2. `actions/setup-node@v4` (Node 20, registry `https://registry.npmjs.org`)
3. `npm ci`
4. `npm publish` — `prepublishOnly` already runs `build + test`

Requires: `NPM_TOKEN` secret set in GitHub repo settings, passed as `NODE_AUTH_TOKEN` env var.

## Trade-offs Considered

- **Two files vs one**: Two files chosen for clear separation — publish workflow is a distinct concern with different secrets and triggers.
- **ESLint vs tsc only**: Both run — ESLint catches style/correctness issues, `tsc --noEmit` catches type errors. They're complementary.
- **Tag filter**: Any `v*` tag triggers publish, trusting tagging discipline on `main`.

## Manual Setup Required

Before the publish workflow can run, add `NPM_TOKEN` to GitHub repo secrets:

1. Generate a token at npmjs.com under your account → Access Tokens (choose "Automation" type)
2. Go to GitHub repo → Settings → Secrets and variables → Actions → New repository secret
3. Name: `NPM_TOKEN`, Value: the token from step 1
