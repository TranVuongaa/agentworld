import Dashboard from "./view";
import { localDevEnabled, localGithubCliEnabled } from "../saas/lib/local";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const slug = process.env.GITHUB_APP_SLUG;
  const installUrl = slug && /^[a-z0-9-]+$/i.test(slug) ? `https://github.com/apps/${slug}/installations/new` : null;
  return <Dashboard installUrl={installUrl} localDev={localDevEnabled()} githubCli={localGithubCliEnabled()} />;
}
