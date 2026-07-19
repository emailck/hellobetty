"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "登录失败，请稍后重试");
      router.replace("/dashboard");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "网络连接失败，请稍后再试");
    } finally {
      setIsSubmitting(false);
    }
  }

  return <main className="auth-shell"><section className="auth-card" aria-labelledby="login-title">
    <div className="brand">Hello Betty 管理台</div>
    <h1 id="login-title">登录管理台</h1>
    <p className="lead">使用已创建的教师或管理员账号登录。</p>
    <form onSubmit={onSubmit}>
      <div className="field"><label htmlFor="phone">手机号</label><input id="phone" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="username" inputMode="tel" required /></div>
      <div className="field"><label htmlFor="password">密码</label><input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={8} required /></div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" disabled={isSubmitting} type="submit">{isSubmitting ? "正在登录..." : "登录"}</button>
    </form>
    <p className="form-note">首个管理员账号由 API 初始化脚本创建。</p>
  </section></main>;
}
