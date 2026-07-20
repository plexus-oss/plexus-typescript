# Contributing to plexus-typescript

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/plexus-oss/plexus-typescript.git
cd plexus-typescript
npm ci
```

Node 18 or later is required.

## Running Tests

```bash
npm test              # vitest run
npm run typecheck     # tsc --noEmit
```

## Formatting

```bash
npm run format        # prettier --write .
npm run format:check  # what CI runs
```

## Submitting Changes

1. Fork the repo and create a branch from `main`
2. Make your changes — add tests for new functionality
3. Run `npm test`, `npm run typecheck`, and `npm run format:check` and make sure all pass
4. Open a pull request with a clear description of what and why

## Reporting Bugs

Open an issue at [GitHub Issues](https://github.com/plexus-oss/plexus-typescript/issues) with:

- Package version and Node version (or browser, for `plexus-typescript/browser`)
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs or stack traces

## Code Style

- Follow existing patterns in the codebase
- Run `prettier` before committing
- Keep the package dependency-free at runtime — dev dependencies only
- If you change the version, update both `package.json` and `src/version.ts` (CI enforces the sync)

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
