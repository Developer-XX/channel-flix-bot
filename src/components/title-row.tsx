import { TitleCard, TitleCardSkeleton, type TitleCardData } from "./title-card";

interface Props {
  title: string;
  items: TitleCardData[] | undefined;
  loading?: boolean;
  emptyHint?: string;
}

export function TitleRow({ title, items, loading, emptyHint }: Props) {
  const showEmpty = !loading && (!items || items.length === 0);
  return (
    <section className="py-4 sm:py-6">
      <h2 className="px-4 md:px-6 mb-3 sm:mb-4 text-lg sm:text-xl md:text-2xl font-display font-bold tracking-tight">
        {title}
      </h2>
      {showEmpty ? (
        <p className="px-4 md:px-6 text-sm text-muted-foreground">{emptyHint ?? "Nothing here yet."}</p>
      ) : (
        <div className="scrollbar-hide overflow-x-auto -mx-1 snap-x snap-mandatory">
          <div className="flex gap-3 sm:gap-4 px-4 md:px-6 pb-3">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="w-[130px] sm:w-[160px] md:w-[200px] shrink-0 snap-start">
                    <TitleCardSkeleton />
                  </div>
                ))
              : items!.map((item) => (
                  <div key={item.id} className="w-[130px] sm:w-[160px] md:w-[200px] shrink-0 snap-start">
                    <TitleCard item={item} />
                  </div>
                ))}
          </div>
        </div>
      )}
    </section>
  );
}

export function TitleGrid({ items, loading }: { items: TitleCardData[] | undefined; loading?: boolean }) {
  if (!loading && (!items || items.length === 0)) {
    return <p className="text-center text-muted-foreground py-20">No titles to show yet.</p>;
  }
  return (
    <div className="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-5">
      {loading
        ? Array.from({ length: 12 }).map((_, i) => <TitleCardSkeleton key={i} />)
        : items!.map((item) => <TitleCard key={item.id} item={item} />)}
    </div>
  );
}
