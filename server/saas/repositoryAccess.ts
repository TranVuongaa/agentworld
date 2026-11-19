/** Match the saved installation first; allow an unambiguous rebinding after an auth-mode change. */
export function selectAccessibleRepository<T extends { id: number; installationId: number }>(repositories: T[], repositoryId: string, installationId: string): T | null {
  const matches = repositories.filter((repository) => String(repository.id) === repositoryId);
  return matches.find((repository) => String(repository.installationId) === installationId) ?? (matches.length === 1 ? matches[0] : null);
}
