export const commonArgs = {
  config: {
    type: "string" as const,
    description:
      "Path to a JSON config file. Also supported via TRUSTLINE_CLI_CONFIG.",
    valueHint: "path",
  },
  issuer: {
    type: "string" as const,
    description:
      "Issuer URL used to construct the provider. Also supported via TRUSTLINE_CLI_ISSUER.",
    valueHint: "url",
  },
  sqlitePath: {
    type: "string" as const,
    description:
      "Path to the SQLite database file. Also supported via TRUSTLINE_CLI_SQLITE_PATH.",
    valueHint: "path",
  },
  tablePrefix: {
    type: "string" as const,
    description:
      "Optional SQL table prefix. Also supported via TRUSTLINE_CLI_TABLE_PREFIX.",
    valueHint: "prefix",
  },
  json: {
    type: "boolean" as const,
    description: "Print machine-readable JSON output",
  },
};
