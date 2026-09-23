import type { MetadataRoute } from "next";

/** Site interno: não deve aparecer em buscadores. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
