# Release Process

This document describes the automated release process for opencode-toolbox.

## Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          RELEASE AUTOMATION FLOW                             │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────────┐ │
│  │ 1. TRIGGER      │    │ 2. REVIEW        │    │ 3. AUTO-PUBLISH         │ │
│  │                 │    │                  │    │    (on PR merge)        │ │
│  │ Manual dispatch │───▶│ Release PR       │───▶│                         │ │
│  │ via GitHub UI   │    │ created          │    │ • Create git tag        │ │
│  │                 │    │                  │    │ • GitHub release        │ │
│  │ Inputs:         │    │ Branch:          │    │ • npm publish           │ │
│  │ - version type  │    │ release-vX.Y.Z   │    │                         │ │
│  │ - custom ver    │    │                  │    │                         │ │
│  └─────────────────┘    └──────────────────┘    └─────────────────────────┘ │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

### One-time Setup (Already Done ✅)

1. **npm OIDC Trusted Publisher**: Configured via npm → Package Settings → Trusted Publishers
   - Repository: `assagman/opencode-toolbox`
   - Workflow: `release-publish.yml`
   - Environment: `publish`
   - **No secrets required** - uses OpenID Connect for secure, token-less publishing

2. **GitHub Environment**: Create environment `publish` in repo settings
   - Go to Settings → Environments → New environment → `publish`

3. **GitHub Labels**: Ensure these labels exist:
   - `release` - Triggers the publish workflow on PR merge
   - `automated` - Optional, for tracking automated PRs

## Creating a Release

### Step 1: Trigger the Release Workflow

1. Go to **Actions** → **Create Release PR**
2. Click **Run workflow**
3. Select options:

| Option | Description |
|--------|-------------|
| `patch` | Bug fixes (0.0.X) |
| `minor` | New features, backward compatible (0.X.0) |
| `major` | Breaking changes (X.0.0) |
| `auto`  | Analyze commits to determine version bump |
| Custom version | Override with specific version (e.g., `2.0.0`) |

4. Click **Run workflow**

### Step 2: Review the Release PR

The workflow automatically:
- Creates branch `release-vX.Y.Z` from latest `main`
- Updates `package.json` version
- Updates `CHANGELOG.md` with categorized commits
- Creates a PR with the `release` label

Review the PR:
- [ ] Verify version bump is correct
- [ ] Review and edit CHANGELOG if needed
- [ ] Ensure all CI checks pass

### Step 3: Merge to Publish

When the PR is merged, the publish workflow automatically:
1. Creates a signed git tag `vX.Y.Z`
2. Creates a GitHub Release with auto-generated notes
3. Publishes to npm with provenance (via OIDC - no tokens needed)

## Version Determination (Auto Mode)

When using `auto` version type, the workflow analyzes commits since the last tag:

| Commit Pattern | Version Bump |
|----------------|--------------|
| `feat!:` or `BREAKING CHANGE` | **major** |
| `feat:` or `feature:` | **minor** |
| All other commits | **patch** |

Use [Conventional Commits](https://www.conventionalcommits.org/) for best results:
- `feat: add new feature` → minor
- `fix: resolve bug` → patch
- `feat!: breaking change` → major
- `chore: update deps` → patch

## Manual Release (Fallback)

If automation fails, follow this manual process:

### 1. Create Release Branch

```bash
git checkout main
git pull origin main
git checkout -b release-vX.Y.Z
```

### 2. Update Version

```bash
npm version X.Y.Z --no-git-tag-version
```

### 3. Update CHANGELOG.md

Add a new section:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New features

### Fixed
- Bug fixes
```

### 4. Commit and Push

```bash
git add package.json CHANGELOG.md
git commit -m "chore(release): prepare vX.Y.Z"
git push -u origin release-vX.Y.Z
```

### 5. Create PR

```bash
gh pr create --title "Release vX.Y.Z" --label "release" --base main
```

### 6. After PR Merge (if auto-publish fails)

```bash
git checkout main
git pull
git tag -s -m "Release vX.Y.Z" vX.Y.Z
git push --tags
gh release create vX.Y.Z --title "vX.Y.Z" --generate-notes
npm publish
```

## Verification

After release, verify:

| Check | URL |
|-------|-----|
| npm package | https://www.npmjs.com/package/opencode-toolbox |
| GitHub Release | https://github.com/assagman/opencode-toolbox/releases |
| Git tags | `git tag -l` |

## Troubleshooting

### NPM Publish Fails

- Verify `publish` environment exists in GitHub repo settings
- Check OIDC trusted publisher config matches workflow file name
- Ensure `id-token: write` permission is set in workflow
- Verify package name is available on npm

### PR Not Triggering Publish

- Verify PR has the `release` label
- Check PR was actually merged (not just closed)
- Review workflow run logs in Actions tab

### Version Conflicts

- If tag already exists, the workflow skips tag creation
- **Do not delete existing tags** - create a new patch version instead (e.g., `v1.0.1` if `v1.0.0` had issues)
- For problematic releases, deprecate the npm version: `npm deprecate opencode-toolbox@X.Y.Z "Reason for deprecation"`

## Workflow Files

| File | Purpose |
|------|---------|
| `.github/workflows/release-pr.yml` | Creates release PR with version bump |
| `.github/workflows/release-publish.yml` | Publishes on PR merge |
