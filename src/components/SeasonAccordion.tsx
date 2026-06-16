import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DownloadButton } from "@/components/DownloadButton";

interface Props {
  titleId: string;
}

type FileRow = {
  id: string;
  file_name: string;
  quality: string | null;
  resolution: string | null;
  language: string | null;
  file_size: number | null;
  episode_id: string | null;
  episodes:
    | {
        episode_number: number | null;
        name: string | null;
        seasons: { season_number: number | null; name: string | null } | null;
      }
    | null;
};

export function SeasonAccordion({ titleId }: Props) {
  const q = useQuery({
    queryKey: ["title-files-grouped", titleId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("media_files")
        .select(
          "id, file_name, quality, resolution, language, file_size, episode_id, episodes(episode_number, name, seasons(season_number, name))",
        )
        .eq("title_id", titleId)
        .eq("is_active", true);
      if (error) throw error;
      return (data ?? []) as unknown as FileRow[];
    },
  });

  const grouped = useMemo(() => {
    const map = new Map<
      number | "other",
      { seasonNumber: number | "other"; seasonName: string | null; episodes: Map<number | "other", FileRow[]> }
    >();
    for (const f of q.data ?? []) {
      const sNum = f.episodes?.seasons?.season_number ?? "other";
      const sName = f.episodes?.seasons?.name ?? null;
      const eNum = f.episodes?.episode_number ?? "other";
      if (!map.has(sNum)) map.set(sNum, { seasonNumber: sNum, seasonName: sName, episodes: new Map() });
      const season = map.get(sNum)!;
      if (!season.episodes.has(eNum)) season.episodes.set(eNum, []);
      season.episodes.get(eNum)!.push(f);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.seasonNumber === "other") return 1;
      if (b.seasonNumber === "other") return -1;
      return (a.seasonNumber as number) - (b.seasonNumber as number);
    });
  }, [q.data]);

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!q.data?.length)
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <p className="text-muted-foreground">No episodes indexed yet.</p>
      </div>
    );

  return (
    <div className="space-y-3">
      {grouped.map((s) => (
        <SeasonBlock key={String(s.seasonNumber)} season={s} titleId={titleId} />
      ))}
    </div>
  );
}

function SeasonBlock({
  season,
  titleId,
}: {
  season: { seasonNumber: number | "other"; seasonName: string | null; episodes: Map<number | "other", FileRow[]> };
  titleId: string;
}) {
  const [open, setOpen] = useState(season.seasonNumber === 1 || season.seasonNumber === "other");
  const episodes = Array.from(season.episodes.entries()).sort(([a], [b]) => {
    if (a === "other") return 1;
    if (b === "other") return -1;
    return (a as number) - (b as number);
  });
  const totalFiles = episodes.reduce((acc, [, files]) => acc + files.length, 0);
  const label =
    season.seasonNumber === "other"
      ? "Other files"
      : season.seasonName ?? `Season ${season.seasonNumber}`;

  return (
    <div className="rounded-xl border border-border bg-surface/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface/70 transition-colors"
      >
        <div>
          <div className="font-semibold">{label}</div>
          <div className="text-xs text-muted-foreground">
            {episodes.length} {episodes.length === 1 ? "episode" : "episodes"} · {totalFiles} files
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-border divide-y divide-border">
          {episodes.map(([epNum, files]) => {
            const seasonNum =
              typeof files[0]?.episodes?.seasons?.season_number === "number"
                ? files[0]!.episodes!.seasons!.season_number
                : null;
            const episodeNum = typeof epNum === "number" ? epNum : null;
            return (
              <div key={String(epNum)} className="px-4 py-3 space-y-2">
                <div className="text-sm font-medium">
                  {epNum === "other" ? "Unassigned" : `Episode ${epNum}`}
                  {files[0]?.episodes?.name ? ` — ${files[0].episodes.name}` : ""}
                </div>
                <div className="grid gap-2 lg:grid-cols-2">
                  {files.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-start gap-3 rounded-lg border border-border bg-background/40 p-3 min-w-0"
                    >
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-gradient-primary text-primary-foreground">
                        <Download className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{f.file_name}</div>
                        <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-1.5 gap-y-0.5 mt-0.5">
                          {f.quality && <span>{f.quality}</span>}
                          {f.resolution && <span>· {f.resolution}</span>}
                          {f.language && <span>· {f.language.toUpperCase()}</span>}
                          {f.file_size && <span>· {(Number(f.file_size) / 1024 / 1024).toFixed(0)} MB</span>}
                        </div>
                      </div>
                      <DownloadButton
                        mediaFileId={f.id}
                        fileName={f.file_name}
                        titleId={titleId}
                        season={seasonNum}
                        episode={episodeNum}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
