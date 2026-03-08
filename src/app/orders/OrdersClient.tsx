"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import NavBar from "@/components/NavBar";
import OrderCard, { Order } from "@/components/OrderCard";
import { SessionUser } from "@/lib/auth";

interface OrdersClientProps {
  user: SessionUser;
}

const HEBREW_MONTHS: Record<number, string> = {
  1: "ינואר", 2: "פברואר", 3: "מרץ", 4: "אפריל",
  5: "מאי", 6: "יוני", 7: "יולי", 8: "אוגוסט",
  9: "ספטמבר", 10: "אוקטובר", 11: "נובמבר", 12: "דצמבר",
};

function parseMonthKey(dateStr: string): string {
  if (!dateStr) return "";
  const match = dateStr.match(/(\d{4})-(\d{2})/);
  if (!match) return "";
  return `${match[1]}-${match[2]}`;
}

function monthKeyToLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${HEBREW_MONTHS[parseInt(month)]} ${year}`;
}

function getCurrentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getNextMonthKey(): string {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-20 h-20 bg-gray-100 rounded-3xl flex items-center justify-center mb-5">
        <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-gray-600 mb-1">
        {filtered ? "אין הזמנות בחודש זה" : "אין הזמנות פתוחות"}
      </h3>
      <p className="text-sm text-gray-400 max-w-xs">
        {filtered ? "נסה לבחור חודש אחר או הצג את כל ההזמנות" : "כרגע אין הזמנות פתוחות לרישום. בדוק שוב מאוחר יותר."}
      </p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 animate-pulse shadow-sm">
          <div className="flex justify-between mb-4">
            <div className="h-5 bg-gray-100 rounded-lg w-3/5" />
            <div className="h-5 bg-gray-100 rounded-full w-20" />
          </div>
          <div className="space-y-2.5 mb-5">
            <div className="h-4 bg-gray-100 rounded w-2/5" />
            <div className="h-4 bg-gray-100 rounded w-3/5" />
          </div>
          <div className="h-2 bg-gray-100 rounded-full mb-5" />
          <div className="h-10 bg-gray-100 rounded-xl" />
        </div>
      ))}
    </div>
  );
}

export default function OrdersClient({ user }: OrdersClientProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>("upcoming");
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/orders");
      const data = await res.json();
      if (!res.ok) { setError(data.error || "שגיאה בטעינת הזמנות"); return; }
      const sorted = [...(data.orders ?? [])].sort((a: Order, b: Order) =>
        (a.date || "").localeCompare(b.date || "")
      );
      setOrders(sorted);
    } catch {
      setError("שגיאת רשת. בדוק את החיבור לאינטרנט.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders, lastRefresh]);

  // Build month list — only current month and future
  const availableMonths = useMemo(() => {
    const curKey = getCurrentMonthKey();
    const keys = new Set<string>();
    orders.forEach(o => { const k = parseMonthKey(o.date); if (k && k >= curKey) keys.add(k); });
    return Array.from(keys).sort();
  }, [orders]);

  const filteredOrders = useMemo(() => {
    if (selectedMonth === "all") return orders;
    if (selectedMonth === "upcoming") {
      const cur = getCurrentMonthKey();
      const next = getNextMonthKey();
      return orders.filter(o => {
        const k = parseMonthKey(o.date);
        return k === cur || k === next;
      });
    }
    return orders.filter(o => parseMonthKey(o.date) === selectedMonth);
  }, [orders, selectedMonth]);

  async function handleRegister(orderId: string) {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "שגיאה בתהליך הרישום");
    setOrders(prev => prev.map(o =>
      o.id === orderId
        ? { ...o, isRegistered: true, subitemId: data.subitemId, assignedCount: o.assignedCount + 1, spotsRemaining: Math.max(0, o.spotsRemaining - 1) }
        : o
    ));
  }

  async function handleUnregister(orderId: string, subitemId: string) {
    const res = await fetch("/api/register", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, subitemId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "שגיאה בביטול הרישום");
    setOrders(prev => prev.map(o =>
      o.id === orderId
        ? { ...o, isRegistered: false, subitemId: undefined, assignedCount: Math.max(0, o.assignedCount - 1), spotsRemaining: o.spotsRemaining + 1, status: "בתהליך שיבוץ" }
        : o
    ));
  }

  const myOrders = filteredOrders.filter(o => o.isRegistered);
  const openOrders = filteredOrders.filter(o => !o.isRegistered && (o.requiredCount === 0 || o.spotsRemaining > 0));
  const fullOrders = filteredOrders.filter(o => !o.isRegistered && o.requiredCount > 0 && o.spotsRemaining <= 0);

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "בוקר טוב";
    if (hour < 17) return "צהריים טובים";
    return "ערב טוב";
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar userName={user.name} userRole={user.role} />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">

        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-gray-500 mb-1">{greeting()}, {user.name.split(" ")[0]}</p>
              <h1 className="text-2xl font-bold text-gray-900">הזמנות פתוחות</h1>
            </div>
            <button
              onClick={() => setLastRefresh(Date.now())}
              disabled={loading}
              title="רענן"
              className="mt-1 p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-white border border-transparent hover:border-gray-200 transition-all disabled:opacity-40"
            >
              <svg className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>

          {/* Stats row */}
          {!loading && orders.length > 0 && (
            <div className="flex gap-3 mt-5 flex-wrap">
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="text-gray-700 font-medium">{orders.length}</span>
                <span className="text-gray-500">הזמנות</span>
              </div>
              {myOrders.length > 0 && (
                <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2 text-sm">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-blue-700 font-medium">{myOrders.length}</span>
                  <span className="text-blue-600">הרשמות שלי</span>
                </div>
              )}
              {openOrders.length > 0 && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2 text-sm">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-green-700 font-medium">{openOrders.length}</span>
                  <span className="text-green-600">זמינות להרשמה</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Month Filter */}
        {!loading && availableMonths.length > 0 && (
          <div className="mb-6 -mx-1">
            <div className="flex gap-2 overflow-x-auto pb-1 px-1 scrollbar-hide">
              <button
                onClick={() => setSelectedMonth("upcoming")}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedMonth === "upcoming"
                    ? "bg-gray-900 text-white shadow-sm"
                    : "bg-white border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                החודש + הבא
              </button>
              <button
                onClick={() => setSelectedMonth("all")}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedMonth === "all"
                    ? "bg-gray-900 text-white shadow-sm"
                    : "bg-white border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                כל החודשים
              </button>
              {availableMonths.map(key => (
                <button
                  key={key}
                  onClick={() => setSelectedMonth(key)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    selectedMonth === key
                      ? "bg-gray-900 text-white shadow-sm"
                      : "bg-white border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
                  }`}
                >
                  {monthKeyToLabel(key)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-600 flex items-center gap-3">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <LoadingSkeleton />
        ) : filteredOrders.length === 0 ? (
          <EmptyState filtered={selectedMonth !== "all"} />
        ) : (
          <div className="space-y-8">

            {/* My registrations */}
            {myOrders.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-4 bg-blue-500 rounded-full" />
                  <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">הרשמות שלי</h2>
                  <span className="text-xs bg-blue-100 text-blue-600 font-semibold px-2 py-0.5 rounded-full">{myOrders.length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {myOrders.map(order => (
                    <OrderCard key={order.id} order={order} onRegister={handleRegister} onUnregister={handleUnregister} />
                  ))}
                </div>
              </section>
            )}

            {/* Available */}
            {openOrders.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-4 bg-green-500 rounded-full" />
                  <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">פתוחות להרשמה</h2>
                  <span className="text-xs bg-green-100 text-green-600 font-semibold px-2 py-0.5 rounded-full">{openOrders.length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {openOrders.map(order => (
                    <OrderCard key={order.id} order={order} onRegister={handleRegister} onUnregister={handleUnregister} />
                  ))}
                </div>
              </section>
            )}

            {/* Full */}
            {fullOrders.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-4 bg-gray-300 rounded-full" />
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">הזמנות מלאות</h2>
                  <span className="text-xs bg-gray-100 text-gray-500 font-semibold px-2 py-0.5 rounded-full">{fullOrders.length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-50">
                  {fullOrders.map(order => (
                    <OrderCard key={order.id} order={order} onRegister={handleRegister} onUnregister={handleUnregister} />
                  ))}
                </div>
              </section>
            )}

          </div>
        )}
      </main>
    </div>
  );
}
