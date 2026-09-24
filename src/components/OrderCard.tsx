"use client";

import { useState } from "react";
import type { RegistrationRole } from "@/lib/roles";

/** אפשרות הרשמה אחת של המשתמש בהזמנה (אומן או ODT) */
export interface RoleOption {
  role: RegistrationRole;
  label: "ODT" | "אומנים";
  required: number;
  applied: number;
  approved: number;
  isFull: boolean;
  isOpen: boolean;
  spotsRemaining: number;
}

export interface Order {
  id: string;
  name: string;
  date: string;
  location: string;
  activityHours?: string;
  orderLocation: string;
  status: string;
  requiredCount: number;
  odtRequired: number;
  assignedCount: number;
  odtAssigned: number;
  roleCapacityCeiling: number;
  roleApplied: number;
  roleApproved: number;
  roleLabel: "ODT" | "אומנים";
  artistCapacityCeiling: number;
  odtCapacityCeiling: number;
  spotsRemaining: number;
  isRoleOpen: boolean;
  isRoleFull: boolean;
  canRegister: boolean;
  roleOptions: RoleOption[];
  registeredAs?: RegistrationRole;
  isRegistered: boolean;
  subitemId?: string;
  candidacyStatus?: string;
}

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

function formatDateDDMMYYYY(dateStr: string): string {
  if (!dateStr) return "";
  const match = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return dateStr;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

function RequiredInfo({
  roleLabel,
  required,
}: {
  roleLabel: "ODT" | "אומנים";
  required: number;
}) {
  if (required <= 0) return null;
  return (
    <div className="mt-3 text-xs text-gray-600">
      <span className={roleLabel === "ODT" ? "text-violet-700 font-semibold" : "text-blue-700 font-semibold"}>
        {roleLabel}
      </span>
      <span className="text-gray-500">: </span>
      <span className="font-medium text-gray-800">{required} נדרשים</span>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

interface OrderCardProps {
  order: Order;
  userRole: string;
  onRegister: (orderId: string, role?: RegistrationRole) => Promise<void>;
  onUnregister: (orderId: string, subitemId: string) => Promise<void>;
}

export default function OrderCard({ order, userRole, onRegister, onUnregister }: OrderCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAssignmentDone = order.status === "הסתיים השיבוץ";
  const isCandidacyClosed = order.status === "סגירת קבלת מועמדויות";
  const isCancelled = order.status === "בוטל";
  const isApproved = order.candidacyStatus === "מאושר";
  const isPast = order.date ? new Date(order.date) < new Date(new Date().toDateString()) : false;
  const formattedDateForTitle = formatDateDDMMYYYY(order.date);
  const titleParts = [order.location, formattedDateForTitle].filter(Boolean);
  const orderTitle = titleParts.length > 0 ? titleParts.join(" | ") : order.name;

  async function handleClick(role?: RegistrationRole) {
    setLoading(true);
    setError(null);
    try {
      if (order.isRegistered && order.subitemId) {
        await onUnregister(order.id, order.subitemId);
      } else {
        await onRegister(order.id, role);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה לא צפויה");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all duration-200 hover:shadow-md ${
      isCancelled ? "border-red-200 opacity-75" : order.isRegistered ? (isApproved ? "border-green-200" : "border-blue-200") : "border-gray-100"
    }`}>
      {/* Top accent */}
      <div className={`h-1 ${isCancelled ? "bg-red-400" : order.isRegistered ? (isApproved ? "bg-green-500" : "bg-blue-500") : isAssignmentDone || isCandidacyClosed ? "bg-slate-400" : "bg-emerald-400"}`} />

      <div className="p-5">
        {/* Cancelled banner */}
        {isCancelled && (
          <div className="flex items-center justify-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-3">
            <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="text-red-600 font-bold text-sm">האירוע בוטל</span>
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className={`font-semibold text-base leading-snug flex-1 min-w-0 ${isCancelled ? "text-gray-400 line-through" : "text-gray-900"}`}>
            {orderTitle}
          </h3>
          {order.isRegistered && !isCancelled && (
            <span
              className={`flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                order.candidacyStatus === "מאושר"
                  ? "bg-green-100 text-green-700"
                  : order.candidacyStatus === "נדחה"
                    ? "bg-red-100 text-red-600"
                    : "bg-blue-100 text-blue-600"
              }`}
            >
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              {order.candidacyStatus === "מאושר"
                ? "מאושר"
                : order.candidacyStatus === "נדחה"
                  ? "נדחה"
                  : "מועמד"}
            </span>
          )}
        </div>

        {/* Meta */}
        <div className="space-y-1.5 mb-3">
          {order.date && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>{formatDate(order.date)}</span>
            </div>
          )}
          {order.location && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="truncate">{order.location}</span>
            </div>
          )}
          {order.activityHours && (
            <div className="flex items-start gap-2 text-sm text-gray-500">
              <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="min-w-0 leading-snug">{order.activityHours}</span>
            </div>
          )}
        </div>

        {/* שורת דרישה לכל תפקיד שהמשתמש יכול להירשם בו */}
        {(order.roleOptions?.length ? order.roleOptions : [{ label: order.roleLabel, required: order.roleCapacityCeiling }]).map((opt) => (
          <RequiredInfo key={opt.label} roleLabel={opt.label} required={opt.required} />
        ))}

        {/* Error */}
        {error && (
          <div className="mt-3 px-3 py-2 bg-red-50 border border-red-100 rounded-xl text-xs text-red-600">
            {error}
          </div>
        )}

        {/* Action */}
        <div className="mt-4">
          {isCancelled ? (
            <div className="w-full py-2.5 px-4 rounded-xl text-sm font-medium bg-red-50 text-red-400 text-center border border-red-100">
              לא ניתן להירשם — האירוע בוטל
            </div>
          ) : isPast ? (
            <div className="w-full py-2.5 px-4 rounded-xl text-sm font-medium bg-gray-100 text-gray-400 text-center">
              המועד עבר
            </div>
          ) : isAssignmentDone ? (
            <div className="w-full py-2.5 px-4 rounded-xl text-sm font-medium bg-slate-100 text-slate-500 text-center">
              הסתיים השיבוץ - לא ניתן להירשם
            </div>
          ) : isCandidacyClosed ? (
            <div className="w-full py-2.5 px-4 rounded-xl text-sm font-medium bg-gray-100 text-gray-400 text-center">
              נסגרה קבלת מועמדויות
            </div>
          ) : order.isRegistered ? (
            <>
            {order.registeredAs && (order.roleOptions?.length ?? 0) > 1 && (
              <div className="mb-2 text-xs text-gray-600 text-center">
                נרשמת כ<span className={order.registeredAs === "ODT" ? "text-violet-700 font-semibold" : "text-blue-700 font-semibold"}>{order.registeredAs === "ODT" ? "-ODT" : "אומן"}</span>
              </div>
            )}
            <button
              onClick={() => handleClick()}
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl text-sm font-medium border border-red-200 text-red-500 hover:bg-red-50 hover:border-red-300 active:bg-red-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? <><Spinner />מבטל...</> : <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                בטל מועמדות
              </>}
            </button>
            </>
          ) : !order.canRegister ? (
            <div className="w-full py-2.5 px-4 rounded-xl text-sm font-medium bg-gray-100 text-gray-400 text-center">
              לא ניתן להירשם
            </div>
          ) : (order.roleOptions?.length ?? 0) > 1 ? (
            // אומן+ODT בהזמנה שצריכה את שניהם — בוחר באיזה תפקיד להגיש
            <div className="grid grid-cols-2 gap-2">
              {order.roleOptions.map((opt) => (
                <button
                  key={opt.role}
                  onClick={() => handleClick(opt.role)}
                  disabled={loading || !opt.isOpen}
                  title={!opt.isOpen ? "אין מקומות פתוחים לתפקיד זה" : undefined}
                  className={`py-2.5 px-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 shadow-sm ${
                    opt.role === "ODT"
                      ? "bg-violet-500 hover:bg-violet-600 active:bg-violet-700 shadow-violet-200"
                      : "bg-blue-500 hover:bg-blue-600 active:bg-blue-700 shadow-blue-200"
                  }`}
                >
                  {loading ? <Spinner /> : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  )}
                  {opt.role === "ODT" ? "הגש כ-ODT" : "הגש כאומן"}
                </button>
              ))}
            </div>
          ) : (
            <button
              onClick={() => handleClick()}
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm shadow-blue-200"
            >
              {loading ? <><Spinner />שולח...</> : <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                הגש מועמדות
              </>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
