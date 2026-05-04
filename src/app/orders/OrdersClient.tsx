"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
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
        {filtered ? "נסה לבחור חודש אחר או הצג את כל ההזמנות" : "כרגע אין הזמנות פתוחות להגשת מועמדות. בדוק שוב מאוחר יותר."}
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
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>("upcoming");
  const [selectedLocation, setSelectedLocation] = useState<string>("all");
  const [locationInitialized, setLocationInitialized] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [showLocationModal, setShowLocationModal] = useState(!user.location);
  const [artistLocationOptions, setArtistLocationOptions] = useState<string[]>([]);
  const [artistLocationOptionsLoading, setArtistLocationOptionsLoading] = useState(false);
  const [locationInput, setLocationInput] = useState("");
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!showLocationModal) return;
    if (artistLocationOptions.length > 0) return;

    let cancelled = false;
    async function loadOptions() {
      setArtistLocationOptionsLoading(true);
      try {
        const res = await fetch("/api/profile/location/options");
        const data = await res.json();
        if (!res.ok) return;
        if (!cancelled) setArtistLocationOptions(Array.isArray(data.options) ? data.options : []);
      } catch {
        // ignore (we fall back to input)
      } finally {
        if (!cancelled) setArtistLocationOptionsLoading(false);
      }
    }

    loadOptions();
    return () => {
      cancelled = true;
    };
  }, [showLocationModal, artistLocationOptions.length]);

  // Initialize location filter based on artist's location
  useEffect(() => {
    if (!locationInitialized && orders.length > 0 && user.location) {
      const locs = orders.map(o => o.orderLocation).filter(Boolean);
      if (locs.includes(user.location)) {
        setSelectedLocation(user.location);
      }
      setLocationInitialized(true);
    } else if (!locationInitialized && orders.length > 0) {
      setLocationInitialized(true);
    }
  }, [orders, user.location, locationInitialized]);

  // Build month list
  const availableMonths = useMemo(() => {
    const keys = new Set<string>();
    orders.forEach(o => { const k = parseMonthKey(o.date); if (k) keys.add(k); });
    return Array.from(keys).sort();
  }, [orders]);

  // Build location list
  const availableLocations = useMemo(() => {
    const locs = new Set<string>();
    orders.forEach(o => { if (o.orderLocation) locs.add(o.orderLocation); });
    return Array.from(locs).sort();
  }, [orders]);

  const filteredOrders = useMemo(() => {
    let result = orders;

    // Location filter
    if (selectedLocation !== "all") {
      result = result.filter(o => o.orderLocation === selectedLocation);
    }

    // Month filter
    if (selectedMonth === "all") return result;
    if (selectedMonth === "upcoming") {
      const cur = getCurrentMonthKey();
      const next = getNextMonthKey();
      return result.filter(o => {
        const k = parseMonthKey(o.date);
        return k === cur || k === next;
      });
    }
    return result.filter(o => parseMonthKey(o.date) === selectedMonth);
  }, [orders, selectedMonth, selectedLocation]);

  async function handleSaveLocation() {
    if (!locationInput.trim()) return;
    setLocationSaving(true);
    setLocationError(null);
    try {
      const res = await fetch("/api/profile/location", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: locationInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setLocationError(data.error || "שגיאה בשמירה"); return; }
      setShowLocationModal(false);
      router.refresh();
    } catch {
      setLocationError("שגיאת רשת. נסה שוב.");
    } finally {
      setLocationSaving(false);
    }
  }

  async function handleRegister(orderId: string) {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "שגיאה בהגשת המועמדות");
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
    if (!res.ok) throw new Error(data.error || "שגיאה בביטול המועמדות");
    setOrders(prev => prev.filter(o => o.id !== orderId));
  }

  const isPastOrder = (date: string) =>
    date ? new Date(date) < new Date(new Date().toDateString()) : false;

  const myOrders = filteredOrders.filter(o => o.isRegistered);
  const assignmentDoneOrders = filteredOrders.filter(
    (o) => !o.isRegistered && o.status === "הסתיים השיבוץ" && !isPastOrder(o.date)
  );
  const candidacyClosedOrders = filteredOrders.filter(
    (o) => !o.isRegistered && o.status === "סגירת קבלת מועמדויות" && !isPastOrder(o.date)
  );
  const openOrders = filteredOrders.filter(
    (o) =>
      !o.isRegistered &&
      o.status !== "הסתיים השיבוץ" &&
      o.status !== "סגירת קבלת מועמדויות" &&
      (o.requiredCount === 0 || o.spotsRemaining > 0)
  );
  const closedOrders = filteredOrders.filter(
    (o) =>
      !o.isRegistered &&
      o.status !== "הסתיים השיבוץ" &&
      o.status !== "סגירת קבלת מועמדויות" &&
      o.requiredCount > 0 &&
      o.spotsRemaining <= 0
  );

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "בוקר טוב";
    if (hour < 17) return "צהריים טובים";
    return "ערב טוב";
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar userName={user.name} userRole={user.role} userLocation={user.location} />

      {/* Location setup modal */}
      {showLocationModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="text-center mb-5">
              <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-gray-900">הגדר את האזור שלך</h2>
              <p className="text-sm text-gray-500 mt-1">
                בחר את האזור הגיאוגרפי שלך כדי לראות הזמנות רלוונטיות
              </p>
            </div>

            {artistLocationOptionsLoading ? (
              <div className="grid grid-cols-2 gap-2 mb-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-11 bg-gray-100 rounded-xl animate-pulse border border-gray-50" />
                ))}
              </div>
            ) : artistLocationOptions.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 mb-4">
                {artistLocationOptions.map((loc) => (
                  <button
                    key={loc}
                    onClick={() => setLocationInput(loc)}
                    className={`py-2.5 px-3 rounded-xl text-sm font-medium border transition-all ${
                      locationInput === loc
                        ? "bg-blue-500 text-white border-blue-500"
                        : "bg-white text-gray-700 border-gray-200 hover:border-blue-300"
                    }`}
                  >
                    {loc}
                  </button>
                ))}
              </div>
            ) : (
              <input
                type="text"
                value={locationInput}
                onChange={(e) => setLocationInput(e.target.value)}
                placeholder="הכנס שם אזור..."
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}

            {locationError && (
              <p className="text-sm text-red-500 mb-3 text-center">{locationError}</p>
            )}

            <button
              onClick={handleSaveLocation}
              disabled={!locationInput || locationSaving}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 rounded-xl text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {locationSaving ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  שומר...
                </>
              ) : "שמור ומשך"}
            </button>
          </div>
        </div>
      )}

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
                  <span className="text-blue-600">המועמדויות שלי</span>
                </div>
              )}
              {openOrders.length > 0 && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2 text-sm">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-green-700 font-medium">{openOrders.length}</span>
                  <span className="text-green-600">פתוחות למועמדות</span>
                </div>
              )}
              {assignmentDoneOrders.length > 0 && (
                <div className="flex items-center gap-2 bg-slate-100 border border-slate-200 rounded-xl px-4 py-2 text-sm">
                  <span className="w-2 h-2 rounded-full bg-slate-500" />
                  <span className="text-slate-700 font-medium">{assignmentDoneOrders.length}</span>
                  <span className="text-slate-600">הסתיים השיבוץ</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Filters row: month + location */}
        {!loading && (availableMonths.length > 0 || availableLocations.length > 0) && (
          <div className="mb-6 flex flex-col gap-3">
            {/* Month filter */}
            {availableMonths.length > 0 && (
              <div className="-mx-1">
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

            {/* Location filter */}
            {availableLocations.length > 0 && (
              <div className="-mx-1">
                <div className="flex gap-2 overflow-x-auto pb-1 px-1 scrollbar-hide">
                  <button
                    onClick={() => setSelectedLocation("all")}
                    className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      selectedLocation === "all"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-white border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
                    }`}
                  >
                    כל הלוקיישנים
                  </button>
                  {availableLocations.map(loc => (
                    <button
                      key={loc}
                      onClick={() => setSelectedLocation(loc)}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        selectedLocation === loc
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "bg-white border border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
                      }`}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
          <EmptyState filtered={selectedMonth !== "all" || selectedLocation !== "all"} />
        ) : (
          <div className="space-y-8">

            {/* My candidacies */}
            {myOrders.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-4 bg-blue-500 rounded-full" />
                  <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">המועמדויות שלי</h2>
                  <span className="text-xs bg-blue-100 text-blue-600 font-semibold px-2 py-0.5 rounded-full">{myOrders.length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {myOrders.map(order => (
                    <OrderCard key={order.id} order={order} onRegister={handleRegister} onUnregister={handleUnregister} />
                  ))}
                </div>
              </section>
            )}

            {/* Open for candidacy */}
            {openOrders.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-4 bg-green-500 rounded-full" />
                  <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">פתוחות למועמדות</h2>
                  <span className="text-xs bg-green-100 text-green-600 font-semibold px-2 py-0.5 rounded-full">{openOrders.length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {openOrders.map(order => (
                    <OrderCard key={order.id} order={order} onRegister={handleRegister} onUnregister={handleUnregister} />
                  ))}
                </div>
              </section>
            )}

            {/* Candidacy submission closed */}
            {candidacyClosedOrders.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-4 bg-orange-300 rounded-full" />
                  <h2 className="text-sm font-semibold text-orange-500 uppercase tracking-wide">הגשת המועמדויות הסתיימה</h2>
                  <span className="text-xs bg-orange-100 text-orange-500 font-semibold px-2 py-0.5 rounded-full">{candidacyClosedOrders.length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-70">
                  {candidacyClosedOrders.map(order => (
                    <OrderCard key={order.id} order={order} onRegister={handleRegister} onUnregister={handleUnregister} />
                  ))}
                </div>
              </section>
            )}

            {/* Closed for candidacy */}
            {closedOrders.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-4 bg-gray-300 rounded-full" />
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">נסגרה קבלת מועמדויות</h2>
                  <span className="text-xs bg-gray-100 text-gray-500 font-semibold px-2 py-0.5 rounded-full">{closedOrders.length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-50">
                  {closedOrders.map(order => (
                    <OrderCard key={order.id} order={order} onRegister={handleRegister} onUnregister={handleUnregister} />
                  ))}
                </div>
              </section>
            )}

            {/* Assignment done */}
            {assignmentDoneOrders.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1 h-4 bg-slate-400 rounded-full" />
                  <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">הסתיים השיבוץ</h2>
                  <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded-full">{assignmentDoneOrders.length}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-70">
                  {assignmentDoneOrders.map(order => (
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
