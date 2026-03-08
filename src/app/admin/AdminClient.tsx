"use client";

import { useState, useEffect, useCallback } from "react";
import NavBar from "@/components/NavBar";
import RegistrantsList, { Registrant } from "@/components/RegistrantsList";
import { SessionUser } from "@/lib/auth";

const HEBREW_MONTHS: Record<number, string> = {
  1: "ינואר", 2: "פברואר", 3: "מרץ", 4: "אפריל",
  5: "מאי", 6: "יוני", 7: "יולי", 8: "אוגוסט",
  9: "ספטמבר", 10: "אוקטובר", 11: "נובמבר", 12: "דצמבר",
};

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return dateStr;
  const [, year, month, day] = match;
  return `${parseInt(day)} ב${HEBREW_MONTHS[parseInt(month)]} ${year}`;
}

interface AdminOrder {
  id: string;
  name: string;
  date: string;
  location: string;
  status: string;
  requiredCount: number;
  assignedCount: number;
  spotsRemaining: number;
  subitems: {
    id: string;
    name: string;
    linkedArtistIds: number[];
    role: string;
    attendanceStatus: string;
  }[];
}

interface AdminClientProps {
  user: SessionUser;
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    "בתהליך שיבוץ": "bg-blue-100 text-blue-700 border-blue-200",
    "הסתיים השיבוץ": "bg-green-100 text-green-700 border-green-200",
    "בוטל": "bg-red-100 text-red-700 border-red-200",
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
        colorMap[status] || "bg-gray-100 text-gray-600 border-gray-200"
      }`}
    >
      {status || "לא ידוע"}
    </span>
  );
}

function OrderAccordion({
  order,
  onConfirm,
}: {
  order: AdminOrder;
  onConfirm: (subitemId: string, action: "confirm" | "reject") => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);

  const registrants: Registrant[] = order.subitems.map((sub) => ({
    id: sub.id,
    name: sub.name,
    role: sub.role,
    attendanceStatus: sub.attendanceStatus,
  }));

  const filledPercent =
    order.requiredCount > 0
      ? Math.min(100, (order.assignedCount / order.requiredCount) * 100)
      : 0;

  const confirmedCount = order.subitems.filter(
    (s) => s.attendanceStatus === "מאושר"
  ).length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-gray-300 transition-colors">
      {/* Order header - clickable */}
      <button
        className="w-full text-right p-5 hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="font-semibold text-gray-900 text-base">
                {order.name}
              </h3>
              <StatusBadge status={order.status} />
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 mb-3">
              {order.date && (
                <span className="flex items-center gap-1">
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  {formatDate(order.date)}
                </span>
              )}
              {order.location && (
                <span className="flex items-center gap-1">
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                    />
                  </svg>
                  {order.location}
                </span>
              )}
            </div>

            {/* Progress */}
            {order.requiredCount > 0 && (
              <div>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>
                    {order.assignedCount} / {order.requiredCount} אמנים
                  </span>
                  <span>
                    {confirmedCount} מאושרים
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all ${
                      filledPercent >= 100 ? "bg-green-400" : "bg-blue-400"
                    }`}
                    style={{ width: `${filledPercent}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <span className="text-xs text-gray-500 flex items-center gap-1">
              {order.subitems.length} נרשמים
            </span>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
                expanded ? "rotate-180" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </div>
      </button>

      {/* Registrants list */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-3">
          <RegistrantsList
            orderId={order.id}
            registrants={registrants}
            onConfirm={onConfirm}
          />
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse"
        >
          <div className="flex justify-between mb-3">
            <div className="space-y-2 flex-1">
              <div className="h-5 bg-gray-200 rounded w-1/2" />
              <div className="h-4 bg-gray-100 rounded w-1/3" />
            </div>
            <div className="h-5 bg-gray-200 rounded w-16" />
          </div>
          <div className="h-1.5 bg-gray-100 rounded" />
        </div>
      ))}
    </div>
  );
}

export default function AdminClient({ user }: AdminClientProps) {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/orders");
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "שגיאה בטעינת הזמנות");
        return;
      }

      setOrders(data.orders);
    } catch {
      setError("שגיאת רשת. בדוק את החיבור לאינטרנט.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  async function handleConfirm(
    subitemId: string,
    action: "confirm" | "reject"
  ) {
    const res = await fetch("/api/admin/confirm", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subitemId, action }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "שגיאה בעדכון הסטטוס");
    }

    // Update local state
    setOrders((prev) =>
      prev.map((order) => ({
        ...order,
        subitems: order.subitems.map((sub) =>
          sub.id === subitemId
            ? {
                ...sub,
                attendanceStatus: action === "confirm" ? "מאושר" : "נדחה",
              }
            : sub
        ),
      }))
    );
  }

  // Filter and search
  const filteredOrders = orders.filter((order) => {
    const matchesStatus =
      filterStatus === "all" || order.status === filterStatus;
    const matchesSearch =
      !searchQuery ||
      order.name.includes(searchQuery) ||
      order.location.includes(searchQuery);
    return matchesStatus && matchesSearch;
  });

  const uniqueStatuses = Array.from(new Set(orders.map((o) => o.status).filter(Boolean)));
  const totalRegistrants = orders.reduce((sum, o) => sum + o.subitems.length, 0);
  const openOrders = orders.filter((o) => o.status === "בתהליך שיבוץ").length;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar userName={user.name} userRole={user.role} />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">ניהול הזמנות</h1>
              <p className="text-sm text-gray-500 mt-1">
                ניהול כל ההזמנות ואישור נרשמים
              </p>
            </div>
            <button
              onClick={fetchOrders}
              disabled={loading}
              title="רענן"
              className="mt-1 p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-white border border-transparent hover:border-gray-200 transition-all disabled:opacity-40"
            >
              <svg
                className={`w-5 h-5 ${loading ? "animate-spin" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>

          {/* Stats */}
          {!loading && (
            <div className="flex gap-3 mt-5 flex-wrap">
              <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                <span className="text-gray-700 font-medium">{orders.length}</span>
                <span className="text-gray-500">הזמנות</span>
              </div>
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2 text-sm">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-green-700 font-medium">{openOrders}</span>
                <span className="text-green-600">פתוחות</span>
              </div>
              <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-xl px-4 py-2 text-sm">
                <span className="w-2 h-2 rounded-full bg-purple-400" />
                <span className="text-purple-700 font-medium">{totalRegistrants}</span>
                <span className="text-purple-600">נרשמים</span>
              </div>
            </div>
          )}
        </div>

        {/* Filters */}
        {!loading && orders.length > 0 && (
          <div className="flex gap-3 mb-5 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="relative">
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                  <svg
                    className="w-4 h-4 text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="חיפוש לפי שם או מיקום..."
                  className="w-full border border-gray-200 rounded-xl pr-10 pl-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                />
              </div>
            </div>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="all">כל הסטטוסים</option>
              {uniqueStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-600 flex items-center gap-3">
            <svg
              className="w-5 h-5 flex-shrink-0 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <p>{error}</p>
          </div>
        )}

        {/* Orders list */}
        {loading ? (
          <LoadingSkeleton />
        ) : filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 bg-gray-100 rounded-3xl flex items-center justify-center mb-5">
              <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-600 mb-1">
              {searchQuery || filterStatus !== "all" ? "לא נמצאו הזמנות" : "אין הזמנות במערכת"}
            </h3>
            <p className="text-sm text-gray-400 max-w-xs">
              {searchQuery || filterStatus !== "all" ? "נסה לשנות את מסנני החיפוש" : "כרגע אין הזמנות במערכת"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredOrders.map((order) => (
              <OrderAccordion
                key={order.id}
                order={order}
                onConfirm={handleConfirm}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
