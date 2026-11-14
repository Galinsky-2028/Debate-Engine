import type { NextConfig } from "next";

/** Media is served from short-lived signed object-storage URLs, so media-src allows HTTPS. */
const baseCsp=[
 "default-src 'self'",
 "script-src 'self' 'unsafe-inline'",
 "style-src 'self' 'unsafe-inline'",
 "img-src 'self' data: blob: https:",
 "media-src 'self' blob: https:",
 "connect-src 'self' https:",
 "worker-src 'self' blob:",
 "font-src 'self' data:",
 "object-src 'none'",
 "base-uri 'self'",
 "form-action 'self'",
].join("; ");
const shared=[
 {key:"X-Content-Type-Options",value:"nosniff"},
 {key:"Referrer-Policy",value:"strict-origin-when-cross-origin"},
 {key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=(), payment=()"},
];
const securityHeaders=[
 // Every page except read-only embeds refuses framing: no clickjacking of publication or approval actions.
 {source:"/:path((?!embed/).*)",headers:[...shared,{key:"X-Frame-Options",value:"DENY"},{key:"Content-Security-Policy",value:baseCsp+"; frame-ancestors 'none'"}]},
 // Read-only public embeds are intentionally frameable by any site; they contain no forms or credentials.
 {source:"/embed/:path*",headers:[...shared,{key:"Content-Security-Policy",value:baseCsp+"; frame-ancestors *"}]},
];
const config: NextConfig = {
 poweredByHeader: false,
 async headers(){return securityHeaders;},
};
export default config;
