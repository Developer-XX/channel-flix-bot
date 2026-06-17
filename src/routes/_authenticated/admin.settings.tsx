import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { Settings as SettingsIcon, Save, RefreshCw, Eye, EyeOff, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  listAppSettings,
  updateAppSetting,
  type SettingView,
} from "@/lib/runtime-settings.functions";

export const Route = createFileRoute("/_authenticated/admin/settings")({
  component: AdminSettingsPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-destructive">Error: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6">Not found</div>,
});

function AdminSettingsPage() {
  const list = useServerFn(listAppSettings);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["app-settings"], queryFn: () => list(), retry: false });

  const grouped = (q.data ?? []).reduce<Record<string, SettingView[]>>((acc, s) => {
    (acc[s.group] ||= []).push(s);
    return acc;
  }, {});

  return (
    <div className="p-3 sm:p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <SettingsIcon className="h-5 w-5 text-primary" />
        <div className="min-w-0">
          <h1 className="text-lg sm:text-2xl font-bold">Runtime settings</h1>
          <p className="text-xs text-muted-foreground">
            These override the equivalent environment variables at runtime. Empty values fall back to the deployed env.
          </p>
        </div>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 sm:mr-1.5 ${q.isFetching ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Reload</span>
        </Button>
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.error && (
        <p className="text-sm text-destructive break-words">{(q.error as Error).message}</p>
      )}

      {Object.entries(grouped).map(([group, items]) => (
        <section key={group} className="rounded-lg border border-border p-4 space-y-3">
          <h2 className="font-semibold text-sm">{group}</h2>
          <div className="space-y-3">
            {items.map((s) => (
              <SettingRow
                key={s.key}
                setting={s}
                onSaved={() => {
                  qc.invalidateQueries({ queryKey: ["app-settings"] });
                }}
              />
            ))}
          </div>
        </section>
      ))}

      <div className="pt-2"><Link to="/admin" className="text-sm text-primary">← Back to admin</Link></div>
    </div>
  );
}

function SettingRow({ setting, onSaved }: { setting: SettingView; onSaved: () => void }) {
  const update = useServerFn(updateAppSetting);
  const [value, setValue] = useState<string>(setting.value ?? "");
  const [showSecret, setShowSecret] = useState(false);
  const [secretDraft, setSecretDraft] = useState<string>("");

  // Refresh local state when server data changes (e.g. another tab saved).
  useEffect(() => {
    if (!setting.isSecret) setValue(setting.value ?? "");
  }, [setting.value, setting.isSecret]);

  const save = useMutation({
    mutationFn: async (newValue: string | null) =>
      update({ data: { key: setting.key, value: newValue } }),
    onSuccess: () => {
      toast.success(`${setting.key} updated`);
      setSecretDraft("");
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  return (
    <div className="rounded-md border border-border/60 p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <code className="text-xs font-mono font-semibold">{setting.key}</code>
        {setting.isSecret && <Badge variant="outline" className="text-[10px]">secret</Badge>}
        {setting.hasValue ? (
          <Badge variant="secondary" className="text-[10px]"><Check className="h-3 w-3 mr-1" /> set</Badge>
        ) : setting.hasEnvFallback ? (
          <Badge variant="outline" className="text-[10px]">env fallback</Badge>
        ) : (
          <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="h-3 w-3 mr-1" /> empty</Badge>
        )}
        {setting.updatedAt && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {new Date(setting.updatedAt).toLocaleString()}
          </span>
        )}
      </div>
      {setting.description && (
        <p className="text-xs text-muted-foreground">{setting.description}</p>
      )}

      {setting.isSecret ? (
        <div className="flex gap-2">
          <Input
            type={showSecret ? "text" : "password"}
            placeholder={setting.hasValue ? "•••••••• (set — enter new value to replace)" : setting.placeholder}
            value={secretDraft}
            onChange={(e) => setSecretDraft(e.target.value)}
          />
          <Button size="icon" variant="ghost" onClick={() => setShowSecret((v) => !v)} aria-label="toggle visibility">
            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          <Button
            size="sm"
            disabled={save.isPending || secretDraft.trim() === ""}
            onClick={() => save.mutate(secretDraft.trim())}
          >
            <Save className="h-3.5 w-3.5 mr-1" /> Save
          </Button>
          {setting.hasValue && (
            <Button
              size="sm"
              variant="outline"
              disabled={save.isPending}
              onClick={() => {
                if (confirm(`Clear ${setting.key}? It will fall back to the environment variable if set.`)) {
                  save.mutate(null);
                }
              }}
            >
              Clear
            </Button>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            placeholder={setting.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button
            size="sm"
            disabled={save.isPending || value === (setting.value ?? "")}
            onClick={() => save.mutate(value.trim() === "" ? null : value.trim())}
          >
            <Save className="h-3.5 w-3.5 mr-1" /> Save
          </Button>
        </div>
      )}
    </div>
  );
}
