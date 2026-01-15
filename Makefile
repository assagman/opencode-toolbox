.PHONY: build clean rebuild test typecheck
.PHONY: bench bench-search bench-init bench-concurrent
.PHONY: release-tag release-push
.PHONY: wf-release wf-publish wf-ci wf-list wf-watch

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

# Benchmarks
bench: bench-search bench-init bench-concurrent

bench-search:
	bun run bench/search.bench.ts

bench-init:
	bun run bench/init.bench.ts

bench-concurrent:
	bun run bench/concurrent.bench.ts

# Release helpers (see RELEASE.md for full process)
release-tag:
	@test -n "$(VERSION)" || (echo "VERSION required: make release-tag VERSION=X.Y.Z" && exit 1)
	git tag -s -m "Release v$(VERSION)" v$(VERSION)

release-push:
	git push --follow-tags

# Workflows (requires gh cli + fzf)
# Trigger release PR workflow with interactive prompts
wf-release:
	@TYPE=$$(echo -e "auto\npatch\nminor\nmajor" | fzf --prompt="Version type: " --height=6 --reverse); \
	if [ "$$TYPE" = "auto" ]; then \
		read -p "Custom version (leave empty for auto): " VERSION; \
	fi; \
	echo "→ Triggering release: type=$$TYPE version=$${VERSION:-auto}"; \
	gh workflow run release-pr.yml \
		-f version_type=$$TYPE \
		$${VERSION:+-f custom_version=$$VERSION}; \
	sleep 2; \
	$(MAKE) wf-watch W=release-pr.yml

# Re-run failed publish workflow: make wf-publish [RUN=<run-id>]
wf-publish:
	$(if $(RUN),\
		gh run rerun $(RUN),\
		gh run rerun --failed -w release-publish.yml)
	@sleep 2
	@$(MAKE) wf-watch W=release-publish.yml

# Trigger CI workflow on current branch
wf-ci:
	gh workflow run ci.yml --ref $(shell git branch --show-current)
	@sleep 2
	@$(MAKE) wf-watch W=ci.yml

# List recent workflow runs: make wf-list [W=<workflow>] [N=10]
wf-list:
	gh run list $(if $(W),-w $(W)) -L $(or $(N),10)

# Watch latest workflow run: make wf-watch [W=<workflow>] [RUN=<run-id>]
wf-watch:
	$(if $(RUN),\
		gh run watch $(RUN),\
		gh run watch $(shell gh run list $(if $(W),-w $(W)) -L 1 --json databaseId -q '.[0].databaseId'))
