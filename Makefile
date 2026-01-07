.PHONY: build clean rebuild test typecheck
.PHONY: release-tag release-push

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

# Release helpers (see RELEASE.md for full process)
release-tag:
	@test -n "$(VERSION)" || (echo "VERSION required: make release-tag VERSION=X.Y.Z" && exit 1)
	git tag -s -m "Release v$(VERSION)" v$(VERSION)

release-push:
	git push --follow-tags
