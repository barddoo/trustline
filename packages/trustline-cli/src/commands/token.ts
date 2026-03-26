import { defineCommand } from "citty";

import { commonArgs } from "../common";
import { parseRequiredDate, resolveCliConfig } from "../config";
import { writeResult } from "../output";
import { createCliProvider } from "../provider";

const revokeCommand = defineCommand({
  meta: {
    name: "revoke",
    description: "Revoke a token by jti until its expiry time",
  },
  args: {
    ...commonArgs,
    jti: {
      type: "string" as const,
      description: "JWT ID to revoke",
      required: true,
      valueHint: "jti",
    },
    expiresAt: {
      type: "string" as const,
      description: "Token expiration timestamp",
      required: true,
      valueHint: "iso-time",
    },
  },
  async run(context) {
    const config = await resolveCliConfig();
    const provider = createCliProvider(config);
    const expiresAt = parseRequiredDate(context.args.expiresAt, "expiresAt");

    await provider.tokens.revoke(context.args.jti, expiresAt);

    writeResult(
      config,
      {
        jti: context.args.jti,
        expiresAt: expiresAt.toISOString(),
        ok: true,
      },
      `Revoked token ${context.args.jti}.`,
    );
  },
});

export const tokenCommand = defineCommand({
  meta: {
    name: "token",
    description: "Manage token revocations",
  },
  subCommands: {
    revoke: revokeCommand,
  },
});
