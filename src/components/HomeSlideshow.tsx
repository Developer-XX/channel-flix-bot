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
        className="absolute inset-0 w-full h-full object-cover object-center"
        loading="eager"
      />
      {/* Mobile: stronger, taller gradient for readability; desktop: subtle hero gradient */}
      <div className="absolute inset-x-0 bottom-0 h-[62%] bg-gradient-to-t from-background via-background/85 to-transparent sm:h-2/3 sm:via-background/70" />
      {/* Extra dark band behind text on mobile for contrast on light images */}
      <div className="absolute inset-x-0 bottom-0 h-[45%] bg-gradient-to-t from-background/95 to-transparent sm:hidden" />

      <div className="absolute bottom-0 left-0 right-0 p-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:p-6 sm:pb-8 md:p-10 md:pb-10 max-w-3xl">
        <h2 className="font-display text-lg sm:text-2xl md:text-4xl lg:text-5xl font-bold leading-snug sm:leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)] line-clamp-2">
          {active.title}
        </h2>
        {active.subtitle && (
          <p className="mt-1.5 sm:mt-2 text-sm sm:text-base md:text-lg text-foreground/90 max-w-2xl leading-relaxed sm:leading-normal line-clamp-2 sm:line-clamp-3 drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]">
            {active.subtitle}
          </p>
        )}
        {active.cta_label && active.link_url && (
          <span className="mt-3 sm:mt-4 inline-flex items-center rounded-md bg-gradient-primary text-primary-foreground px-3.5 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base font-medium shadow-md">
            {active.cta_label}
          </span>
        )}
      </div>

      {slides.length > 1 && (
        <div className="absolute bottom-[calc(0.5rem+env(safe-area-inset-bottom))] right-4 flex gap-1.5 sm:bottom-3 sm:right-5">
          {slides.map((s, idx) => (
            <button
              key={s.id}
              aria-label={`Slide ${idx + 1}`}
              onClick={(e) => { e.preventDefault(); setI(idx); }}
              className={`h-1.5 rounded-full transition-all ${
                idx === i ? "w-6 bg-primary" : "w-1.5 bg-foreground/50"
              }`}
            />
          ))}
        </div>
      )}
    </>
  );

  return (
    <section className="relative w-full aspect-[3/4] sm:aspect-[16/9] md:aspect-[21/9] max-h-[75vh] sm:max-h-[70vh] overflow-hidden">
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
