import { compare, hash } from "bcryptjs";

// Same cost factor as the seed data. Each +1 doubles the time it takes to hash.
const BCRYPT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
  return compare(plain, passwordHash);
}
