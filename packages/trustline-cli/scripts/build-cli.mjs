import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

const entrypoint = "./src/main.ts";
const outputDirectory = "./dist/cli";

const releaseTargets = [
  {
    outfile: join(outputDirectory, "trustline-cli-darwin-arm64"),
    target: "bun-darwin-arm64",
  },
  {
    outfile: join(outputDirectory, "trustline-cli-darwin-x64"),
    target: "bun-darwin-x64",
  },
  {
    outfile: join(outputDirectory, "trustline-cli-linux-arm64"),
    target: "bun-linux-arm64",
  },
  {
    outfile: join(outputDirectory, "trustline-cli-linux-x64-baseline"),
    target: "bun-linux-x64-baseline",
  },
];

const mode = process.argv[2] ?? "host";
if (mode !== "host" && mode !== "release") {
  console.error("Usage: bun run scripts/build-cli.mjs [host|release]");
  process.exit(1);
}

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });

const targets =
  mode === "host"
    ? [
        {
          outfile: join(outputDirectory, "trustline-cli"),
          target: getHostTarget(),
        },
      ]
    : releaseTargets;

for (const build of targets) {
  await mkdir(dirname(build.outfile), { recursive: true });

  const result = await Bun.build({
    entrypoints: [entrypoint],
    compile: {
      target: build.target,
      outfile: build.outfile,
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadPackageJSON: false,
    },
    bytecode: true,
    minify: true,
    sourcemap: "linked",
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  console.log(`Built ${build.outfile}`);
}

function getHostTarget() {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "bun-darwin-arm64";
  }

  if (process.platform === "darwin" && process.arch === "x64") {
    return "bun-darwin-x64";
  }

  if (process.platform === "linux" && process.arch === "arm64") {
    return "bun-linux-arm64";
  }

  if (process.platform === "linux" && process.arch === "x64") {
    return "bun-linux-x64-baseline";
  }

  throw new Error(
    `Unsupported host target for CLI compilation: ${process.platform}/${process.arch}`,
  );
}
