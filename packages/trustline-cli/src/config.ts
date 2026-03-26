import { readFile } from "node:fs/promises";
import process from "node:process";

interface CliConfigFile {
  issuer?: string;
  sqlitePath?: string;
  tablePrefix?: string;
}

export interface ResolvedCliConfig {
  issuer: string;
  sqlitePath: string;
  tablePrefix?: string;
  json: boolean;
}

export async function resolveCliConfig(): Promise<ResolvedCliConfig> {
  const argv = process.argv.slice(2);
  const explicitConfigPath =
    getLastFlagValue(argv, "config") ??
    process.env.TRUSTLINE_CLI_CONFIG ??
    undefined;
  const configPath = explicitConfigPath ?? "trustline.config.json";
  const configFromFile = await loadConfigFile(
    configPath,
    explicitConfigPath !== undefined,
  );

  const issuer =
    getLastFlagValue(argv, "issuer") ??
    process.env.TRUSTLINE_CLI_ISSUER ??
    configFromFile.issuer;
  const sqlitePath =
    getLastFlagValue(argv, "sqlite-path", "sqlitePath") ??
    process.env.TRUSTLINE_CLI_SQLITE_PATH ??
    configFromFile.sqlitePath;
  const tablePrefix =
    getLastFlagValue(argv, "table-prefix", "tablePrefix") ??
    process.env.TRUSTLINE_CLI_TABLE_PREFIX ??
    configFromFile.tablePrefix;
  const json = hasBooleanFlag(argv, "json");

  if (!issuer) {
    throw new Error(
      "Missing issuer. Provide --issuer, TRUSTLINE_CLI_ISSUER, or trustline.config.json.",
    );
  }

  if (!sqlitePath) {
    throw new Error(
      "Missing sqlite path. Provide --sqlite-path, TRUSTLINE_CLI_SQLITE_PATH, or trustline.config.json.",
    );
  }

  return {
    issuer,
    sqlitePath,
    tablePrefix,
    json,
  };
}

export function getRepeatedFlagValues(
  rawArgs: string[],
  name: string,
): string[] {
  const values: string[] = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    if (!token) {
      continue;
    }

    const prefixedName = `--${name}`;
    if (token === prefixedName) {
      const next = rawArgs[index + 1];
      if (next && !next.startsWith("-")) {
        values.push(next);
        index += 1;
      }
      continue;
    }

    if (token.startsWith(`${prefixedName}=`)) {
      values.push(token.slice(prefixedName.length + 1));
    }
  }

  return values;
}

export function parseOptionalInteger(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer for ${name}: ${value}`);
  }

  return parsed;
}

export function parseOptionalDate(
  value: string | undefined,
  name: string,
): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  return parseRequiredDate(value, name);
}

export function parseRequiredDate(value: string, name: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO timestamp for ${name}: ${value}`);
  }

  return parsed;
}

async function loadConfigFile(
  configPath: string,
  required: boolean,
): Promise<CliConfigFile> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as CliConfigFile;

    if (parsed && typeof parsed === "object") {
      return parsed;
    }

    throw new Error("Config file must contain a JSON object.");
  } catch (error) {
    if (isFileNotFoundError(error) && !required) {
      return {};
    }

    if (isFileNotFoundError(error)) {
      throw new Error(`Config file not found: ${configPath}`);
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${configPath}`);
    }

    throw error;
  }
}

function getLastFlagValue(
  rawArgs: string[],
  ...names: string[]
): string | undefined {
  let value: string | undefined;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    if (!token) {
      continue;
    }

    for (const name of names) {
      const prefixedName = `--${name}`;
      if (token === prefixedName) {
        const next = rawArgs[index + 1];
        if (next && !next.startsWith("-")) {
          value = next;
          index += 1;
        }
      } else if (token.startsWith(`${prefixedName}=`)) {
        value = token.slice(prefixedName.length + 1);
      }
    }
  }

  return value;
}

function hasBooleanFlag(rawArgs: string[], name: string): boolean {
  const prefixedName = `--${name}`;
  const negatedName = `--no-${name}`;
  let present = false;

  for (const token of rawArgs) {
    if (token === prefixedName) {
      present = true;
    } else if (token === negatedName) {
      present = false;
    }
  }

  return present;
}

function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
