.PHONY: build clean rebuild test typecheck
.PHONY: release-commit release-tag release-push release-gh

# Build
build:
	bun build src/index.ts --outdir dist --target bun

clean:
	rm -rf dist

rebuild: clean build

# Test
test:
	bun test

typecheck:
	tsc --noEmit

# Release (requires VERSION=X.Y.Z)
release-commit:
	@test -n "$(VERSION)" || (echo "VERSION required: make release-commit VERSION=X.Y.Z" && exit 1)
	git add package.json
	git commit -m "Release v$(VERSION)"

release-tag:
	@test -n "$(VERSION)" || (echo "VERSION required: make release-tag VERSION=X.Y.Z" && exit 1)
	git tag -s -m "Release v$(VERSION)" v$(VERSION)

release-push:
	git push --follow-tags

release-gh:
	@test -n "$(VERSION)" || (echo "VERSION required: make release-gh VERSION=X.Y.Z" && exit 1)
	gh release create v$(VERSION) --generate-notes --title "v$(VERSION)"
