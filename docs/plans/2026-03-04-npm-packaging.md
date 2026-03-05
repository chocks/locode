# npm Packaging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Package and publish locode as `@chocks/locode` to npm as a public MIT-licensed global CLI tool.

**Architecture:** Update `package.json` metadata, add `.npmignore` to exclude source/dev files, add a `LICENSE` file, ensure the bin entry is executable, update README, then publish.

**Tech Stack:** npm, Node.js 18+, TypeScript (compiled to `dist/`)

---

### Task 1: Update package.json

**Files:**
- Modify: `package.json`

**Step 1: Apply all metadata changes**

Edit `package.json` to match exactly:

```json
{
  "name": "@chocks/locode",
  "version": "0.1.0",
  "description": "Local-first AI coding CLI. Routes tasks between Ollama and Claude to save tokens.",
  "license": "MIT",
  "engines": { "node": ">=18" },
  "files": ["dist"],
  "directories": {
    "doc": "docs"
  },
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm test && npm run build"
  },
  "bin": {
    "locode": "./dist/src/index.js"
  },
  "keywords": ["ai", "cli", "ollama", "claude", "llm", "coding-assistant"],
  "author": "Chocks Eswaramurthy",
  "url": "https://github.com/chocks/locode",
  "type": "commonjs",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.78.0",
    "commander": "^14.0.3",
    "handlebars": "^4.7.8",
    "js-yaml": "^4.1.1",
    "ollama": "^0.6.3",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/handlebars": "^4.0.40",
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^25.3.3",
    "ts-node": "^10.9.2",
    "typescript": "^5.9.3",
    "vitest": "^4.0.18"
  }
}
```

Key changes from current state:
- `name`: `locode` → `@chocks/locode`
- `version`: `0.0.1` → `0.1.0`
- `description`: empty → filled
- `license`: `ISC` → `MIT`
- Added `engines`, `files`, `keywords`, `prepublishOnly`
- Removed `"main": "index.js"` (not a library)

**Step 2: Verify JSON is valid**

```bash
node -e "require('./package.json')" && echo "valid"
```
Expected: `valid`

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: update package.json for npm publish as @chocks/locode"
```

---

### Task 2: Add .npmignore

**Files:**
- Create: `.npmignore`

**Step 1: Create the file**

```
src/
benchmark/
docs/
*.ts
tsconfig.json
locode.yaml
vitest.config.ts
.locode/
*.test.js
*.test.js.map
```

**Step 2: Verify dry-run includes only dist/**

```bash
npm pack --dry-run
```
Expected: only `dist/` files, `package.json`, `README.md`, `LICENSE` listed.

**Step 3: Commit**

```bash
git add .npmignore
git commit -m "chore: add .npmignore to exclude source files from npm package"
```

---

### Task 3: Add LICENSE file

**Files:**
- Create: `LICENSE`

**Step 1: Create MIT license**

```
MIT License

Copyright (c) 2026 Chocks Eswaramurthy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**Step 2: Commit**

```bash
git add LICENSE
git commit -m "chore: add MIT license"
```

---

### Task 4: Make bin executable and verify shebang

**Files:**
- Modify: `dist/src/index.js` (permissions only)

**Step 1: Check shebang is present**

```bash
head -1 dist/src/index.js
```
Expected: `#!/usr/bin/env node`

**Step 2: Make executable**

```bash
chmod +x dist/src/index.js
```

**Step 3: Verify it runs**

```bash
./dist/src/index.js --help
```
Expected: prints locode help output with available commands.

**Step 4: Make chmod permanent via build**

The `tsc` build doesn't preserve permissions. Add a `postbuild` script to `package.json` so it's applied automatically after every build:

In `package.json` scripts, add:
```json
"postbuild": "chmod +x dist/src/index.js"
```

**Step 5: Test the full build**

```bash
npm run build
ls -la dist/src/index.js
```
Expected: file has `-rwxr-xr-x` permissions.

**Step 6: Commit**

```bash
git add package.json
git commit -m "chore: add postbuild chmod to ensure bin is executable after tsc"
```

---

### Task 5: Update README

**Files:**
- Modify: `README.md`

**Step 1: Update install command**

Find the Install section and change:
```bash
npm install -g locode
```
to:
```bash
npm install -g @chocks/locode
```

**Step 2: Add GitHub Actions TODO**

At the bottom of the README, add a Contributing / Roadmap section (or append to existing):
```markdown
## Roadmap

- [ ] GitHub Actions workflow to auto-publish on git tag push
```

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update install command to @chocks/locode, add roadmap TODO"
```

---

### Task 6: Final verification and publish

**Step 1: Run full test + build**

```bash
npm test && npm run build
```
Expected: all tests pass, build succeeds.

**Step 2: Dry-run pack to verify contents**

```bash
npm pack --dry-run
```
Expected: only `dist/`, `package.json`, `README.md`, `LICENSE` — no `src/`, no `.ts` files.

**Step 3: Login to npm**

```bash
npm login
```
Use your npm account credentials.

**Step 4: Publish**

```bash
npm publish --access public
```
Expected: `+ @chocks/locode@0.1.0`

**Step 5: Verify it's live**

```bash
npm view @chocks/locode
```
Expected: shows package metadata including version 0.1.0.

**Step 6: Tag the release**

```bash
git tag v0.1.0
git push && git push --tags
```
