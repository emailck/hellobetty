import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hello Betty 管理台",
  description: "少儿英语课后练习管理台",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
