// pnpm --filter @papier/server user <command> --db <file> …
//
//   list                                        every account and its workspaces
//   add --email <e> --name <n> [--role owner|editor|viewer] [--workspace <id>] [--admin]
//   reset-password --email <e>                  sets a new password, signs out every session
//
// The recovery path when nobody can sign in. Passwords are read from PAPIER_PASSWORD
// or prompted for (hidden), never taken as an argument (shell history).

import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { eq } from 'drizzle-orm';
import { MIN_PASSWORD } from '@papier/core';
import { hashPassword } from '../auth/password.ts';
import { addMember, createUser, findUserByEmail, revokeUserSessions, userWorkspaces, type Role } from '../auth/sessions.ts';
import { openDb } from '../db/index.ts';
import { DEFAULT_WORKSPACE_ID, users, workspaces } from '../db/schema.ts';

const USAGE = 'usage: user (list | add --email <e> --name <n> [--role r] [--workspace id] [--admin] | reset-password --email <e>) --db <file>';

const cwd = process.env.INIT_CWD ?? process.cwd();
const [command, ...rest] = process.argv.slice(2);
const flags = new Map<string, string>();
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]!;
  if (!a.startsWith('--')) fail(`unexpected ${a}`);
  flags.set(a.slice(2), a === '--admin' ? 'yes' : (rest[++i] ?? ''));
}
const dbFlag = flags.get('db') ?? process.env.DATABASE_PATH;
if (!dbFlag) fail('pass --db <file> (or set DATABASE_PATH)');
const { db, sqlite } = openDb(resolve(cwd, dbFlag));

try {
  if (command === 'list') {
    for (const u of db.select().from(users).all()) {
      const ws = userWorkspaces(db, u.id).map((w) => `${w.name} (${w.role})`);
      console.log(`${u.email}  ${u.name}${u.isAdmin ? '  [admin]' : ''}  —  ${ws.join(', ') || 'no workspaces'}`);
    }
  } else if (command === 'add') {
    const email = need('email');
    if (findUserByEmail(db, email)) fail(`${email} already has an account`);
    const role = (flags.get('role') ?? 'editor') as Role;
    if (!['owner', 'editor', 'viewer'].includes(role)) fail(`unknown role ${role}`);
    const workspaceId = flags.get('workspace') ?? DEFAULT_WORKSPACE_ID;
    if (!db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get()) fail(`no workspace ${workspaceId}`);
    const passwordHash = await hashPassword(await newPassword());
    const user = db.transaction((tx) => {
      const u = createUser(tx, { email, name: need('name'), passwordHash, isAdmin: flags.has('admin') });
      addMember(tx, workspaceId, u.id, role);
      return u;
    });
    console.log(`Added ${user.email} as ${role} of ${workspaceId}.`);
  } else if (command === 'reset-password') {
    const user = findUserByEmail(db, need('email')) ?? fail('no such account');
    const passwordHash = await hashPassword(await newPassword());
    db.update(users).set({ passwordHash }).where(eq(users.id, user.id)).run();
    revokeUserSessions(db, user.id);
    console.log(`New password set for ${user.email}; every session was signed out.`);
  } else {
    fail(command ? `unknown command ${command}` : 'missing command');
  }
} finally {
  sqlite.close();
}

function need(flag: string) {
  const v = flags.get(flag)?.trim();
  return v || fail(`missing --${flag}`);
}

async function newPassword() {
  const pw = process.env.PAPIER_PASSWORD ?? (await ask('New password: '));
  if (pw.length < MIN_PASSWORD) fail(`the password needs at least ${MIN_PASSWORD} characters`);
  return pw;
}

/** Reads a line without echoing it. */
function ask(prompt: string) {
  return new Promise<string>((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => write.call(rl, s.startsWith(prompt) ? s : '');
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      done(answer);
    });
  });
}

function fail(msg: string): never {
  console.error(`${msg}\n${USAGE}`);
  process.exit(1);
}
