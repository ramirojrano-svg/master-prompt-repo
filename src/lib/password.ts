// src/lib/password.ts — hashing de contraseñas con bcryptjs (§11.1).
import bcrypt from "bcryptjs";

const COSTO = 10;

export async function hashPassword(plano: string): Promise<string> {
  return bcrypt.hash(plano, COSTO);
}

export async function verificarPassword(plano: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plano, hash);
}
