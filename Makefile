.PHONY: setup setup-ci build lint test test-coverage e2e dev

# Full local environment.
setup:
	pnpm install

# CI's only install entrypoint: lockfile-frozen.
setup-ci:
	pnpm install --frozen-lockfile

build:
	pnpm -r run build

lint:
	pnpm -r --if-present run lint && pnpm -r --if-present run typecheck

test:
	pnpm -r --if-present run test

test-coverage:
	pnpm -r --if-present run test:coverage

e2e:
	pnpm --filter @embers/web run e2e

dev:
	pnpm --filter @embers/web run dev
