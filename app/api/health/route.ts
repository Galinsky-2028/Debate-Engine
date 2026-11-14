import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
/** Render sets RENDER_GIT_COMMIT to the deployed commit; it is public source metadata, not a secret. */
export function GET() { return NextResponse.json({ status: "ok", service: "public-debate-engine", version: process.env.RENDER_GIT_COMMIT || "unknown" }, { headers: { "Cache-Control": "no-store" } }); }
