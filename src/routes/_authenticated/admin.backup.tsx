import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  exportAllData,
  importAllData,
  checkBackupHealth,
  runBackupSelfTest,
  backupCompletenessReport,
} from "@/lib/admin-backup.functions";
import { Download, Upload, AlertTriangle, Database, ShieldCheck, Loader2, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/backup")({
  component: BackupPage,
});

type HealthState =
  | { status: "checking" }
  | { status: "ok"; schema_version: number; tables: number; checked_at: string }
  | { status: "error"; code: "404" | "5xx" | "auth" | "other"; message: string };

function BackupPage() {
  const doExport = useServerFn(exportAllData);
  const doImport = useServerFn(importAllData);
  const doHealth = useServerFn(checkBackupHealth);
  const doSelfTest = useServerFn(runBackupSelfTest);
  const doCompleteness = useServerFn(backupCompletenessReport);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [lastArchive, setLastArchive] = useState<any>(null);
  const [importResult, setImportResult] = useState<{ dryRun?: boolean; inserted?: Record<string, number>; failed?: Record<string, string>; report?: Record<string, any>; summary?: any; integrity?: any } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"upsert" | "replace">("upsert");
  const [confirm, setConfirm] = useState("");
  const [health, setHealth] = useState<HealthState>({ status: "checking" });
  const [selfTesting, setSelfTesting] = useState(false);
  const [selfTestResult, setSelfTestResult] = useState<any>(null);
  const [completenessRunning, setCompletenessRunning] = useState(false);
  const [completeness, setCompleteness] = useState<any>(null);

  async function runHealthCheck() {
    setHealth({ status: "checking" });
    try {
      const res: any = await doHealth();
      if (res?.ok) {
        setHealth({ status: "ok", schema_version: res.schema_version, tables: res.tables, checked_at: res.checked_at });
      } else {
        setHealth({ status: "error", code: "other", message: res?.probe_error ?? "Health probe failed" });
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "Unknown error");
      let code: "404" | "5xx" | "auth" | "other" = "other";
      if (/404|not\s*found/i.test(msg)) code = "404";
      else if (/5\d\d|server\s*error|internal/i.test(msg)) code = "5xx";
      else if (/unauthor|forbidden|admin role/i.test(msg)) code = "auth";
      setHealth({ status: "error", code, message: msg });
    }
  }

  useEffect(() => { runHealthCheck(); }, []);


  async function handleExport() {
    setExporting(true);
    try {
      const res = await doExport({ data: {} });
      setCounts(res.archive.counts);
      setLastArchive(res.archive);
      const blob = new Blob([JSON.stringify(res.archive, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `app-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded");
      // Auto-run completeness report right after export.
      runCompleteness(res.archive);
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function runCompleteness(archive: any) {
    setCompletenessRunning(true);
    setCompleteness(null);
    try {
      const res: any = await doCompleteness({ data: { archive } });
      setCompleteness(res);
      if (res?.summary?.overall_status === "ok") toast.success("Completeness check passed");
      else toast.warning(`Completeness check: drift in ${res?.summary?.tables_drift} table(s)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Completeness check failed");
    } finally {
      setCompletenessRunning(false);
    }
  }

  async function handleCompletenessFromFile() {
    if (!file) { toast.error("Pick a backup file first"); return; }
    try {
      const text = await file.text();
      const archive = JSON.parse(text);
      await runCompleteness(archive);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not parse file");
    }
  }

  async function handleImport(dryRun: boolean) {
    if (!file) { toast.error("Pick a backup file first"); return; }
    if (!dryRun && confirm !== "RESTORE") { toast.error("Type RESTORE to confirm"); return; }
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const archive = JSON.parse(text);
      const res: any = await doImport({ data: { archive, mode, dryRun, confirm: dryRun ? "DRYRUN" : "RESTORE" } });
      setImportResult({ dryRun: res.dryRun, inserted: res.inserted, failed: res.failed, report: res.report, summary: res.summary, integrity: res.integrity });
      const failedCount = Object.keys(res.failed ?? {}).length;
      if (dryRun) toast.success("Dry-run complete");
      else if (failedCount === 0) {
        const idx = res.postRestore?.indexes;
        toast.success(
          idx
            ? `Restore complete · indexes rebuilt (latest ${idx.latest}, trending ${idx.trending}, search ${idx.search})`
            : "Restore complete",
        );
      } else toast.warning(`Restored with ${failedCount} table error(s)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function handleSelfTest() {
    setSelfTesting(true);
    setSelfTestResult(null);
    try {
      const res: any = await doSelfTest();
      setSelfTestResult(res);
      if (res?.ok) toast.success("Self-test passed");
      else toast.warning(`Self-test found ${Object.keys(res?.mismatches ?? {}).length} mismatch(es)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Self-test failed");
    } finally {
      setSelfTesting(false);
    }
  }

  // ---- Health-gated render ---------------------------------------------
  if (health.status === "checking") {
    return (
      <div className="p-6 max-w-4xl mx-auto flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> Checking Backup &amp; Restore endpoint…
      </div>
    );
  }
  if (health.status === "error") {
    const tips =
      health.code === "404"
        ? [
            "The /admin/backup server route did not respond. Reload the page — your browser may be holding a stale build.",
            "If the problem persists, redeploy: route registration runs at build time.",
            "Confirm src/routes/_authenticated/admin.backup.tsx exists in the deployed bundle.",
          ]
        : health.code === "5xx"
        ? [
            "The server function crashed. Check the server logs for `checkBackupHealth` errors.",
            "Common causes: missing SUPABASE_SERVICE_ROLE_KEY, database paused, or a recent migration that hasn't run yet.",
            "Retry after 30 seconds — transient cold-start failures usually self-heal.",
          ]
        : health.code === "auth"
        ? [
            "Your account does not have the admin role. Sign in as an admin user.",
            "If you ARE an admin, your session may have expired — sign out and back in.",
          ]
        : [
            "Unexpected error from the backup endpoint. Check the message below.",
            "Verify Lovable Cloud is connected and the database is reachable.",
          ];
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <Card className="p-5 border-destructive/40 space-y-3">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="font-semibold">Backup &amp; Restore is unavailable</h2>
          </div>
          <div className="text-xs font-mono rounded bg-muted p-2 break-all">{health.message}</div>
          <div>
            <div className="text-sm font-semibold mb-1">Troubleshooting</div>
            <ul className="text-sm list-disc pl-5 space-y-1 text-muted-foreground">
              {tips.map((t) => <li key={t}>{t}</li>)}
            </ul>
          </div>
          <Button size="sm" variant="outline" onClick={runHealthCheck}>
            <RefreshCw className="h-4 w-4 mr-1" /> Retry health check
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Database className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Backup &amp; Restore</h1>
          <p className="text-sm text-muted-foreground">
            Download a JSON snapshot of every data table or restore from one.
            Use this before migrating to a VPS or after data loss.
          </p>
        </div>
      </div>

      <Card className="p-3 flex flex-wrap items-center gap-3 text-xs bg-emerald-500/5 border-emerald-500/30">
        <ShieldCheck className="h-4 w-4 text-emerald-500" />
        <span>Endpoint healthy · schema v{health.schema_version} · {health.tables} tables</span>
        <span className="text-muted-foreground">checked {new Date(health.checked_at).toLocaleTimeString()}</span>
        <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={runHealthCheck}>
          <RefreshCw className="h-3 w-3 mr-1" /> Recheck
        </Button>
        <Button size="sm" variant="outline" className="h-7" onClick={handleSelfTest} disabled={selfTesting}>
          {selfTesting ? "Running…" : "Run self-test"}
        </Button>
      </Card>

      {selfTestResult && (
        <Card className="p-3 text-xs space-y-1">
          <div className="font-semibold">
            Self-test {selfTestResult.ok ? "passed ✓" : "found mismatches"}
          </div>
          <div className="text-muted-foreground">
            tables checked: {selfTestResult.tables_checked} · total rows sampled: {selfTestResult.total_rows?.toLocaleString?.()}
          </div>
          {!selfTestResult.ok && (
            <div className="font-mono text-amber-500">
              {Object.entries(selfTestResult.mismatches ?? {}).map(([t, m]: [string, any]) => (
                <div key={t}>{t}: archive={m.archive} · live={m.live}</div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-sm">Backup completeness report</h2>
            <p className="text-xs text-muted-foreground">
              Compares per-table row counts and verifies Telegram file metadata
              (telegram_ingest / media_files / file_unique_id) between an
              archive and the live database.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" variant="outline" disabled={completenessRunning || !lastArchive} onClick={() => lastArchive && runCompleteness(lastArchive)}>
              {completenessRunning ? "Checking…" : "Recheck last export"}
            </Button>
            <Button size="sm" variant="outline" disabled={completenessRunning || !file} onClick={handleCompletenessFromFile}>
              Check uploaded file
            </Button>
          </div>
        </div>

        {completeness && (
          <div className="text-xs space-y-2 pt-2 border-t border-border">
            <div className={`rounded-md p-2 border ${completeness.summary?.overall_status === "ok" ? "bg-emerald-500/5 border-emerald-500/30" : "bg-amber-500/10 border-amber-500/30"}`}>
              <div className="font-semibold">
                Overall: {completeness.summary?.overall_status === "ok" ? "complete ✓" : "drift detected"}
              </div>
              <div>
                {completeness.summary?.tables_ok}/{completeness.summary?.tables_checked} tables ok ·
                {" "}{completeness.summary?.tables_drift} drift ·
                {" "}{completeness.summary?.tables_skipped} skipped
              </div>
              <div>
                Total rows — archive: {completeness.summary?.total_archive_rows?.toLocaleString?.()} ·
                {" "}live: {completeness.summary?.total_live_rows?.toLocaleString?.()}
              </div>
            </div>

            <div className={`rounded-md p-2 border ${completeness.file_metadata_check?.status === "ok" ? "bg-emerald-500/5 border-emerald-500/30" : "bg-destructive/10 border-destructive/30"}`}>
              <div className="font-semibold">Telegram file metadata</div>
              <div>
                ingest file_unique_id: {completeness.file_metadata_check?.ingest_with_file_unique_id?.toLocaleString?.()} ·
                {" "}media file_unique_id: {completeness.file_metadata_check?.media_with_file_unique_id?.toLocaleString?.()}
              </div>
              {completeness.file_metadata_check?.ingest_orphans_without_media > 0 && (
                <div className="text-destructive">
                  Orphans (ingest with no matching media row): {completeness.file_metadata_check.ingest_orphans_without_media}
                  {completeness.file_metadata_check.sample_orphans?.length > 0 && (
                    <span className="font-mono"> · sample: {completeness.file_metadata_check.sample_orphans.join(", ")}</span>
                  )}
                </div>
              )}
            </div>

            <details>
              <summary className="cursor-pointer font-semibold">Per-table breakdown</summary>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1 mt-2">
                {completeness.tables?.map((r: any) => (
                  <div key={r.table} className={`rounded border p-2 font-mono ${r.status === "ok" ? "border-border" : r.status === "skipped" ? "border-muted bg-muted/30" : "border-amber-500/40 bg-amber-500/5"}`}>
                    <div className="font-semibold">{r.table} <span className="text-muted-foreground">[{r.key_columns?.join(", ")}]</span></div>
                    <div>archive: {r.archive_rows} · live: {r.live_rows} · Δ {r.delta}</div>
                    {(r.keys_missing_in_live > 0 || r.keys_missing_in_archive > 0) && (
                      <div className="text-amber-500">
                        missing in live: {r.keys_missing_in_live} · missing in archive: {r.keys_missing_in_archive}
                      </div>
                    )}
                    {r.sample_missing_in_live?.length > 0 && (
                      <div className="text-muted-foreground truncate">sample missing live: {r.sample_missing_in_live.join(", ")}</div>
                    )}
                    {r.note && <div className="text-destructive">{r.note}</div>}
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </Card>





      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Download className="h-5 w-5" />
          <h2 className="font-semibold">Export all data</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Includes titles, episodes, files, ingest rows, channels, settings,
          ads, announcements, slides, premium plans/payments, profiles, roles,
          support tickets, etc. Sign-in credentials (Supabase Auth) are NOT
          exportable through this API — users will need to sign in again on a
          fresh installation; their roles are restored from this file.
        </p>
        <Button onClick={handleExport} disabled={exporting}>
          {exporting ? "Exporting…" : "Download backup (.json)"}
        </Button>
        {counts && (
          <div className="text-xs grid grid-cols-2 md:grid-cols-3 gap-1 pt-2 border-t border-border">
            {Object.entries(counts).map(([t, n]) => (
              <div key={t} className="flex justify-between font-mono">
                <span className="text-muted-foreground">{t}</span>
                <span>{n.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5 space-y-4 border-destructive/40">
        <div className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          <h2 className="font-semibold">Restore from backup</h2>
        </div>
        <div className="flex items-start gap-2 text-sm rounded-md bg-destructive/10 border border-destructive/30 p-3 text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            Destructive. <strong>Upsert</strong> merges incoming rows by id;
            existing rows with matching ids are overwritten. <strong>Replace</strong>
            wipes each table before inserting. Make a fresh export first.
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label htmlFor="backup-file">Backup file (.json)</Label>
            <Input
              id="backup-file"
              type="file"
              accept="application/json,.json"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="flex gap-3 items-center text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === "upsert"} onChange={() => setMode("upsert")} />
              Upsert (merge by id)
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} />
              Replace (wipe each table first)
            </label>
          </div>

          <div>
            <Label htmlFor="confirm">Type <code>RESTORE</code> to confirm</Label>
            <Input
              id="confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="RESTORE"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => handleImport(true)}
              disabled={importing || !file}
            >
              {importing ? "Checking…" : "Dry-run (validate only)"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleImport(false)}
              disabled={importing || !file || confirm !== "RESTORE"}
            >
              {importing ? "Restoring…" : "Restore from backup"}
            </Button>
          </div>
        </div>

        {importResult && (
          <div className="text-xs space-y-2 pt-3 border-t border-border">
            {importResult.integrity && (
              <div className={`rounded-md p-2 space-y-1 border ${importResult.integrity.compatible ? "bg-emerald-500/5 border-emerald-500/30" : "bg-destructive/10 border-destructive/30"}`}>
                <div className="font-semibold">
                  Integrity: {importResult.integrity.compatible ? "compatible ✓" : "INCOMPATIBLE — restore blocked"}
                </div>
                <div>Archive schema v{importResult.integrity.archive_schema_version} vs live v{importResult.integrity.live_schema_version}</div>
                <div>Tables — archive: {importResult.integrity.archive_tables} · live: {importResult.integrity.live_tables}</div>
                {importResult.integrity.unknown_tables?.length > 0 && (
                  <div className="text-destructive">Unknown tables in archive: {importResult.integrity.unknown_tables.join(", ")}</div>
                )}
                {importResult.integrity.missing_tables?.length > 0 && (
                  <div className="text-amber-500">Tables absent from archive (will be left untouched): {importResult.integrity.missing_tables.join(", ")}</div>
                )}
              </div>
            )}

            {importResult.dryRun && importResult.summary && (
              <div className="rounded-md bg-muted p-2 space-y-1">
                <div className="font-semibold">Dry-run summary</div>
                <div>Tables analyzed: {importResult.summary.tablesAnalyzed}</div>
                <div>Total incoming rows: {importResult.summary.totalIncoming?.toLocaleString?.()}</div>
                <div>Existing rows that would be overwritten: {importResult.summary.totalConflicts?.toLocaleString?.()}</div>
                {importResult.summary.tablesWithSchemaDrift?.length > 0 && (
                  <div className="text-amber-500">Schema drift: {importResult.summary.tablesWithSchemaDrift.join(", ")}</div>
                )}
                {importResult.summary.tablesMissing?.length > 0 && (
                  <div className="text-destructive">Missing tables: {importResult.summary.tablesMissing.join(", ")}</div>
                )}
              </div>
            )}
            {importResult.report && (
              <details>
                <summary className="cursor-pointer font-semibold">Per-table report</summary>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1 mt-2">
                  {Object.entries(importResult.report).map(([t, r]: [string, any]) => (
                    <div key={t} className="rounded border border-border p-2 font-mono">
                      <div className="font-semibold">{t}</div>
                      <div>incoming: {r.incoming} · existing: {r.existing ?? "—"}</div>
                      <div>conflicts: {r.idsMatchingExisting} · new: {r.newIds}</div>
                      {r.unknownColumns?.length > 0 && <div className="text-amber-500">extra cols: {r.unknownColumns.join(", ")}</div>}
                      {r.missingRequiredColumns?.length > 0 && <div className="text-destructive">missing req cols: {r.missingRequiredColumns.join(", ")}</div>}
                      {r.error && <div className="text-destructive">{r.error}</div>}
                    </div>
                  ))}
                </div>
              </details>
            )}
            {importResult.inserted && (
              <div>
                <div className="font-semibold mb-1">Inserted</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                  {Object.entries(importResult.inserted).map(([t, n]) => (
                    <div key={t} className="flex justify-between font-mono">
                      <span className="text-muted-foreground">{t}</span>
                      <span>{(n as number).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {importResult.failed && Object.keys(importResult.failed).length > 0 && (
              <div className="text-destructive">
                <div className="font-semibold mb-1">Failed</div>
                {Object.entries(importResult.failed).map(([t, msg]) => (
                  <div key={t} className="font-mono">
                    <span>{t}:</span> {msg as string}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
