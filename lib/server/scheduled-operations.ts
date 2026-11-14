import "server-only";
import type {NextRequest} from "next/server";
import {HttpError} from "./http";
import {scheduledTokenValid} from "../../packages/domain/scheduled-token";

/** A machine caller (the scheduled GitHub workflow) proves itself with a long shared token; no cookies are involved. */
export function requireScheduledOperationsToken(request:NextRequest){
 if(!scheduledTokenValid(process.env.OPERATIONS_RUN_TOKEN,request.headers.get("authorization")))
  throw new HttpError(401,"A valid scheduled-operations token is required.");
}
