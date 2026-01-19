"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  CheckCircleIcon,
  ClockIcon,
  EyeIcon,
  ShieldCheckIcon,
  TrashIcon,
  UserCircleIcon,
  UserMinusIcon,
  UserPlusIcon,
  XCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { notification } from "~~/utils/scaffold-eth";

type AuditLogRow = {
  id: number;
  action: string;
  fileHashHex: string | null;
  actorDid: string;
  actorAddr: string;
  targetDid: string | null;
  targetAddr: string | null;
  metadata: any;
  ipAddress: string | null;
  userAgent: string | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  fileHashHex: string;
  filename?: string;
};

export default function AuditLogModal({ isOpen, onClose, fileHashHex, filename }: Props) {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && fileHashHex) {
      fetchLogs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, fileHashHex]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/files/audit-logs?fileHashHex=${fileHashHex}`);
      const json = await res.json();

      if (!json.ok) {
        throw new Error(json.error);
      }

      setLogs(json.logs || []);
    } catch (e: any) {
      console.error(e);
      notification.error("Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case "FILE_UPLOAD":
        return <ArrowUpTrayIcon className="w-5 h-5 text-success" />;
      case "FILE_DOWNLOAD":
      case "FILE_DECRYPT":
        return <ArrowDownTrayIcon className="w-5 h-5 text-info" />;
      case "ACCESS_GRANT":
        return <UserPlusIcon className="w-5 h-5 text-success" />;
      case "ACCESS_REVOKE":
        return <UserMinusIcon className="w-5 h-5 text-warning" />;
      case "ACCESS_VIEW_RECIPIENTS":
        return <EyeIcon className="w-5 h-5 text-info" />;
      case "FILE_DELETE":
        return <TrashIcon className="w-5 h-5 text-error" />;
      case "BLOCKCHAIN_VERIFY":
        return <ShieldCheckIcon className="w-5 h-5 text-success" />;
      case "BLOCKCHAIN_VERIFY_FAILED":
        return <XCircleIcon className="w-5 h-5 text-error" />;
      default:
        return <ClockIcon className="w-5 h-5 text-base-content" />;
    }
  };

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      FILE_UPLOAD: "File Uploaded",
      FILE_DOWNLOAD: "File Downloaded",
      FILE_DECRYPT: "File Decrypted",
      FILE_DELETE: "File Deleted",
      ACCESS_GRANT: "Access Granted",
      ACCESS_REVOKE: "Access Revoked",
      ACCESS_VIEW_RECIPIENTS: "Viewed Recipients",
      BLOCKCHAIN_VERIFY: "Blockchain Verified",
      BLOCKCHAIN_VERIFY_FAILED: "Blockchain Verification Failed",
    };
    return labels[action] || action;
  };

  const formatAddress = (addr: string | null) => {
    if (!addr) return "N/A";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  if (!isOpen) return null;

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-4xl max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="font-bold text-lg flex items-center gap-2">
              <ClockIcon className="w-6 h-6" />
              Audit Log
            </h3>
            {filename && <p className="text-sm opacity-60 mt-1">File: {filename}</p>}
            <p className="text-xs opacity-40 font-mono mt-1">{fileHashHex.slice(0, 20)}...</p>
          </div>
          <button onClick={onClose} className="btn btn-sm btn-circle btn-ghost">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex justify-center items-center py-12">
            <span className="loading loading-spinner loading-lg"></span>
          </div>
        )}

        {/* Empty State */}
        {!loading && logs.length === 0 && (
          <div className="text-center py-12 opacity-60">
            <ClockIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No audit logs found for this file</p>
          </div>
        )}

        {/* Logs Timeline */}
        {!loading && logs.length > 0 && (
          <div className="space-y-3">
            {logs.map(log => (
              <div key={log.id} className={`card bg-base-200 p-4 ${!log.success ? "border-l-4 border-error" : ""}`}>
                {/* Log Header */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    {getActionIcon(log.action)}
                    <div>
                      <p className="font-semibold">{getActionLabel(log.action)}</p>
                      <p className="text-xs opacity-60">{formatDate(log.createdAt)}</p>
                    </div>
                  </div>
                  {log.success ? (
                    <CheckCircleIcon className="w-5 h-5 text-success" />
                  ) : (
                    <XCircleIcon className="w-5 h-5 text-error" />
                  )}
                </div>

                {/* Actor Info */}
                <div className="flex items-center gap-2 text-sm mb-2">
                  <UserCircleIcon className="w-4 h-4 opacity-50" />
                  <span className="opacity-60">Actor:</span>
                  <span className="font-mono text-primary">{formatAddress(log.actorAddr)}</span>
                </div>

                {/* Target Info (for grant/revoke) */}
                {log.targetAddr && (
                  <div className="flex items-center gap-2 text-sm mb-2">
                    <UserCircleIcon className="w-4 h-4 opacity-50" />
                    <span className="opacity-60">Target:</span>
                    <span className="font-mono text-secondary">{formatAddress(log.targetAddr)}</span>
                  </div>
                )}

                {/* Metadata */}
                {log.metadata && Object.keys(log.metadata).length > 0 && (
                  <div className="mt-2 pt-2 border-t border-base-300">
                    <details className="collapse collapse-arrow bg-base-100">
                      <summary className="collapse-title text-xs font-medium">Details</summary>
                      <div className="collapse-content">
                        <pre className="text-xs opacity-70 overflow-x-auto">
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      </div>
                    </details>
                  </div>
                )}

                {/* Error Message */}
                {!log.success && log.errorMessage && (
                  <div className="alert alert-error text-xs mt-2">
                    <XCircleIcon className="w-4 h-4" />
                    <span>{log.errorMessage}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="modal-action">
          <button onClick={onClose} className="btn">
            Close
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose}></div>
    </div>
  );
}
