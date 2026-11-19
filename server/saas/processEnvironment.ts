/** Environment needed by the local supervisor's Git, tmux and Docker CLI tools.
 * Project credentials are delivered separately through the credential broker.
 */
export function projectProcessEnvironment(source: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const allowed = new Set([
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "TZ", "TERM", "COLORTERM",
    "USERPROFILE", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA",
    "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "XDG_RUNTIME_DIR",
    "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY",
    "DOCKER_SANDBOXES_API", "SANDBOXES_STORAGE_ROOT",
  ]);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && (allowed.has(key.toUpperCase()) || /^LC_[A-Z_]+$/.test(key))) result[key] = value;
  }
  return result as NodeJS.ProcessEnv;
}
