import {createPublicKey,verify,type JsonWebKey} from "node:crypto";
/** Verifies a GitHub Actions OIDC token for exactly one repository, branch and workflow. No shared secret exists. */
export const GITHUB_OIDC_ISSUER="https://token.actions.githubusercontent.com";
export type OidcExpectation={audience:string;repositoryId:string;repository:string;workflowPath:string;ref:string;events:readonly string[]};
export type GithubJwk=JsonWebKey&{kid?:string};
const b64=(s:string)=>Buffer.from(s.replace(/-/g,"+").replace(/_/g,"/"),"base64");
export class OidcRejected extends Error {}
export function verifyGithubOidc(token:string,keys:readonly GithubJwk[],nowSeconds:number,expect:OidcExpectation){
 const parts=token.split(".");
 if(parts.length!==3||token.length>8192)throw new OidcRejected("Malformed token.");
 let header:{alg?:string;kid?:string},claims:Record<string,unknown>;
 try{header=JSON.parse(b64(parts[0]).toString("utf8"));claims=JSON.parse(b64(parts[1]).toString("utf8"));}
 catch{throw new OidcRejected("Malformed token.");}
 if(header.alg!=="RS256"||typeof header.kid!=="string")throw new OidcRejected("Unsupported token algorithm.");
 const jwk=keys.find(k=>k.kid===header.kid&&k.kty==="RSA");
 if(!jwk)throw new OidcRejected("Unknown signing key.");
 const ok=verify("RSA-SHA256",Buffer.from(parts[0]+"."+parts[1]),createPublicKey({key:jwk,format:"jwk"}),b64(parts[2]));
 if(!ok)throw new OidcRejected("Invalid signature.");
 const skew=60;
 const num=(k:string)=>typeof claims[k]==="number"?claims[k] as number:NaN;
 if(claims.iss!==GITHUB_OIDC_ISSUER)throw new OidcRejected("Wrong issuer.");
 const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
 if(!aud.includes(expect.audience))throw new OidcRejected("Wrong audience.");
 if(!(num("exp")>nowSeconds-skew)||!(num("iat")<=nowSeconds+skew)||(claims.nbf!==undefined&&!(num("nbf")<=nowSeconds+skew)))
  throw new OidcRejected("Token is expired or not yet valid.");
 if(String(claims.repository_id)!==expect.repositoryId||claims.repository!==expect.repository)throw new OidcRejected("Wrong repository.");
 if(claims.ref!==expect.ref)throw new OidcRejected("Wrong branch.");
 if(claims.workflow_ref!==expect.repository+"/"+expect.workflowPath+"@"+expect.ref)throw new OidcRejected("Wrong workflow.");
 if(!expect.events.includes(String(claims.event_name)))throw new OidcRejected("Wrong triggering event.");
 return claims;
}

/** Key-set cache policy. A token naming an unknown key may force one refresh, but at most once a minute, so
 * unauthenticated callers cannot turn the endpoint into a stream of requests to GitHub. */
export const JWKS_CACHE_MS=10*60*1000,JWKS_FORCED_REFRESH_MIN_MS=60*1000;
export function jwksFetchNeeded(fetchedAt:number|null,now:number,force:boolean){
 if(fetchedAt===null)return true;
 const age=now-fetchedAt;
 return force?age>=JWKS_FORCED_REFRESH_MIN_MS:age>=JWKS_CACHE_MS;
}
