import { localDevEnabled } from "./local";

export async function github<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "agentworld" }, cache: "no-store" });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status})`);
  return response.json() as Promise<T>;
}
export interface Installation { id: number; account: { login: string } }
export interface Repository { id: number; full_name: string; name: string; private: boolean }
export async function repositories(token: string): Promise<Array<Repository & { installationId: number; accountLogin: string }>> {
  const all: Array<Repository & { installationId: number; accountLogin: string }> = [];
  if (localDevEnabled()) {
    for (let page = 1; ; page++) {
      const result = await github<Array<Repository & { owner: { login: string } }>>(token, `/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member&page=${page}`);
      all.push(...result.map((repo) => ({ ...repo, installationId: 0, accountLogin: repo.owner.login })));
      if (result.length < 100) break;
    }
    return all;
  }
  for (let page = 1; ; page++) {
    const result = await github<{ installations: Installation[] }>(token, `/user/installations?per_page=100&page=${page}`);
    for (const installation of result.installations) {
      for (let repoPage = 1; ; repoPage++) {
        const response = await github<{ repositories: Repository[] }>(token, `/user/installations/${installation.id}/repositories?per_page=100&page=${repoPage}`);
        all.push(...response.repositories.map((repository) => ({ ...repository, installationId: installation.id, accountLogin: installation.account.login })));
        if (response.repositories.length < 100) break;
      }
    }
    if (result.installations.length < 100) break;
  }
  return all;
}
