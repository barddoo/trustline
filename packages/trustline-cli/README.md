# trustline-cli

Administrative CLI for provisioning and managing Trustline service credentials.

`trustline-cli` is a Bun-based CLI that is intended to be distributed as a standalone executable built with Bun's executable bundler.

## Build

Build a host-platform executable from this workspace package:

```bash
bun run build
```

This produces:

```txt
dist/cli/trustline-cli
```

Build release binaries with Bun executables:

```bash
bun run build:release
```

The package build script uses Bun's standalone executable flow with bytecode enabled, following the Bun executables documentation:

https://bun.com/docs/bundler/executables

## Local development

Run the CLI directly through Bun:

```bash
bun run cli --help
```

Or run the compiled binary:

```bash
./dist/cli/trustline-cli --help
```

## Configuration

The CLI reads configuration in this order:

1. flags
2. environment variables
3. `trustline.config.json`

Supported inputs:

- `--issuer` or `TRUSTLINE_CLI_ISSUER`
- `--sqlite-path` or `TRUSTLINE_CLI_SQLITE_PATH`
- `--table-prefix` or `TRUSTLINE_CLI_TABLE_PREFIX`
- `--config` or `TRUSTLINE_CLI_CONFIG`

Example config file:

```json
{
  "issuer": "https://auth.internal",
  "sqlitePath": "./trustline.sqlite",
  "tablePrefix": "trustline_"
}
```

## Example

Create credentials for `orders-api`:

```bash
./dist/cli/trustline-cli client create \
  --issuer https://auth.internal \
  --sqlite-path ./trustline.sqlite \
  --name orders-api \
  --scope read:inventory
```

Default output is shell-friendly:

```bash
export TRUSTLINE_CLIENT_ID='svc_...'
export TRUSTLINE_CLIENT_SECRET='...'
```

Inject those values into the caller service's environment or secret manager. The receiving service does not need client credentials unless it also calls another downstream service.

## Commands

- `client create`
- `client list`
- `client get`
- `client rename`
- `client set-scopes`
- `client rotate-secret`
- `client revoke`
- `client disable`
- `client enable`
- `client invalidate-tokens-before`
- `client clear-tokens-invalid-before`
- `key rotate`
- `token revoke`

Use `--json` on commands that need machine-readable output.
