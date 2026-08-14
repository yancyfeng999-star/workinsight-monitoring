import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "WorkInsight 管理控制台",
  description: "员工行为分析监控系统管理后台",
};

const NAV = [
  { href: "/", label: "概览" },
  { href: "/teams", label: "团队" },
  { href: "/devices", label: "设备" },
  { href: "/enrollment", label: "注册" },
  { href: "/policies", label: "策略" },
  { href: "/audit", label: "审计" },
  { href: "/insight", label: "洞察" },
  { href: "/system", label: "系统" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <nav
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "12px 24px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-card)",
            flexWrap: "wrap",
            position: "sticky",
            top: 0,
            zIndex: 50,
          }}
        >
          <Link
            href="/"
            style={{
              fontWeight: 800,
              fontSize: "1.1rem",
              marginRight: 16,
              color: "var(--primary)",
            }}
          >
            WorkInsight
          </Link>
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              style={{
                padding: "6px 12px",
                borderRadius: "var(--radius)",
                fontSize: "0.85rem",
                fontWeight: 500,
                color: "var(--text-secondary)",
              }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
