const USERS_KEY = "mrp-auth-users-v1";
const SESSION_KEY = "mrp-auth-session-v1";
export const AUTH_STORAGE_KEYS = { users: USERS_KEY, session: SESSION_KEY };
export const BOOTSTRAP_ADMIN = { username: "admin", password: "ChangeMe123!" };

const encoder = new TextEncoder();
const bytesToBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const base64ToBytes = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" }, key, 256);
  return `pbkdf2-sha256$210000$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [algorithm, iterations, salt, expected] = stored.split("$");
    if (algorithm !== "pbkdf2-sha256") return false;
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: base64ToBytes(salt), iterations: Number(iterations), hash: "SHA-256" }, key, 256));
    const actual = bytesToBase64(bits);
    if (actual.length !== expected.length) return false;
    let difference = 0; for (let i = 0; i < actual.length; i += 1) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
    return difference === 0;
  } catch { return false; }
}

const readUsers = () => { try { return JSON.parse(localStorage.getItem(USERS_KEY) || "[]"); } catch { return []; } };
export const saveUsers = (users) => localStorage.setItem(USERS_KEY, JSON.stringify(users));
export const saveSession = (userId) => localStorage.setItem(SESSION_KEY, JSON.stringify({ userId }));
export const clearSession = () => localStorage.removeItem(SESSION_KEY);

export async function initializeAuth() {
  let users = readUsers();
  if (!users.length) {
    const now = new Date().toISOString();
    users = [{ id: `user_${crypto.randomUUID()}`, username: BOOTSTRAP_ADMIN.username, fullName: "Bootstrap Administrator", role: "ADMIN", department: "Administration", passwordHash: await hashPassword(BOOTSTRAP_ADMIN.password), isActive: true, mustChangePassword: true, createdAt: now, updatedAt: now, lastLoginAt: null }];
    saveUsers(users);
  }
  let session = null; try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { clearSession(); }
  const currentUser = users.find((user) => user.id === session?.userId && user.isActive) || null;
  if (!currentUser) clearSession();
  return { users, currentUser };
}

export async function authenticate(users, username, password) {
  const normalized = username.trim().toLocaleLowerCase();
  const user = users.find((candidate) => candidate.username.toLocaleLowerCase() === normalized);
  if (!user || !(await verifyPassword(password, user.passwordHash))) throw new Error("Invalid username or password.");
  if (!user.isActive) throw new Error("This account is inactive. Contact an administrator.");
  const updated = { ...user, lastLoginAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const nextUsers = users.map((candidate) => candidate.id === user.id ? updated : candidate);
  saveUsers(nextUsers); saveSession(updated.id);
  return { users: nextUsers, user: updated };
}
