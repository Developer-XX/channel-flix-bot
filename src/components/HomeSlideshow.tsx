import { useEffect, useState } from "react";
import type { HomepageSlide } from "@/lib/homepage.functions";

interface Props {
  slides: HomepageSlide[];
}

export function HomeSlideshow({ slides }: Props) {
  const [i, setI] = useState(0);
  const active = slides[i];

  useEffect(() => {
    if (slides.length < 2) return;
    const t = setTimeout(
      () => setI((p) => (p + 1) % slides.length),
      Math.max(1500, active?.duration_ms ?? 5000),
    );
    return () => clearTimeout(t);
  }, [i, slides, active]);

  if (!active) return null;

  const inner = (
    <>
      <img
        src={active.image_url}
        alt={active.title}
        className="absolute inset-0 w-full h-full object-cover"
        loading="eager"
      />
      <div className="absolute inset-x-0 bottom-0 h-1/2 sm:h-2/3 bg-gradient-to-t from-background via-background/70 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-3 pb-8 sm:p-8 sm:pb-10 md:p-12 max-w-3xl">
        <h2 className="font-display text-base sm:text-3xl md:text-5xl font-bold drop-shadow line-clamp-2">
          {active.title}
        </h2>
        {active.subtitle && (
          <p className="mt-1 sm:mt-2 text-xs sm:text-base text-foreground/85 max-w-2xl line-clamp-2 sm:line-clamp-3">
            {active.subtitle}
          </p>
        )}
        {active.cta_label && active.link_url && (
          <span className="mt-2 sm:mt-4 inline-flex items-center rounded-md bg-gradient-primary text-primary-foreground px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium">
            {active.cta_label}
          </span>
        )}
      </div>
      {slides.length > 1 && (
        <div className="absolute bottom-2 right-3 flex gap-1.5">
          {slides.map((s, idx) => (
            <button
              key={s.id}
              aria-label={`Slide ${idx + 1}`}
              onClick={(e) => { e.preventDefault(); setI(idx); }}
              className={`h-1.5 rounded-full transition-all ${
                idx === i ? "w-6 bg-primary" : "w-1.5 bg-foreground/40"
              }`}
            />
          ))}
        </div>
      )}
    </>
  );

  return (
    <section className="relative w-full aspect-[4/5] xs:aspect-[16/9] sm:aspect-[21/9] max-h-[70vh] overflow-hidden">
      {active.link_url ? (
        <a href={active.link_url} className="block w-full h-full">
          {inner}
        </a>
      ) : (
        inner
      )}
    </section>
  );
}
