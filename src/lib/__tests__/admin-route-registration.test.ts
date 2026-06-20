import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const treePath = join(ROOT, "src", "routeTree.gen.ts");

/**
 * Regression: /admin/episode-audit and /admin/shorteners must always be
 * registered in the generated route tree AND backed by route files.
 *
 * The bug we are guarding against: the route file existed but the
 * generated tree was stale (or the file was renamed), so TanStack Router
 * matched the parent `_authenticated/admin` layout, then rendered the
 * root `notFoundComponent` ("Not Found") inside the admin <Outlet />.
 */

const ROUTES = [
  {
    fullPath: "/admin/episode-audit",
    file: "src/routes/_authenticated/admin.episode-audit.tsx",
    importMarker: "AuthenticatedAdminEpisodeAuditRouteImport",
  },
  {
    fullPath: "/admin/shorteners",
    file: "src/routes/_authenticated/admin.shorteners.tsx",
    importMarker: "AuthenticatedAdminShortenersRouteImport",
  },
] as const;

describe("admin routes are registered (Not Found regression)", () => {
  const tree = readFileSync(treePath, "utf8");

  for (const r of ROUTES) {
    it(`${r.fullPath} route file exists`, () => {
      expect(existsSync(join(ROOT, r.file))).toBe(true);
    });

    it(`${r.fullPath} is registered in routeTree.gen.ts`, () => {
      expect(tree).toContain(r.importMarker);
      // The fullPath literal must appear in the generated registry.
      expect(tree).toContain(`'${r.fullPath}'`);
    });

    it(`${r.fullPath} route file uses the canonical createFileRoute path`, () => {
      const src = readFileSync(join(ROOT, r.file), "utf8");
      // _authenticated layout is stripped from URL but kept in the route id
      expect(src).toMatch(
        new RegExp(
          `createFileRoute\\(["']/_authenticated${r.fullPath.replace(/\//g, "\\/")}["']\\)`,
        ),
      );
    });
  }
});
