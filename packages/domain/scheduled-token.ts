import {createHash,timingSafeEqual} from "node:crypto";
/** Constant-time check of a machine caller's bearer token; a short or missing configured token never authorizes. */
export function scheduledTokenValid(expected:string|undefined,authorization:string|null){
 const want=expected||"";
 const got=authorization?.startsWith("Bearer ")?authorization.slice(7):"";
 if(want.length<64||!got||got.length>256)return false;
 return timingSafeEqual(createHash("sha256").update(want).digest(),createHash("sha256").update(got).digest());
}
