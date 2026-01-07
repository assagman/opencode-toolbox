.PHONY: build clean rebuild test typecheck

build:
	bun build src/index.ts --outdir dist --target bun

clean:
	rm -rf dist

rebuild: clean build

test:
	bun test

typecheck:
	tsc --noEmit
