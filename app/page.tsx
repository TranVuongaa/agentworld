import { redirect } from "next/navigation";
import OfficeEntry from "./OfficeEntry";

export const dynamic = "force-dynamic";
export default async function Home({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  if (!(await searchParams).token) redirect("/dashboard");
  return <OfficeEntry />;
}
