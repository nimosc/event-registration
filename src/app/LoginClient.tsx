"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

interface LoginClientProps {
  magicId?: string;
  inactive?: boolean;
}

export default function LoginClient({ magicId, inactive }: LoginClientProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [locations, setLocations] = useState<string[]>([]);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [workedBefore, setWorkedBefore] = useState<"כן" | "לא" | "">("");
  const [trained, setTrained] = useState<"כן" | "לא" | "">("");
  const [locationOptions, setLocationOptions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isRegisterMode = mode === "register";
  const isNoAccountError = error === "אין לך משתמש";
  const isInactiveError = error === "משתמש לא פעיל";
  const isSubmitDisabled =
    loading ||
    !phone.trim() ||
    (isRegisterMode &&
      (!name.trim() ||
        !address.trim() ||
        locations.length === 0 ||
        !email.trim() ||
        !workedBefore ||
        !trained));

  useEffect(() => {
    if (inactive) {
      setError("משתמש לא פעיל");
    }
  }, [inactive]);

  useEffect(() => {
    if (!magicId) return;
    setLoading(true);
    fetch(`/api/magic-link?id=${encodeURIComponent(magicId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          router.push(data.user?.role === "מנהל" ? "/admin" : "/orders");
          router.refresh();
        } else {
          setError(data.error || "לינק לא תקין");
          setLoading(false);
        }
      })
      .catch(() => {
        setError("שגיאת רשת. בדוק את החיבור לאינטרנט.");
        setLoading(false);
      });
  }, [magicId, router]);

  useEffect(() => {
    if (mode !== "register") return;
    let cancelled = false;
    fetch("/api/profile/location/options")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setLocationOptions(Array.isArray(data.options) ? data.options : []);
      })
      .catch(() => {
        if (!cancelled) setLocationOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const endpoint = isRegisterMode ? "/api/register-request" : "/api/account-recovery";
      const body =
        isRegisterMode
          ? { name, address, locations, phone, email, workedBefore, trained }
          : { phone };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "שגיאה בשליחה");
        return;
      }
      setMessage(
        isRegisterMode
          ? "ההרשמה נקלטה בהצלחה. נחזור אליך בהמשך."
          : "מעולה, נשלחה אליך הודעת וואטסאפ להתחברות."
      );
      setName("");
      setAddress("");
      setLocations([]);
      setPhone("");
      setEmail("");
      setWorkedBefore("");
      setTrained("");
    } catch {
      setError("שגיאת רשת. בדוק את החיבור לאינטרנט.");
    } finally {
      setLoading(false);
    }
  }

  function toggleLocation(option: string) {
    setLocations((prev) =>
      prev.includes(option) ? prev.filter((value) => value !== option) : [...prev, option]
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex flex-col items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-100 rounded-full opacity-30 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-100 rounded-full opacity-30 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-4">
            <Image
              src="/images/logo.png.png"
              alt="לוגו העמותה"
              width={160}
              height={80}
              className="h-20 w-auto object-contain"
              priority
            />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">מערכת רישום לאירועים</h1>
          <p className="text-gray-500 text-sm mt-1">
            {magicId && loading
              ? "מתחבר אוטומטית..."
              : isRegisterMode
                ? "הרשמה ראשונה: ממלאים פרטים ואנחנו חוזרים אליך להמשך תהליך"
                : "התחברות ראשונה: מזינים טלפון ומקבלים הודעת וואטסאפ להתחברות"}
          </p>
        </div>

        {/* Magic link loading state */}
        {magicId && loading ? (
          <div className="bg-white rounded-2xl shadow-xl shadow-gray-200/50 border border-gray-100 p-10 flex flex-col items-center gap-4">
            <svg className="animate-spin w-10 h-10 text-blue-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-gray-500 text-sm">מזהה את המשתמש...</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-xl shadow-gray-200/50 border border-gray-100 p-8">
            <div className="grid grid-cols-2 gap-2 mb-5 p-1 bg-gray-100 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setError(null);
                  setMessage(null);
                }}
                className={`rounded-lg py-2.5 text-sm font-medium transition-colors ${
                  !isRegisterMode ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                התחברות
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("register");
                  setError(null);
                  setMessage(null);
                }}
                className={`rounded-lg py-2.5 text-sm font-medium transition-colors ${
                  isRegisterMode ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                הרשמה חדשה
              </button>
            </div>

            <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700">
              {isRegisterMode
                ? "מילוי הטופס אינו התחייבות. לאחר בדיקה נחזור אליך ונעדכן על המשך התהליך."
                : "ההודעה נשלחת רק למשתמש פעיל. אם עדיין אין לך משתמש, אפשר לעבור להרשמה חדשה."}
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {isRegisterMode && (
                <>
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1.5">שם מלא</label>
                    <input
                      id="name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      autoComplete="name"
                      placeholder="הכנס שם מלא"
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-sm"
                    />
                  </div>

                  <div>
                    <label htmlFor="address" className="block text-sm font-medium text-gray-700 mb-1.5">כתובת</label>
                    <input
                      id="address"
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      required
                      autoComplete="street-address"
                      placeholder="עיר, רחוב ומספר בית"
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">איזור מגורים</label>
                    <div className="border border-gray-300 rounded-xl p-3 max-h-44 overflow-y-auto bg-white">
                      <p className="text-xs text-gray-500 mb-2">אפשר לבחור יותר מאיזור אחד</p>
                      <div className="space-y-1.5">
                        {locationOptions.map((option) => (
                          <label key={option} className="flex items-center gap-2 text-sm text-gray-800">
                            <input
                              type="checkbox"
                              checked={locations.includes(option)}
                              onChange={() => toggleLocation(option)}
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span>{option}</span>
                          </label>
                        ))}
                        {locationOptions.length === 0 && (
                          <p className="text-xs text-gray-500">אין אפשרויות זמינות כרגע</p>
                        )}
                      </div>
                    </div>
                    {locations.length > 0 && (
                      <p className="text-xs text-gray-500 mt-1">נבחרו {locations.length} איזורים: {locations.join(", ")}</p>
                    )}
                  </div>
                </>
              )}

              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1.5">טלפון</label>
                <div className="relative">
                  <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.949.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.129a11.042 11.042 0 005.516 5.516l1.129-2.257a1 1 0 011.21-.502l4.493 1.498A1 1 0 0121 15.72V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                  </div>
                  <input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    autoComplete="tel"
                    placeholder="למשל: 0501234567"
                    className="w-full border border-gray-300 rounded-xl pr-10 pl-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-sm"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">אפשר להזין בכל פורמט (עם/בלי 0, עם +972 וכו').</p>
              </div>

              {isRegisterMode && (
                <>
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">כתובת מייל</label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      placeholder="name@example.com"
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-sm"
                    />
                  </div>

                  <div>
                    <label htmlFor="workedBefore" className="block text-sm font-medium text-gray-700 mb-1.5">האם עבדת בעבר עם עמותת נשימה</label>
                    <select
                      id="workedBefore"
                      value={workedBefore}
                      onChange={(e) => setWorkedBefore(e.target.value as "כן" | "לא" | "")}
                      required
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-sm"
                    >
                      <option value="">בחר תשובה</option>
                      <option value="כן">כן</option>
                      <option value="לא">לא</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="trained" className="block text-sm font-medium text-gray-700 mb-1.5">האם עברת הכשרה</label>
                    <select
                      id="trained"
                      value={trained}
                      onChange={(e) => setTrained(e.target.value as "כן" | "לא" | "")}
                      required
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow text-sm"
                    >
                      <option value="">בחר תשובה</option>
                      <option value="כן">כן</option>
                      <option value="לא">לא</option>
                    </select>
                  </div>
                </>
              )}

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd" />
                  </svg>
                  <span>
                    {isNoAccountError
                      ? "עדיין אין לך משתמש במערכת. מוזמן להירשם."
                      : isInactiveError
                        ? "משתמש לא פעיל. כרגע אין לך גישה למערכת."
                        : error}
                  </span>
                </div>
              )}

              {!isRegisterMode && isNoAccountError && (
                <button
                  type="button"
                  onClick={() => {
                    setMode("register");
                    setError(null);
                    setMessage(null);
                  }}
                  className="w-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium py-3 px-4 rounded-xl transition-colors duration-150 text-sm"
                >
                  אין חשבון? עבור להרשמה
                </button>
              )}

              {message && (
                <div className="flex items-start gap-2.5 p-3.5 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.707a1 1 0 00-1.414-1.414L9 10.172 7.707 8.879a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd" />
                  </svg>
                  <span>{message}</span>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={isSubmitDisabled}
                className="w-full bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white font-semibold py-3 px-4 rounded-xl transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm shadow-sm shadow-blue-200"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    שולח...
                  </>
                ) : isRegisterMode ? "שלח בקשת הרשמה" : "שלח וואטסאפ להתחברות"}
              </button>
            </form>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-6">לבעיות גישה, פנה למנהל המערכת</p>
      </div>
    </div>
  );
}
