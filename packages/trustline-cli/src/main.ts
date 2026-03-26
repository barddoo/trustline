import { createMain, defineCommand } from "citty";

import packageJson from "../package.json";
import { clientCommand } from "./commands/client";
import { keyCommand } from "./commands/key";
import { tokenCommand } from "./commands/token";

const main = createMain(
  defineCommand({
    meta: {
      name: "trustline-cli",
      version: packageJson.version,
      description:
        "Admin CLI for provisioning and operating Trustline clients. Configuration can come from flags, environment variables, or trustline.config.json.",
    },
    subCommands: {
      client: clientCommand,
      key: keyCommand,
      token: tokenCommand,
    },
  }),
);

void main();
