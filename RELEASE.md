# Release Process

This document describes the release process for opencode-toolbox. Follow these steps in order.

## Prerequisites

- Git with GPG signing configured
- npm account with publish access
- GitHub CLI (`gh`) installed and authenticated

## Release Steps

### 1. Determine Version Number

Review changes since last release and determine version bump:

```bash
git log --oneline $(git describe --tags --abbrev=0)..HEAD
```

Follow [Semantic Versioning](https://semver.org/):
- **MAJOR** (X.0.0): Breaking changes
- **MINOR** (0.X.0): New features, backward compatible
- **PATCH** (0.0.X): Bug fixes, backward compatible

### 2. Update CHANGELOG.md

Add a new section at the top of CHANGELOG.md (after the header):

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New feature descriptions

### Changed
- Changes to existing functionality

### Fixed
- Bug fix descriptions

### Removed
- Removed features
```

Use the commit history to write meaningful descriptions. Group related changes.

### 3. Bump Version in package.json

Update the version field:

```json
"version": "X.Y.Z"
```

### 4. Commit Release

Stage and commit both files together:

```bash
git add CHANGELOG.md package.json
git commit -m "Release vX.Y.Z"
```

### 5. Push to Remote

```bash
git push
```

### 6. Create Signed Tag

```bash
git tag -s -m "Release vX.Y.Z" vX.Y.Z
```

### 7. Push Tag

```bash
git push --follow-tags
```

### 8. Publish to npm

```bash
npm publish
```

> **Note**: This requires an OTP code from your authenticator app. The human must run this command.

### 9. Create GitHub Release

Write release notes summarizing the changes (can be derived from CHANGELOG):

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes "RELEASE_NOTES_HERE"
```

For multi-line notes, use a heredoc:

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes "$(cat <<'EOF'
## What's New

Summary of changes...

### Features
- Feature 1
- Feature 2

### Bug Fixes
- Fix 1

**Full Changelog**: https://github.com/assagman/opencode-toolbox/compare/vPREVIOUS...vX.Y.Z
EOF
)"
```

## Verification

After release, verify:

1. **npm**: https://www.npmjs.com/package/opencode-toolbox
2. **GitHub Releases**: https://github.com/assagman/opencode-toolbox/releases
3. **Git tags**: `git tag -l`

## Quick Reference (Make Targets)

Helper targets for common operations:

```bash
make release-tag VERSION=X.Y.Z     # Create signed tag
make release-push                   # Push commits and tags
```

> **Note**: `npm publish` requires OTP and must be run manually by the human.
