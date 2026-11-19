"use client";

import { useCallback, useEffect, useState } from "react";
import "./dashboard.css";

type User = { id: string; login: string };
type Project = { id: string; name: string; repository_full_name: string };
type Repository = { id: number; name: string; full_name: string; installationId: number; private: boolean };

export default function Dashboard({ installUrl, localDev, githubCli }: { installUrl: string | null; localDev: boolean; githubCli: boolean }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError("");
    try {
      const me = await fetch("/api/me", { cache: "no-store" });
      if (!me.ok) throw new Error("Không thể tải tài khoản. Kiểm tra cấu hình database.");
      const data = await me.json() as { user: User | null };
      setUser(data.user);
      if (data.user) {
        const [p, r] = await Promise.all([fetch("/api/projects"), fetch("/api/github/repositories")]);
        if (!p.ok) throw new Error("Không thể tải dự án.");
        setProjects((await p.json()).projects);
        if (!r.ok) throw new Error(await r.text());
        setRepositories((await r.json()).repositories);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Có lỗi xảy ra."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    const repo = repositories.find((r) => `${r.installationId}:${r.id}` === selected);
    if (!repo) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositoryId: String(repo.id), installationId: String(repo.installationId), name }) });
      if (!response.ok) throw new Error(await response.text());
      setName(""); setSelected("");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Không thể tạo dự án."); }
    finally { setBusy(false); }
  }
  async function openProject(id: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/open`, { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json() as { url: string };
      window.location.assign(result.url);
    } catch (e) { setError(e instanceof Error ? e.message : "Không thể mở dự án."); setBusy(false); }
  }
  async function localSignIn() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/local", { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Không thể đăng nhập."); }
    finally { setBusy(false); }
  }
  async function signOut() {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (response.ok) { setUser(null); setProjects([]); setRepositories([]); }
    else setError("Không thể đăng xuất.");
  }

  return <main className="dashboard">
    <header className="dashboard-header"><div><span className="dashboard-mark">▦</span> AGENTWORLD <small>WORKSPACE</small></div>{user && <div className="dashboard-account">@{user.login} <button className="dashboard-link" onClick={() => void signOut()}>Đăng xuất</button></div>}</header>
    <div className="dashboard-content">
      <div className="dashboard-intro"><p className="dashboard-eyebrow">YOUR AGENT WORKSPACE</p><h1>Dự án của bạn<span>.</span></h1><p>Quản lý repository và đội agent ở cùng một nơi.</p></div>
      {error && <div className="dashboard-error" role="alert">{error}</div>}
      {loading ? <p>Đang tải…</p> : !user ? <section className="dashboard-card dashboard-welcome"><h2>Kết nối GitHub</h2><p>Đăng nhập để chọn repository và tạo dự án.</p>{githubCli ? <button className="dashboard-button" onClick={() => void localSignIn()} disabled={busy}>{busy ? "Đang kết nối…" : "Đăng nhập bằng GitHub CLI →"}</button> : <a className="dashboard-button" href="/api/auth/github/start">Tiếp tục với GitHub →</a>}</section> : <div className="dashboard-grid">
        <section><div className="dashboard-section-head"><h2>Dự án</h2><span>{projects.length} DỰ ÁN</span></div>
          {projects.length ? <div className="dashboard-projects">{projects.map((p) => <article key={p.id} className="dashboard-card project-card"><div className="dashboard-project-icon">▦</div><div><h3>{p.name}</h3><p>{p.repository_full_name}</p></div>{localDev ? <button className="dashboard-button dashboard-open" disabled={busy} onClick={() => void openProject(p.id)}>{busy ? "Đang mở…" : "Mở dự án →"}</button> : <span className="dashboard-pending">CHƯA KẾT NỐI AGENT</span>}</article>)}</div> : <div className="dashboard-card dashboard-empty"><h3>Chưa có dự án nào</h3><p>Chọn một repository để bắt đầu.</p></div>}
        </section>
        <section><div className="dashboard-section-head"><h2>Tạo dự án</h2></div><form className="dashboard-card dashboard-form" onSubmit={(e) => void createProject(e)}><label>REPOSITORY<select value={selected} onChange={(e) => { setSelected(e.target.value); const repo = repositories.find((r) => `${r.installationId}:${r.id}` === e.target.value); if (repo) setName(repo.name); }} required><option value="">Chọn repository</option>{repositories.map((repo) => <option key={`${repo.installationId}:${repo.id}`} value={`${repo.installationId}:${repo.id}`}>{repo.full_name}{repo.private ? " 🔒" : ""}</option>)}</select></label><label>TÊN DỰ ÁN<input maxLength={120} required value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên dự án" /></label><button className="dashboard-button" disabled={busy || !selected}>{busy ? "Đang tạo…" : "Tạo dự án →"}</button><p>Chưa thấy repository? {githubCli ? "Kiểm tra quyền của GitHub CLI." : installUrl ? <a href={installUrl} target="_blank" rel="noreferrer">Cài GitHub App</a> : "Cấu hình GITHUB_APP_SLUG để cài GitHub App."} Sau đó <button type="button" className="dashboard-link" onClick={() => void refresh()}>tải lại danh sách</button>.</p></form></section>
      </div>}
    </div>
  </main>;
}
