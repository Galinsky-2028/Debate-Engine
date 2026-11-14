import {publicDistributionCount} from "../../lib/server/distributions";
/** Shown only from provider-accepted or delivered evidence; queued or failed sends are never counted. */
export default async function DistributionCount({branchId}:{branchId:string}){
 const n=await publicDistributionCount(branchId).catch(()=>0);
 if(!n)return null;
 return <p className="small-label">Distributed by a participant to {n} destination{n===1?"":"s"} (provider-confirmed)</p>;
}
