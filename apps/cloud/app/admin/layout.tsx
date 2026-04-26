import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { AdminShell } from "@/components/admin/admin-shell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login");
  }
  return <AdminShell email={session.email}>{children}</AdminShell>;
}
