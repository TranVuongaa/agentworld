import "../src/index.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
export const metadata: Metadata = { title: "TranVuong HQ" };
export default function RootLayout({ children }: { children: ReactNode }) { return <html lang="en"><body><div id="root">{children}</div></body></html>; }
