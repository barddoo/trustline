import process from "node:process";

import { defineCommand } from "citty";

import { commonArgs } from "../common";
import {
  getRepeatedFlagValues,
  parseOptionalDate,
  parseOptionalInteger,
  resolveCliConfig,
} from "../config";
import {
  formatClientDetails,
  formatClientSummary,
  writeCreatedClientExports,
  writeJson,
  writeResult,
  writeRotatedSecretExport,
} from "../output";
import { createCliProvider } from "../provider";

const createCommand = defineCommand({
  meta: {
    name: "create",
    description: "Create client credentials for a service",
  },
  args: {
    ...commonArgs,
    name: {
      type: "string" as const,
      description: "Human-readable service name",
      required: true,
      valueHint: "name",
    },
    scope: {
      type: "string" as const,
      description: "Allowed scope; repeat the flag to add more",
      valueHint: "scope",
    },
  },
  async run(context) {
    const config = await resolveCliConfig();
    const provider = createCliProvider(config);
    const scopes = getRepeatedFlagValues(context.rawArgs, "scope");
    const created = await provider.clients.create({
      name: context.args.name,
      scopes,
    });

    if (config.json) {
      writeJson(created);
      return;
    }

    writeCreatedClientExports(created.clientId, created.clientSecret);
  },
});

const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List registered clients",
  },
  args: commonArgs,
  async run() {
    const config = await resolveCliConfig();
    const provider = createCliProvider(config);
    const clients = await provider.clients.list();

    if (config.json) {
      writeJson(clients);
      return;
    }

    if (clients.length === 0) {
      process.stdout.write("No clients found.\n");
      return;
    }

    for (const client of clients) {
      process.stdout.write(`${formatClientSummary(client)}\n`);
    }
  },
});

const getCommand = defineCommand({
  meta: {
    name: "get",
    description: "Get a single client by id",
  },
  args: {
    ...commonArgs,
    clientId: {
      type: "string" as const,
      description: "Client id to load",
      required: true,
      valueHint: "id",
    },
  },
  async run(context) {
    const config = await resolveCliConfig();
    const provider = createCliProvider(config);
    const client = await provider.clients.get(context.args.clientId);

    if (!client) {
      throw new Error(`Unknown client: ${context.args.clientId}`);
    }

    if (config.json) {
      writeJson(client);
      return;
    }

    process.stdout.write(`${formatClientDetails(client)}\n`);
  },
});

const renameCommand = defineCommand({
  meta: {
    name: "rename",
    description: "Rename an existing client",
  },
  args: {
    ...commonArgs,
    clientId: {
      type: "string" as const,
      description: "Client id to rename",
      required: true,
      valueHint: "id",
    },
    name: {
      type: "string" as const,
      description: "New service name",
      required: true,
      valueHint: "name",
    },
  },
  async run(context) {
    const config = await resolveCliConfig();
    const provider = createCliProvider(config);
    await provider.clients.rename(context.args.clientId, context.args.name);

    writeResult(
      config,
      {
        clientId: context.args.clientId,
        name: context.args.name,
        ok: true,
      },
      `Renamed ${context.args.clientId} to ${context.args.name}.`,
    );
  },
});

const setScopesCommand = defineCommand({
  meta: {
    name: "set-scopes",
    description: "Replace the allowed scopes for a client",
  },
  args: {
    ...commonArgs,
    clientId: {
      type: "string" as const,
      description: "Client id to update",
      required: true,
      valueHint: "id",
    },
    scope: {
      type: "string" as const,
      description: "Allowed scope; repeat the flag to add more",
      valueHint: "scope",
    },
  },
  async run(context) {
    const config = await resolveCliConfig();
    const provider = createCliProvider(config);
    const scopes = getRepeatedFlagValues(context.rawArgs, "scope");

    await provider.clients.updateScopes(context.args.clientId, scopes);

    writeResult(
      config,
      {
        clientId: context.args.clientId,
        scopes,
        ok: true,
      },
      `Updated scopes for ${context.args.clientId}.`,
    );
  },
});

const rotateSecretCommand = defineCommand({
  meta: {
    name: "rotate-secret",
    description: "Rotate a client secret",
  },
  args: {
    ...commonArgs,
    clientId: {
      type: "string" as const,
      description: "Client id to rotate",
      required: true,
      valueHint: "id",
    },
    overlapSeconds: {
      type: "string" as const,
      description: "Grace period before the previous secret expires",
      valueHint: "seconds",
    },
    expiresAt: {
      type: "string" as const,
      description: "Absolute expiry timestamp for the previous secret",
      valueHint: "iso-time",
    },
  },
  async run(context) {
    const config = await resolveCliConfig();
    const provider = createCliProvider(config);
    const overlapSeconds = parseOptionalInteger(
      context.args.overlapSeconds,
      "overlapSeconds",
    );

    if (overlapSeconds !== undefined && context.args.expiresAt !== undefined) {
      throw new Error(
        "Cannot use --overlap-seconds and --expires-at together.",
      );
    }

    const rotated = await provider.clients.rotateSecret(context.args.clientId, {
      expiresAt: parseOptionalDate(context.args.expiresAt, "expiresAt"),
      overlapSeconds,
    });

    if (config.json) {
      writeJson(rotated);
      return;
    }

    writeRotatedSecretExport(rotated.clientSecret);
  },
});

const revokeCommand = defineCommand({
  meta: {
    name: "revoke",
    description: "Delete a client credential record",
  },
  args: {
    ...commonArgs,
    clientId: {
      type: "string" as const,
      description: "Client id to revoke",
      required: true,
      valueHint: "id",
    },
  },
  async run(context) {
    const config = await resolveCliConfig();
    const provider = createCliProvider(config);
    await provider.clients.revoke(context.args.clientId);

    writeResult(
      config,
      {
        clientId: context.args.clientId,
        ok: true,
      },
      `Revoked ${context.args.clientId}.`,
    );
  },
});

const disableCommand = defineCommand({
  meta: {
    name: "disable",
    description: "Disable a client so it can no longer obtain tokens",
  },
  args: {
    ...commonArgs,
    clientId: {
      type: "string" as const,
      description: "Client id to disable",
      required: true,
      valueHint: "id",
    },
  },
  async run(context) {
    const config = await resolveCliConfig();
    const provider = createCliProvider(config);
    await provider.clients.disable(context.args.clientId);

    writeResult(
      config,
      {
        clientId: context.args.clientId,
        active: false,
        ok: true,
      },
      `Disabled ${context.args.clientId}.`,
    );
  },
});

const enableCommand = defineCommand({
  meta: {
    name: "enable",
    description: "Enable a previously disabled client",
  },
  args: {
    ...commonArgs,
    clientId: {
      type: "string" as const,
      description: "Client id to enable",
      required: true,
      valueHint: "id",
    },
  },
  async run(context) {
    const config = await resolveCliConfig();
    const provider = createCliProvider(config);
    await provider.clients.enable(context.args.clientId);

    writeResult(
      config,
      {
        clientId: context.args.clientId,
        active: true,
        ok: true,
      },
      `Enabled ${context.args.clientId}.`,
    );
  },
});

const invalidateTokensBeforeCommand = defineCommand({
  meta: {
    name: "invalidate-tokens-before",
    description: "Reject tokens issued before a cutoff time",
  },
  args: {
    ...commonArgs,
    clientId: {
      type: "string" as const,
      description: "Client id to update",
      required: true,
      valueHint: "id",
    },
    at: {
      type: "string" as const,
      description: "Cutoff timestamp; defaults to now",
      valueHint: "iso-time",
    },
  },
  async run(context) {
    const config = await resolveCliConfig();
    const provider = createCliProvider(config);
    const cutoff = parseOptionalDate(context.args.at, "at");

    await provider.clients.invalidateTokensBefore(
      context.args.clientId,
      cutoff,
    );

    writeResult(
      config,
      {
        clientId: context.args.clientId,
        at: cutoff?.toISOString() ?? "now",
        ok: true,
      },
      `Updated token cutoff for ${context.args.clientId}.`,
    );
  },
});

const clearTokensInvalidBeforeCommand = defineCommand({
  meta: {
    name: "clear-tokens-invalid-before",
    description: "Remove the client token cutoff",
  },
  args: {
    ...commonArgs,
    clientId: {
      type: "string" as const,
      description: "Client id to update",
      required: true,
      valueHint: "id",
    },
  },
  async run(context) {
    const config = await resolveCliConfig();
    const provider = createCliProvider(config);
    await provider.clients.clearTokensInvalidBefore(context.args.clientId);

    writeResult(
      config,
      {
        clientId: context.args.clientId,
        ok: true,
      },
      `Cleared token cutoff for ${context.args.clientId}.`,
    );
  },
});

export const clientCommand = defineCommand({
  meta: {
    name: "client",
    description: "Manage service client credentials",
  },
  subCommands: {
    create: createCommand,
    list: listCommand,
    get: getCommand,
    rename: renameCommand,
    "set-scopes": setScopesCommand,
    "rotate-secret": rotateSecretCommand,
    revoke: revokeCommand,
    disable: disableCommand,
    enable: enableCommand,
    "invalidate-tokens-before": invalidateTokensBeforeCommand,
    "clear-tokens-invalid-before": clearTokensInvalidBeforeCommand,
  },
});
