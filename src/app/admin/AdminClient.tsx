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
  activityHours?: string;
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
    candidacyStatus?: string;
  }[];
}

interface AdminClientProps {
  user: SessionUser;
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    "בתהליך שיבוץ": "bg-blue-100 text-blue-700 border-blue-200",
    "סגירת קבלת מועמדויות": "bg-orange-100 text-orange-700 border-orange-200",
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

type AssignableArtist = { id: string; name: string };

function AssignArtistControls({
  orderId,
  onRefresh,
}: {
  orderId: string;
  onRefresh: () => Promise<void>;
}) {
  const [artists, setArtists] = useState<AssignableArtist[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [selectedArtistId, setSelectedArtistId] = useState<string>("");
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!modalOpen) return;

    let cancelled = false;
    async function load() {
      setOptionsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/assignable-artists?orderId=${encodeURIComponent(orderId)}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "שגיאה בטעינת האומנים");
          return;
        }
        const list: AssignableArtist[] = Array.isArray(data.artists)
          ? data.artists.map((a: any) => ({ id: String(a.id), name: String(a.name) }))
          : [];
        if (cancelled) return;
        setArtists(list);
        setSelectedArtistId((prev) =>
          prev && list.some((a) => a.id === prev) ? prev : list[0]?.id ?? ""
        );
      } catch {
        if (!cancelled) setError("שגיאת רשת בטעינת האומנים");
      } finally {
        if (!cancelled) setOptionsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [modalOpen, orderId]);

  async function handleAssign() {
    if (!selectedArtistId) return;
    setAssigning(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, artistId: selectedArtistId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "שגיאה בשיבוץ");
        return;
      }
      await onRefresh();
      setModalOpen(false);
    } catch {
      setError("שגיאת רשת בשיבוץ");
    } finally {
      setAssigning(false);
    }
  }

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h4 className="text-sm font-semibold text-gray-700">שיבוץ אומן</h4>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setModalOpen(true);
          }}
          disabled={assigning}
          className="btn-primary whitespace-nowrap"
        >
          שיבוץ
        </button>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 border border-gray-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h4 className="text-lg font-semibold text-gray-900">שיבוץ אומן</h4>
                <p className="text-sm text-gray-500 mt-1">בחר אומן פעיל לשיבוץ להזמנה</p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                aria-label="סגור"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

            {optionsLoading ? (
              <div>
                <div className="h-11 bg-gray-100 rounded-xl animate-pulse border border-gray-50" />
                <div className="h-11 bg-gray-100 rounded-xl animate-pulse border border-gray-50 mt-3" />
              </div>
            ) : artists.length === 0 ? (
              <p className="text-sm text-gray-500">אין אומנים פעילים זמינים לשיבוץ להזמנה הזו.</p>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">אומן פעיל</label>
                <select
                  value={selectedArtistId}
                  onChange={(e) => setSelectedArtistId(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {artists.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex gap-2 justify-end mt-5">
              <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">
                ביטול
              </button>
              <button
                type="button"
                onClick={handleAssign}
                disabled={!selectedArtistId || assigning || optionsLoading || artists.length === 0}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {assigning ? "שיבוץ..." : "שיבוץ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OrderAccordion({
  order,
  onConfirm,
  statusMode,
  onRefresh,
}: {
  order: AdminOrder;
  statusMode: "candidacy" | "arrival";
  onRefresh: () => Promise<void>;
  onConfirm: (
    orderId: string,
    subitemId: string,
    action: "confirm" | "reject",
    mode: "candidacy" | "arrival"
  ) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);

  const registrants: Registrant[] = order.subitems.map((sub) => ({
    id: sub.id,
    name: sub.name,
    role: sub.role,
    attendanceStatus: sub.attendanceStatus,
    candidacyStatus: sub.candidacyStatus,
  }));

  const filledPercent =
    order.requiredCount > 0
      ? Math.min(100, (order.assignedCount / order.requiredCount) * 100)
      : 0;

  const confirmedCount =
    statusMode === "arrival"
      ? order.subitems.filter((s) => s.attendanceStatus === "מאושר").length
      : order.subitems.filter((s) => (s.candidacyStatus ?? "") === "מאושר").length;

  const pendingCount =
    statusMode === "arrival"
      ? order.subitems.filter((s) => s.attendanceStatus !== "מאושר" && s.attendanceStatus !== "נדחה").length
      : order.subitems.filter(
          (s) => (s.candidacyStatus ?? "") !== "מאושר" && (s.candidacyStatus ?? "") !== "נדחה"
        ).length;

  return (
    <div className={`bg-white rounded-xl overflow-hidden transition-colors ${
      pendingCount > 0
        ? "border border-orange-200 hover:border-orange-300"
        : "border border-gray-200 hover:border-gray-300"
    }`}>
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
              {pendingCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 border border-orange-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                  {pendingCount} ממתינים לאישור
                </span>
              )}
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
              {order.activityHours && (
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
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {order.activityHours}
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
              {order.subitems.length} מועמדים
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
          {statusMode === "candidacy" && (
            <AssignArtistControls
              orderId={order.id}
              onRefresh={onRefresh}
            />
          )}
          <RegistrantsList
            orderId={order.id}
            registrants={registrants}
            statusMode={statusMode}
            onConfirm={(subitemId, action) => onConfirm(order.id, subitemId, action, statusMode)}
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

type FilterMode = "relevant" | "needs_confirmation" | "all";
type TimeFilterMode = "future" | "past" | "all";

function parseDateOnly(dateStr: string): Date | null {
  if (!dateStr) return null;
  const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(`${match[1]}-${match[2]}-${match[3]}`);
}

function isUpcoming(dateStr: string, days = 14): boolean {
  const eventDate = parseDateOnly(dateStr);
  if (!eventDate) return false;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + days);
  return eventDate >= now && eventDate <= cutoff;
}

function matchesTimeFilter(dateStr: string, mode: TimeFilterMode): boolean {
  if (mode === "all") return true;
  const eventDate = parseDateOnly(dateStr);
  if (!eventDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return mode === "past" ? eventDate < today : eventDate >= today;
}

function hasPendingConfirmation(
  order: AdminOrder,
  mode: "candidacy" | "arrival"
): boolean {
  return order.subitems.some((s) => {
    const cur = mode === "arrival" ? s.attendanceStatus : s.candidacyStatus ?? "";
    return cur !== "מאושר" && cur !== "נדחה";
  });
}

export default function AdminClient({ user }: AdminClientProps) {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>("relevant");
  const [timeFilterMode, setTimeFilterMode] = useState<TimeFilterMode>("future");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusMode, setStatusMode] = useState<"candidacy" | "arrival">("candidacy");

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
    orderId: string,
    subitemId: string,
    action: "confirm" | "reject",
    mode: "candidacy" | "arrival"
  ) {
    const res = await fetch("/api/admin/confirm", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, subitemId, action, mode }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "שגיאה בעדכון הסטטוס");
    }

    // Update local state — subitem status + order status if threshold reached
    setOrders((prev) =>
      prev.map((order) => {
        if (order.id !== orderId) return order;
        const updatedSubitems = order.subitems.map((sub) =>
          sub.id === subitemId
            ? {
                ...sub,
                attendanceStatus:
                  mode === "arrival" ? (action === "confirm" ? "מאושר" : "נדחה") : sub.attendanceStatus,
                candidacyStatus:
                  mode === "candidacy" ? (action === "confirm" ? "מאושר" : "נדחה") : sub.candidacyStatus,
              }
            : sub
        );
        const confirmedCount =
          mode === "arrival"
            ? updatedSubitems.filter((s) => s.attendanceStatus === "מאושר").length
            : updatedSubitems.filter((s) => (s.candidacyStatus ?? "") === "מאושר").length;
        let newStatus = order.status;
        // Order status changes only after "אישור מועמדות".
        if (
          mode === "candidacy" &&
          action === "confirm" &&
          order.requiredCount > 0 &&
          confirmedCount >= order.requiredCount
        ) {
          newStatus = "הסתיים השיבוץ";
        } else if (mode === "candidacy" && action === "reject" && order.status === "הסתיים השיבוץ") {
          newStatus = "סגירת קבלת מועמדויות";
        }
        return { ...order, subitems: updatedSubitems, status: newStatus };
      })
    );
  }

  // Filter and search
  const filteredOrders = orders.filter((order) => {
    if (!matchesTimeFilter(order.date, timeFilterMode)) return false;

    const matchesSearch =
      !searchQuery ||
      order.name.includes(searchQuery) ||
      order.location.includes(searchQuery) ||
      (order.activityHours ?? "").includes(searchQuery);
    if (!matchesSearch) return false;

    if (filterMode === "relevant") {
      return hasPendingConfirmation(order, statusMode) || isUpcoming(order.date);
    }
    if (filterMode === "needs_confirmation") {
      return hasPendingConfirmation(order, statusMode);
    }
    return true; // "all"
  });

  const pendingCount = orders.filter((o) => hasPendingConfirmation(o, statusMode)).length;
  const upcomingCount = orders.filter(o => isUpcoming(o.date)).length;
  const relevantCount = orders.filter(
    (o) => hasPendingConfirmation(o, statusMode) || isUpcoming(o.date)
  ).length;
  const totalRegistrants = orders.reduce((sum, o) => sum + o.subitems.length, 0);

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
                ניהול כל ההזמנות ואישור מועמדים
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
              {pendingCount > 0 && (
                <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-xl px-4 py-2 text-sm">
                  <span className="w-2 h-2 rounded-full bg-orange-500" />
                  <span className="text-orange-700 font-medium">{pendingCount}</span>
                  <span className="text-orange-600">ממתינות לאישור</span>
                </div>
              )}
              {upcomingCount > 0 && (
                <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2 text-sm">
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-blue-700 font-medium">{upcomingCount}</span>
                  <span className="text-blue-600">בימים הקרובים</span>
                </div>
              )}
              <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-xl px-4 py-2 text-sm">
                <span className="w-2 h-2 rounded-full bg-purple-400" />
                <span className="text-purple-700 font-medium">{totalRegistrants}</span>
                <span className="text-purple-600">מועמדים</span>
              </div>
            </div>
          )}
        </div>

        {/* Confirm Tabs */}
        {!loading && orders.length > 0 && (
          <div className="mb-5 flex gap-2 flex-wrap">
            <button
              onClick={() => setStatusMode("candidacy")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                statusMode === "candidacy"
                  ? "bg-gray-900 text-white border-gray-900 shadow-sm"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
              }`}
            >
              אישור מועמדות
            </button>
            <button
              onClick={() => setStatusMode("arrival")}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                statusMode === "arrival"
                  ? "bg-gray-900 text-white border-gray-900 shadow-sm"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
              }`}
            >
              אישור הגעה
            </button>
          </div>
        )}

        {/* Filters */}
        {!loading && orders.length > 0 && (
          <div className="flex flex-col gap-3 mb-5">
            {/* Time filter */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setTimeFilterMode("future")}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                  timeFilterMode === "future"
                    ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                }`}
              >
                עתידי
              </button>
              <button
                onClick={() => setTimeFilterMode("past")}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                  timeFilterMode === "past"
                    ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                }`}
              >
                עבר
              </button>
              <button
                onClick={() => setTimeFilterMode("all")}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                  timeFilterMode === "all"
                    ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                }`}
              >
                הכל
              </button>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setFilterMode("relevant")}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                  filterMode === "relevant"
                    ? "bg-gray-900 text-white border-gray-900 shadow-sm"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                }`}
              >
                רלוונטי עכשיו
                {relevantCount > 0 && (
                  <span className={`mr-2 text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                    filterMode === "relevant" ? "bg-white/20 text-white" : "bg-orange-100 text-orange-600"
                  }`}>{relevantCount}</span>
                )}
              </button>
              <button
                onClick={() => setFilterMode("needs_confirmation")}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                  filterMode === "needs_confirmation"
                    ? "bg-orange-500 text-white border-orange-500 shadow-sm"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                }`}
              >
                ממתינות לאישור
                {pendingCount > 0 && (
                  <span className={`mr-2 text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                    filterMode === "needs_confirmation" ? "bg-white/20 text-white" : "bg-orange-100 text-orange-600"
                  }`}>{pendingCount}</span>
                )}
              </button>
              <button
                onClick={() => setFilterMode("all")}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
                  filterMode === "all"
                    ? "bg-gray-900 text-white border-gray-900 shadow-sm"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                }`}
              >
                כל ההזמנות
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
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
              {filterMode === "relevant"
                ? timeFilterMode === "future"
                  ? "אין הזמנות עתידיות דחופות כרגע"
                  : "אין הזמנות עבר דחופות כרגע"
                : filterMode === "needs_confirmation"
                  ? "אין הזמנות הממתינות לאישור"
                  : searchQuery
                    ? "לא נמצאו הזמנות"
                    : timeFilterMode === "future"
                      ? "אין הזמנות עתידיות במערכת"
                      : "אין הזמנות עבר במערכת"}
            </h3>
            <p className="text-sm text-gray-400 max-w-xs">
              {filterMode === "relevant"
                ? timeFilterMode === "future"
                  ? "כל ההזמנות העתידיות המטופלות מוצגות"
                  : "לא נמצאו הזמנות עבר שעונות למסנן"
                : filterMode === "needs_confirmation"
                  ? "כל המועמדויות אושרו או נדחו"
                  : searchQuery
                    ? "נסה לשנות את מסנן החיפוש"
                    : timeFilterMode === "future"
                      ? "כרגע אין הזמנות מהיום והלאה"
                      : "כרגע אין הזמנות שחלף זמנן"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredOrders.map((order) => (
              <OrderAccordion
                key={order.id}
                order={order}
                onConfirm={handleConfirm}
                statusMode={statusMode}
                onRefresh={fetchOrders}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
