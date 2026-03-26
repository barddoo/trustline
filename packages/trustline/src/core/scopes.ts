export function parseScopes(scope: string | undefined): string[] {
  if (!scope) {
    return [];
  }

  return [
    ...new Set(
      scope
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

export function hasRequiredScopes(
  tokenScope: string | undefined,
  requiredScopes: string[],
): boolean {
  const tokenScopes = new Set(parseScopes(tokenScope));

  return requiredScopes.every((scope) => tokenScopes.has(scope));
}
