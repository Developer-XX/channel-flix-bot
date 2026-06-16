import { Link } from "@tanstack/react-router";
import { PlayCircle, Sparkles } from "lucide-react";
import heroImg from "@/assets/hero-banner.jpg";
import { Button } from "@/components/ui/button";

interface Props {
  featured?: { slug: string; title: string; overview: string | null; backdrop_url: string | null } | null;
}

export function Hero({ featured }: Props) {
  const bg = featured?.backdrop_url || heroImg;
  return (
    <section className="relative min-h-[68vh] sm:min-h-[78vh] md:min-h-[88vh] w-full overflow-hidden">
      <img
        src={bg}
        alt=""
        width={1920}
        height={1080}
        fetchPriority="high"
        decoding="async"
        loading="eager"
        className="absolute inset-0 h-full w-full object-cover object-center scale-105"
      />
      <div className="absolute inset-0 bg-gradient-hero" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/55 to-transparent md:via-background/40" />

      <div className="relative z-10 mx-auto flex min-h-[68vh] sm:min-h-[78vh] md:min-h-[88vh] max-w-7xl items-end md:items-center px-4 sm:px-6 pt-20 sm:pt-24 pb-10 sm:pb-16">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full glass px-3 py-1 text-[11px] sm:text-xs text-foreground/80 mb-4 sm:mb-5">
            <Sparkles className="h-3.5 w-3.5 text-gold" />
            <span>Premium streaming directory</span>
          </div>
          <h1 className="font-display text-[2.25rem] leading-[1.05] sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight">
            {featured?.title ?? (
              <>
                Every story.<br />
                <span className="text-gradient-primary">One vault.</span>
              </>
            )}
          </h1>
          <p className="mt-4 sm:mt-5 text-sm sm:text-base md:text-lg text-muted-foreground leading-relaxed max-w-xl line-clamp-4 sm:line-clamp-none">
            {featured?.overview ??
              "Discover thousands of movies, web series, anime, K-Drama and cartoons. Curated, organized, and delivered straight from Telegram."}
          </p>
          <div className="mt-5 sm:mt-7 flex flex-col xs:flex-row flex-wrap gap-2.5 sm:gap-3">
            {featured ? (
              <Link to="/title/$slug" params={{ slug: featured.slug }} className="contents">
                <Button size="lg" className="w-full xs:w-auto bg-gradient-primary hover:opacity-90 text-primary-foreground border-0 h-11 sm:h-12 px-6 sm:px-7 text-sm sm:text-base shadow-lg shadow-primary/20">
                  <PlayCircle className="mr-2 h-5 w-5" />
                  Watch now
                </Button>
              </Link>
            ) : (
              <Link to="/browse/$category" params={{ category: "movie" }} className="contents">
                <Button size="lg" className="w-full xs:w-auto bg-gradient-primary hover:opacity-90 text-primary-foreground border-0 h-11 sm:h-12 px-6 sm:px-7 text-sm sm:text-base shadow-lg shadow-primary/20">
                  <PlayCircle className="mr-2 h-5 w-5" />
                  Start exploring
                </Button>
              </Link>
            )}
            <Link to="/browse/$category" params={{ category: "series" }} className="contents">
              <Button size="lg" variant="outline" className="w-full xs:w-auto h-11 sm:h-12 px-6 sm:px-7 text-sm sm:text-base bg-surface/40 backdrop-blur border-border">
                Browse series
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
