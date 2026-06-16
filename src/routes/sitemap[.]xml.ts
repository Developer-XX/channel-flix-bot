import { createFileRoute } from "@tanstack/react-router";

const BASE_URL = "";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${BASE_URL}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>${BASE_URL}/browse/movie</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
  <url><loc>${BASE_URL}/browse/series</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
  <url><loc>${BASE_URL}/browse/anime</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
  <url><loc>${BASE_URL}/browse/cartoon</loc><changefreq>daily</changefreq><priority>0.8</priority></url>
  <url><loc>${BASE_URL}/browse/kdrama</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
  <url><loc>${BASE_URL}/browse/documentary</loc><changefreq>daily</changefreq><priority>0.8</priority></url>
  <url><loc>${BASE_URL}/request</loc><changefreq>monthly</changefreq><priority>0.4</priority></url>
</urlset>`;
        return new Response(xml, {
          headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" },
        });
      },
    },
  },
});
