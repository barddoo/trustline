import { randomBytes } from "node:crypto";

import { compare, hash } from "bcryptjs";

export async function hashSecret(secret: string): Promise<string> {
  return hash(secret, 10);
}

export async function verifySecret(
  secret: string,
  hashedSecret: string,
): Promise<boolean> {
  return compare(secret, hashedSecret);
}

export function generateSecret(length = 32): string {
  return randomBytes(length).toString("base64url");
}
