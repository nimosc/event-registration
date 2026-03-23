"use client";

import { useEffect, useState } from "react";

export interface Registrant {
  id: string;
  name: string;
  role: string;
  attendanceStatus: string;
  candidacyStatus?: string;
}

type StatusMode = "candidacy" | "arrival";

interface RegistrantsListProps {
  orderId: string;
  registrants: Registrant[];
  statusMode: StatusMode;
  onConfirm: (subitemId: string, action: "confirm" | "reject") => Promise<void>;
}

function AttendanceBadge({ status }: { status: string }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-600 border border-amber-200">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        ממתין לאישור
      </span>
    );
  }

  const colorMap: Record<string, string> = {
    "מאושר": "bg-emerald-50 text-emerald-700 border-emerald-200",
    "נדחה": "bg-red-50 text-red-600 border-red-200",
  };
  const dotMap: Record<string, string> = {
    "מאושר": "bg-emerald-500",
    "נדחה": "bg-red-500",
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${colorMap[status] || "bg-gray-50 text-gray-600 border-gray-200"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotMap[status] || "bg-gray-400"}`} />
      {status}
    </span>
  );
}

interface RegistrantRowProps {
  registrant: Registrant;
  onAction: (action: "confirm" | "reject") => Promise<void>;
  statusMode: StatusMode;
}

function RegistrantRow({ registrant, onAction, statusMode }: RegistrantRowProps) {
  const [loading, setLoading] = useState<"confirm" | "reject" | null>(null);
  const getCurrentValue = () =>
    statusMode === "candidacy" ? registrant.candidacyStatus ?? "" : registrant.attendanceStatus;
  const [currentStatus, setCurrentStatus] = useState(getCurrentValue);

  // If manager switches tabs, update badge to match the new meaning.
  // (Keep optimistic updates when action is in progress.)
  useEffect(() => {
    if (loading) return;
    setCurrentStatus(getCurrentValue());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusMode, registrant.attendanceStatus, registrant.candidacyStatus]);

  async function handleAction(action: "confirm" | "reject") {
    setLoading(action);
    try {
      await onAction(action);
      setCurrentStatus(action === "confirm" ? "מאושר" : "נדחה");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0 gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
          <span className="text-blue-600 text-xs font-semibold">
            {registrant.name.charAt(0)}
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {registrant.name}
          </p>
          {registrant.role && (
            <p className="text-xs text-gray-500 truncate">{registrant.role}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <AttendanceBadge status={currentStatus} />

        <div className="flex gap-1">
          <button
            onClick={() => handleAction("confirm")}
            disabled={!!loading || currentStatus === "מאושר"}
            title="אשר"
            className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading === "confirm" ? (
              <svg
                className="animate-spin w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
          </button>

          <button
            onClick={() => handleAction("reject")}
            disabled={!!loading || currentStatus === "נדחה"}
            title="דחה"
            className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading === "reject" ? (
              <svg
                className="animate-spin w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RegistrantsList({
  registrants,
  statusMode,
  onConfirm,
}: RegistrantsListProps) {
  if (registrants.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400 text-sm">
        אין נרשמים עדיין
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-50">
      {registrants.map((registrant) => (
        <RegistrantRow
          key={registrant.id}
          registrant={registrant}
          onAction={(action) => onConfirm(registrant.id, action)}
          statusMode={statusMode}
        />
      ))}
    </div>
  );
}
