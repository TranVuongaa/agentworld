export function appUrl(): URL {
  const url = new URL(process.env.SAAS_APP_URL || "http://127.0.0.1:7420");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid SAAS_APP_URL");
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("SAAS_APP_URL must use HTTPS outside localhost");
  return url;
}
