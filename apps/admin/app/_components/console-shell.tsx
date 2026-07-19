"use client";

import type { ReactNode } from "react";
import { Activity, BookOpen, Coins, LayoutDashboard, LogOut } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "运营账号", icon: LayoutDashboard },
  { href: "/homeworks", label: "作业管理", icon: BookOpen },
  { href: "/points", label: "积分规则", icon: Coins },
  { href: "/assessments", label: "评测队列", icon: Activity },
];

export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return <div className="console">
    <aside className="sidebar">
      <div className="sidebar-brand">Hello Betty</div>
      <nav className="sidebar-nav" aria-label="管理工作区">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => <a key={href} className={`nav-link ${pathname === href ? "active" : ""}`} href={href}><Icon size={17} />{label}</a>)}
      </nav>
      <div className="sidebar-footer"><button className="logout" onClick={logout}><LogOut size={16} />退出登录</button></div>
    </aside>
    {children}
  </div>;
}
