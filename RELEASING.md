# Releasing

Trustline uses [Changesets](https://github.com/changesets/changesets) to manage versioning and npm publication.

## Standard flow

1. Add a changeset in every user-facing PR:

   ```bash
   bun run changeset
   ```

2. Choose the package bump:

- `patch` for fixes and small behavior corrections
- `minor` for backward-compatible features
- `major` for breaking changes

3. Merge the PR to `main`.
4. The release workflow opens or updates a `Version Packages` PR.
5. Merge that PR to publish the package to npm and create the git tag and GitHub release.

## CI gates

The release job only publishes after these commands pass:

```bash
bun run build
bun run test
bun run typecheck
```

## Manual fallback

If GitHub Actions is unavailable, you can still cut a release locally:

```bash
bun run release:version
bun run release
```

## Setup checklist

- Enable npm trusted publishing for this repository in npm.
- Ensure the npm package name is available to your account or organization.
- Protect `main` so CI passes before merge.
