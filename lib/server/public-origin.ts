import "server-only";
import type {NextRequest} from "next/server";
import {HttpError} from "./http";
/** Absolute public links must never be derived from a client-controlled Host header in production. */
export function publicBaseUrl(request:NextRequest){
 const configured=process.env.PUBLIC_BASE_URL||process.env.PUBLIC_APP_ORIGIN||process.env.RENDER_EXTERNAL_URL;
 if(configured?.startsWith("https://")||(configured&&process.env.NODE_ENV!=="production"))return configured;
 if(process.env.NODE_ENV==="production")throw new HttpError(503,"Public base URL is not configured.");
 return request.nextUrl.origin;
}
