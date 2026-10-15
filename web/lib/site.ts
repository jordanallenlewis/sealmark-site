// The host the site is served from (wrangler.jsonc routes). Printed docs append it to internal links via --site-host.
// sealmark.dev is the canonical host; the footer and print links read it from here.
export const SITE = { host: "sealmark.dev" };

// Credit shown in the site footer and page metadata. Change here, nowhere else.
export const AUTHOR = {
  name: "Jordan Allen Lewis",
  url: "https://jordanallenlewis.com",
};

// Contact addresses (Cloudflare Email Routing forwards both to the owner). Change here, nowhere else.
export const CONTACT = {
  email: "jordanallenlewis@sealmark.dev",
  security: "disclosure@sealmark.dev",
};
