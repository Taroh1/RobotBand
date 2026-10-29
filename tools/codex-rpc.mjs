import { spawn } from 'node:child_process';
import { access, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

const STDERR_LIMIT = 16 * 1024;
const STDOUT_LINE_LIMIT = 64 * 1024 * 1024;
const binaryNames = process.platform === 'win32' ? ['codex.exe'] : ['codex', 'codex.exe'];

async function executableFile(path) {
  try {
    if (!(await stat(path)).isFile()) return false;
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch { return false; }
}

async function firstBinary(directory, depth = 0) {
  for (const name of binaryNames) {
    const candidate = join(directory, name);
    if (await executableFile(candidate)) return candidate;
  }
  if (depth >= 3) return null;
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { return null; }
  // Extension bin directories are small; never recurse into the user's home.
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const architecture = { x64: 'x86_64', arm64: 'aarch64' }[process.arch] || process.arch;
  const preferred = `${platform}-${architecture}`;
  for (const entry of entries.filter(entry => entry.isDirectory()).sort((a, b) => {
    if (a.name === preferred) return -1;
    if (b.name === preferred) return 1;
    return a.name.localeCompare(b.name);
  })) {
    const found = await firstBinary(join(directory, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

/** Find a native executable without invoking a shell or reading auth files. */
export async function findCodexBinary({ home = homedir() } = {}) {
  if (process.env.CODEX_BINARY) {
    const configured = process.env.CODEX_BINARY;
    if (!isAbsolute(configured) || !(await executableFile(configured))) {
      throw new Error('CODEX_BINARY must contain an absolute executable file path, without shell arguments.');
    }
    return resolve(configured);
  }

  for (const entry of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    const directory = entry.replace(/^"(.*)"$/, '$1');
    for (const name of binaryNames) {
      const candidate = join(directory, name);
      if (await executableFile(candidate)) return resolve(candidate);
    }
  }

  const extensionsDirectory = join(home, '.vscode', 'extensions');
  let extensions = [];
  try { extensions = await readdir(extensionsDirectory, { withFileTypes: true }); }
  catch { /* A CLI-only machine need not have the VS Code extension. */ }
  extensions = extensions.filter(entry => entry.isDirectory() && entry.name.startsWith('openai.chatgpt-'))
    .sort((a, b) => b.name.localeCompare(a.name, 'en', { numeric: true }));
  for (const extension of extensions) {
    const found = await firstBinary(join(extensionsDirectory, extension.name, 'bin'));
    if (found) return resolve(found);
  }
  const local = await firstBinary(join(home, '.codex', 'bin'));
  if (local) return resolve(local);
  throw new Error('Codex executable not found. Set CODEX_BINARY to its absolute native executable path.');
}

function redactDiagnostic(value) {
  return value
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]{20,})\b/g, '[redacted]')
    .replace(/(["']?(?:access_token|refresh_token|id_token|api_key|authorization)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]');
}

/**
 * Start an isolated stdio JSON-RPC connection. This function initializes the
 * protocol only; it never starts a model turn or resumes an existing session.
 */
export async function startCodex({ binary, codexHome, cwd = process.cwd(), timeoutMs = 15_000 } = {}) {
  if (!codexHome || typeof codexHome !== 'string' || !isAbsolute(codexHome)) {
    throw new TypeError('An explicit absolute codexHome is required.');
  }
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new TypeError('cwd must be an absolute path.');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new TypeError('timeoutMs must be between 1 and 300000 milliseconds.');
  }
  binary ??= await findCodexBinary();
  if (typeof binary !== 'string' || !isAbsolute(binary) || !(await executableFile(binary))) {
    throw new TypeError('binary must be an absolute native executable file path.');
  }

  const child = spawn(binary, ['app-server', '--listen', 'stdio://'], {
    cwd,
    env: { ...process.env, CODEX_HOME: codexHome },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  });
  const pending = new Map();
  let nextId = 1, stderrTail = '', stdoutBuffer = '';
  let fatalError = null, exited = false, closing = false, closePromise;
  let resolveProcessClosed;
  const processClosed = new Promise(resolveClosed => { resolveProcessClosed = resolveClosed; });

  function diagnosticError(message, code = 'CODEX_RPC_ERROR') {
    const error = new Error(message);
    error.code = code;
    // The client never logs stdout, stderr, credentials or protocol payloads.
    // A bounded, redacted diagnostic is available only on returned errors.
    if (stderrTail) error.stderrTail = redactDiagnostic(stderrTail);
    return error;
  }

  function rejectPending(error) {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
  }

  function fail(error) {
    fatalError ??= error;
    rejectPending(fatalError);
  }

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk).slice(-STDERR_LIMIT); });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    stdoutBuffer += chunk;
    let boundary;
    while ((boundary = stdoutBuffer.indexOf('\n')) !== -1) {
      if (boundary > STDOUT_LINE_LIMIT) {
        fail(diagnosticError('Codex JSON-RPC response exceeded the supported line size.', 'CODEX_PROTOCOL_ERROR'));
        child.kill();
        return;
      }
      const line = stdoutBuffer.slice(0, boundary).replace(/\r$/, '');
      stdoutBuffer = stdoutBuffer.slice(boundary + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); }
      catch {
        fail(diagnosticError('Codex emitted an invalid JSON-RPC line.', 'CODEX_PROTOCOL_ERROR'));
        child.kill();
        return;
      }
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        fail(diagnosticError('Codex emitted an invalid JSON-RPC message.', 'CODEX_PROTOCOL_ERROR'));
        child.kill();
        return;
      }
      if (typeof message.method === 'string') {
        if (message.id !== undefined) {
          // Read-only transfer never approves tools or supplies auth secrets.
          child.stdin.write(`${JSON.stringify({ id: message.id, error: {
            code: -32601, message: 'This transfer client does not support server-initiated requests.',
          } })}\n`);
        }
        continue; // Notifications do not consume a pending request.
      }
      const entry = pending.get(message.id);
      if (!entry) continue; // Late responses after a timeout are harmless.
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) {
        const error = diagnosticError(
          typeof message.error.message === 'string' ? redactDiagnostic(message.error.message) : 'Codex JSON-RPC request failed.',
          message.error.code ?? 'CODEX_RPC_ERROR',
        );
        entry.reject(error);
      } else if (Object.hasOwn(message, 'result')) entry.resolve(message.result);
      else entry.reject(diagnosticError('Codex response has neither result nor error.', 'CODEX_PROTOCOL_ERROR'));
    }
    if (stdoutBuffer.length > STDOUT_LINE_LIMIT) {
      fail(diagnosticError('Codex JSON-RPC response exceeded the supported line size.', 'CODEX_PROTOCOL_ERROR'));
      child.kill();
    }
  });
  child.stdin.on('error', error => {
    if (!closing) fail(diagnosticError(`Codex stdin failed: ${error.code || 'write error'}`, 'CODEX_PROCESS_ERROR'));
  });
  child.on('error', error => {
    exited = true;
    fail(diagnosticError(`Could not start Codex app-server: ${error.code || 'spawn error'}`, 'CODEX_PROCESS_ERROR'));
    resolveProcessClosed();
  });
  child.once('close', (code, signal) => {
    exited = true;
    if (!closing) fail(diagnosticError(
      `Codex app-server exited before the client closed it (${signal || code}).`, 'CODEX_PROCESS_EXIT',
    ));
    else rejectPending(diagnosticError('Codex client is closed.', 'CODEX_CLIENT_CLOSED'));
    resolveProcessClosed();
  });

  function request(method, params = {}) {
    if (fatalError) return Promise.reject(fatalError);
    if (closing || exited) return Promise.reject(diagnosticError('Codex client is closed.', 'CODEX_CLIENT_CLOSED'));
    if (typeof method !== 'string' || !method) return Promise.reject(new TypeError('JSON-RPC method must be a non-empty string.'));
    const id = nextId++;
    let line;
    try { line = `${JSON.stringify({ id, method, params })}\n`; }
    catch { return Promise.reject(new TypeError('JSON-RPC parameters must be JSON serializable.')); }
    return new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => {
        if (!pending.delete(id)) return;
        reject(diagnosticError(`Codex request ${method} timed out after ${timeoutMs}ms.`, 'CODEX_REQUEST_TIMEOUT'));
      }, timeoutMs);
      pending.set(id, { resolve: resolveResult, reject, timer });
      child.stdin.write(line, error => {
        if (error) fail(diagnosticError(`Codex request could not be written: ${error.code || 'write error'}`, 'CODEX_PROCESS_ERROR'));
      });
    });
  }

  function close() {
    if (closePromise) return closePromise;
    closing = true;
    rejectPending(diagnosticError('Codex client is closing.', 'CODEX_CLIENT_CLOSED'));
    closePromise = (async () => {
      if (exited) return;
      child.stdin.end();
      const terminate = setTimeout(() => { if (!exited) child.kill(); }, 1000);
      const force = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 2500);
      let deadline;
      try {
        await Promise.race([
          processClosed,
          new Promise((_, reject) => {
            deadline = setTimeout(() => reject(diagnosticError('Codex app-server did not stop.', 'CODEX_CLOSE_TIMEOUT')), 4000);
          }),
        ]);
      } finally { clearTimeout(terminate); clearTimeout(force); clearTimeout(deadline); }
    })();
    return closePromise;
  }

  try {
    await request('initialize', {
      clientInfo: { name: 'robotband_chat_transfer', title: 'RobotBand Chat Transfer', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
  return { request, close };
}

/** Bootstrap an isolated home's schema without a turn or thread resume. */
export async function initializeHome({ binary, codexHome, cwd } = {}) {
  const client = await startCodex({ binary, codexHome, cwd });
  try { return await client.request('thread/list', { limit: 1 }); }
  finally { await client.close(); }
}
