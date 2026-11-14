import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isPlatformAdmin } from "../auth/server";
import { database } from "./db";
import {isTrustedMutationOrigin} from "../../packages/domain/request-origin";
import {boundedText} from "./request-body";

import {HttpError} from "./http-error";
export {HttpError};
export function jsonError(error: unknown) {
  if (error instanceof HttpError) return NextResponse.json({ error: error.message }, {status: error.status});
  if (error instanceof Error && error.message === "DATABASE_UNAVAILABLE")
    return NextResponse.json({error:"Database is not configured."}, {status:503});
  console.error("Debate Engine request failed", error instanceof Error ? error.name : "unknown");
  return NextResponse.json({error:"Request could not be completed."}, {status:500});
}
/** Cookie-authenticated requests require same-origin browser provenance. */
export function requireSameOrigin(request: NextRequest) {
  if(!isTrustedMutationOrigin({
    origin:request.headers.get("origin"),
    host:request.headers.get("host"),
    forwardedHost:request.headers.get("x-forwarded-host"),
    forwardedProto:request.headers.get("x-forwarded-proto"),
    canonicalOrigin:process.env.PUBLIC_APP_ORIGIN,
    environment:process.env.NODE_ENV
  }))throw new HttpError(403,"A genuine same-origin browser request is required.");
}
export async function parseJson(request: NextRequest): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new HttpError(415, "Expected application/json.");
  const body = await boundedText(request, 262144);
  try { return JSON.parse(body); } catch { throw new HttpError(400, "Invalid JSON body."); }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400,"Expected an object.");
  return value as Record<string, unknown>;
}
export function field(value: unknown, label: string, max = 240) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new HttpError(400, label + " must be nonempty and at most " + max + " characters.");
  return value.trim();
}
export function uuid(value: unknown, label: string) {
  const str = field(value,label,36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str))
    throw new HttpError(400, label + " must be a UUID.");
  return str;
}
export async function requireIdentity(verified = false) {
  const user = await getAuthenticatedUser();
  if (!user) throw new HttpError(401,"Sign in is required.");
  if (verified && !user.emailVerified) throw new HttpError(403,"Verify your email before continuing.");
  await refuseInactiveAccount(user.id);
  return user;
}
/** A closed (or suspended) account keeps its public attribution but can no longer act. */
export async function refuseInactiveAccount(subject: string) {
  const q = await database().query<{status:string}>(
    "SELECT status FROM accounts WHERE identity_provider='neon-auth' AND external_subject=$1",[subject]);
  if (q.rows[0] && q.rows[0].status !== "active")
    throw new HttpError(403,"This account is closed or suspended and cannot make changes.");
}
export async function requireAdmin() {
  const user = await requireIdentity(true);
  if (!isPlatformAdmin(user)) throw new HttpError(403,"Platform administrator access required.");
  return user;
}
/** The Neon auth subject is authoritative; an email address is never an admin key. */
export async function syncAccount(user: {id:string;name:string}) {
  const q=await database().query<{id:string;status:string}>(
    "INSERT INTO accounts(identity_provider, external_subject, display_name) VALUES('neon-auth',$1,$2) ON CONFLICT(identity_provider,external_subject) DO UPDATE SET display_name=CASE WHEN accounts.status='active' THEN EXCLUDED.display_name ELSE accounts.display_name END RETURNING id,status",
    [user.id,user.name||"Registered user"]);
  if (q.rows[0].status !== "active") throw new HttpError(403,"This account is closed or suspended and cannot make changes.");
  return q.rows[0].id;
}
