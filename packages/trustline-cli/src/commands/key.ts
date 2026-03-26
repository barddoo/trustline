import { readFile } from "node:fs/promises";

import { defineCommand } from "citty";

import { commonArgs } from "../common";
import {
  parseOptionalDate,
  parseOptionalInteger,
  resolveCliConfig,
} from "../config";
import { writeResult } from "../output";
import { createCliProvider } from "../provider";

const rotateCommand = defineCommand({
  meta: {
    name: "rotate",
    description: "Rotate the provider signing key",
  },
  args: {
    ...commonArgs,
    algorithm: {
      type: "enum" as const,
      description: "Signing algorithm for the new key",
      options: ["ES256", "RS256"],
    },
    keyId: {
      type: "string" as const,
      description: "Optional explicit key id",
      valueHint: "id",
    },
    activateAt: {
      type: "string" as const,
      description: "Activation timestamp for the new key",
      valueHint: "iso-time",
    },
    overlapSeconds: {
      type: "string" as const,
      description: "Overlap window before the old key expires",
      valueHint: "seconds",
    },
    privateKeyFile: {
      type: "string" as const,
      description: "Path to a PEM private key file",
      valueHint: "path",
    },
  },
  async run(context) {
    const config = await resolveCliConfig();
    const provider = createCliProvider(config);
    const privateKey = context.args.privateKeyFile
      ? await readFile(context.args.privateKeyFile, "utf8")
      : undefined;
    const rotated = await provider.keys.rotate({
      activateAt: parseOptionalDate(context.args.activateAt, "activateAt"),
      algorithm: context.args.algorithm,
      keyId: context.args.keyId,
      overlapSeconds: parseOptionalInteger(
        context.args.overlapSeconds,
        "overlapSeconds",
      ),
      privateKey,
    });

    writeResult(config, rotated, `Rotated signing key to ${rotated.keyId}.`);
  },
});

export const keyCommand = defineCommand({
  meta: {
    name: "key",
    description: "Manage provider signing keys",
  },
  subCommands: {
    rotate: rotateCommand,
  },
});
