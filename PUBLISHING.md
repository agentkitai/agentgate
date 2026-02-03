# Publishing Packages

This monorepo uses [Changesets](https://github.com/changesets/changesets) for version management and automated publishing.

## Published Packages

The following packages are published to npm:

- `@agentgate/core` - Core types and utilities
- `@agentgate/sdk` - SDK for integrating AgentGate
- `@agentgate/cli` - CLI for approval management

## Adding a Changeset

When you make changes that should trigger a release, add a changeset:

```bash
pnpm changeset
```

This will prompt you to:
1. Select which packages have changed
2. Choose the semver bump type (patch/minor/major)
3. Write a summary of the changes

The changeset file is committed with your changes.

## Version Types

- **patch**: Bug fixes, small changes (0.0.X)
- **minor**: New features, non-breaking (0.X.0)
- **major**: Breaking changes (X.0.0)

## Release Process

### Automated (Recommended)

1. Create a PR with your changes + changeset files
2. Merge to `main`
3. The GitHub Action creates a "Release" PR that:
   - Bumps versions based on changesets
   - Updates CHANGELOGs
4. Merge the Release PR to publish to npm

### Manual

If you need to publish manually:

```bash
# Bump versions
pnpm changeset version

# Build all packages
pnpm build

# Publish to npm (requires NPM_TOKEN)
pnpm changeset publish
```

## Setup Requirements

### NPM Token

Add `NPM_TOKEN` to your repository secrets:

1. Generate token: `npm token create --cidr-whitelist=0.0.0.0/0`
2. Go to GitHub → Settings → Secrets → Actions
3. Add `NPM_TOKEN` with the generated token

### Package Access

Packages are configured with `"access": "public"` for npm publishing under the `@agentgate` scope.

## Local Development

To test the build before publishing:

```bash
# Build all packages
pnpm build

# Check what would be published
cd packages/core && npm pack --dry-run
cd packages/sdk && npm pack --dry-run
cd packages/cli && npm pack --dry-run
```

## Troubleshooting

### "Package not found" on publish

Ensure the package scope `@agentgate` is either:
- Free to use (first publish claims it)
- Or you have an npm organization configured

### Build errors during publish

The `prepublishOnly` script runs `pnpm run build` automatically. Ensure TypeScript compiles successfully.
