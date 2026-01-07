# Release Process

This document describes the release process for opencode-toolbox.

## Prerequisites

- Git with GPG signing configured
- npm account with publish access
- GitHub CLI (`gh`) installed and authenticated

## Release Steps

### 1. Bump Version

Edit `package.json` and update the version number:

```json
"version": "X.Y.Z"
```

Follow [Semantic Versioning](https://semver.org/):
- **MAJOR** (X): Breaking changes
- **MINOR** (Y): New features, backward compatible
- **PATCH** (Z): Bug fixes, backward compatible

### 2. Commit Version Bump

```bash
git add package.json
git commit -m "Release vX.Y.Z"
```

### 3. Push to Remote

```bash
git push
```

### 4. Create Signed Tag

```bash
git tag -s -m "Release vX.Y.Z" vX.Y.Z
```

### 5. Push Tag

```bash
git push --follow-tags
```

### 6. Publish to npm

```bash
npm publish
```

> **Note**: This requires an OTP code from your authenticator app.

### 7. Create GitHub Release

```bash
gh release create vX.Y.Z --generate-notes --title "vX.Y.Z"
```

Options:
- `--generate-notes`: Auto-generate release notes from commits
- `--notes-from-tag`: Use the signed tag message as release notes
- `--notes "..."`: Provide custom release notes inline
- `-F CHANGELOG.md`: Read notes from a file

## Quick Release (Make Targets)

```bash
# After bumping version in package.json:
make release-commit VERSION=X.Y.Z  # Commit version bump
make release-tag VERSION=X.Y.Z     # Create signed tag
make release-push                   # Push commits and tags
make release-gh VERSION=X.Y.Z      # Create GitHub release

# npm publish (manual - requires OTP)
npm publish
```

## Full Example

```bash
# 1. Bump version in package.json to 0.3.0

# 2. Commit, tag, push
make release-commit VERSION=0.3.0
make release-tag VERSION=0.3.0
make release-push

# 3. Publish to npm (requires OTP)
npm publish

# 4. Create GitHub release
make release-gh VERSION=0.3.0
```

## Verification

After release, verify:

1. **npm**: https://www.npmjs.com/package/opencode-toolbox
2. **GitHub**: https://github.com/assagman/opencode-toolbox/releases
