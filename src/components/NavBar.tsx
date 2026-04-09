"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";

interface NavBarProps {
  userName: string;
  userRole: "אומן" | "מנהל";
  userLocation?: string;
}

export default function NavBar({ userName, userRole, userLocation }: NavBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportTitle, setReportTitle] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [reportSending, setReportSending] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportSuccess, setReportSuccess] = useState("");

  const locationText = userLocation?.trim() ? userLocation : "לא מצא";

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth", { method: "DELETE" });
      router.push("/");
      router.refresh();
    } catch {
      setLoggingOut(false);
    }
  }

  async function handleSubmitIssue() {
    const title = reportTitle.trim();
    const description = reportDescription.trim();

    if (!title || !description) {
      setReportError("יש למלא כותרת ותיאור תקלה");
      return;
    }

    setReportSending(true);
    setReportError("");
    setReportSuccess("");

    try {
      const response = await fetch("/api/report-issue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          description,
          path: pathname,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setReportError(data?.error || "שגיאה בשליחת הדיווח");
        return;
      }

      setReportSuccess("הדיווח נשלח בהצלחה. תודה!");
      setReportTitle("");
      setReportDescription("");
    } catch {
      setReportError("שגיאה בשליחת הדיווח");
    } finally {
      setReportSending(false);
    }
  }

  const navLinks =
    userRole === "מנהל"
      ? [
          { href: "/admin", label: "ניהול הזמנות" },
        ]
      : [
          { href: "/orders", label: "הזמנות פתוחות" },
          { href: "/my-registrations", label: "ההזמנות שלי" },
        ];

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo / Brand */}
          <div className="flex items-center gap-3">
            <Image
              src="https://d33zzd4k5u0xj2.cloudfront.net/eu-central-1/workforms-form-logos/d2838fce-3c76-48ff-88dc-efb4b28e39be_581908"
              alt="לוגו העמותה"
              width={80}
              height={40}
              className="h-10 w-auto object-contain"
              priority
            />
            <span className="font-bold text-gray-900 text-lg hidden sm:block">
              רישום לאירועים
            </span>
          </div>

          {/* Desktop Nav Links */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
                  pathname === link.href
                    ? "bg-blue-50 text-blue-600"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* User Info & Logout */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end gap-0.5">
              <span className="text-sm font-medium text-gray-900">
                {userName}
              </span>
              <div className="flex items-center gap-1.5">
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    userRole === "מנהל"
                      ? "bg-purple-100 text-purple-700"
                      : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {userRole}
                </span>
                {userRole !== "מנהל" && (
                  <span className="text-xs text-gray-400 flex items-center gap-0.5">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {locationText}
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={() => {
                setReportOpen(true);
                setMenuOpen(false);
                setReportError("");
                setReportSuccess("");
              }}
              className="hidden sm:flex items-center gap-1.5 text-sm text-gray-500 hover:text-orange-500 transition-colors duration-150"
              title="דיווח תקלה"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M5.062 20h13.876c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.33 17c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              דווח תקלה
            </button>

            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="hidden sm:flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-500 transition-colors duration-150 disabled:opacity-50"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              {loggingOut ? "מתנתק..." : "התנתק"}
            </button>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="md:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                {menuOpen ? (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                ) : (
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {menuOpen && (
          <div className="md:hidden border-t border-gray-100 py-3 space-y-1">
            <div className="px-3 py-2 flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-gray-900">
                {userName}
              </span>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  userRole === "מנהל"
                    ? "bg-purple-100 text-purple-700"
                    : "bg-blue-100 text-blue-700"
                }`}
              >
                {userRole}
              </span>
              {userRole !== "מנהל" && (
                <span className="text-xs text-gray-400 flex items-center gap-0.5">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {locationText}
                </span>
              )}
            </div>

            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
                  pathname === link.href
                    ? "bg-blue-50 text-blue-600"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {link.label}
              </Link>
            ))}

            <button
              onClick={() => {
                setReportOpen(true);
                setMenuOpen(false);
                setReportError("");
                setReportSuccess("");
              }}
              className="w-full text-right px-3 py-2 text-sm text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
            >
              דווח תקלה
            </button>

            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="w-full text-right px-3 py-2 text-sm text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            >
              {loggingOut ? "מתנתק..." : "התנתק"}
            </button>
          </div>
        )}
      </div>

      {reportOpen && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-gray-100">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">דיווח תקלה</h3>
              <button
                onClick={() => {
                  setReportOpen(false);
                  setReportError("");
                  setReportSuccess("");
                }}
                className="p-1 text-gray-400 hover:text-gray-600"
                aria-label="סגור"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 space-y-3">
              <input
                value={reportTitle}
                onChange={(e) => setReportTitle(e.target.value)}
                placeholder="כותרת קצרה"
                maxLength={120}
                className="input-field text-sm"
              />
              <textarea
                value={reportDescription}
                onChange={(e) => setReportDescription(e.target.value)}
                placeholder="תיאור התקלה"
                maxLength={3000}
                rows={5}
                className="input-field text-sm resize-y"
              />

              {reportError && (
                <p className="text-xs text-red-600">{reportError}</p>
              )}
              {reportSuccess && (
                <p className="text-xs text-green-600">{reportSuccess}</p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => {
                    setReportOpen(false);
                    setReportError("");
                    setReportSuccess("");
                  }}
                  className="btn-secondary text-sm"
                  disabled={reportSending}
                >
                  סגור
                </button>
                <button
                  onClick={handleSubmitIssue}
                  disabled={reportSending}
                  className="btn-primary text-sm disabled:opacity-60"
                >
                  {reportSending ? "שולח..." : "שלח דיווח"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
