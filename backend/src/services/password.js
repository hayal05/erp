import bcrypt from 'bcryptjs';

const COST = 12;          // ~250-400 ms with bcryptjs; fine for 50 users, costly for attackers
export const MIN_LENGTH = 10;
const MAX_BYTES = 72;     // bcrypt silently ignores bytes beyond 72, so we reject instead of truncating

// Returns an error message, or null when the password is acceptable.
export function passwordProblem(plain) {
  if (typeof plain !== 'string') return 'Password is required';
  if (plain.length < MIN_LENGTH) return `Password must be at least ${MIN_LENGTH} characters`;
  if (Buffer.byteLength(plain, 'utf8') > MAX_BYTES) return `Password must be at most ${MAX_BYTES} bytes`;
  return null;
}

export function assertPasswordStrength(plain) {
  const problem = passwordProblem(plain);
  if (problem) throw new Error(problem);
}

export async function hashPassword(plain) {
  assertPasswordStrength(plain);
  return bcrypt.hash(plain, COST);
}

// A real hash of a throwaway value. Verifying against it when the account does not exist
// keeps login timing the same for unknown and known emails.
let dummyHash;
export async function verifyPassword(plain, hash) {
  if (typeof plain !== 'string' || Buffer.byteLength(plain, 'utf8') > MAX_BYTES) return false;
  if (!hash) {
    dummyHash ??= await bcrypt.hash('natra-dummy-password-for-timing', COST);
    await bcrypt.compare(plain, dummyHash);
    return false;
  }
  return bcrypt.compare(plain, hash);
}
