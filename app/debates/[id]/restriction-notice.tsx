import React from "react";
import {restrictionCategoryLabels,type RestrictionCategory} from "../../../packages/domain/restrictions";
export type RestrictionNoticeData={caseId:string;category:string;openedAt:string;publicNotice:string;appealStatus:string;inherited?:boolean};
const appealText:Record<string,string>={none:"No appeal recorded.",pending:"An appeal by the contributor is pending review.",upheld:"An appeal was reviewed and the restriction was upheld."};
/** Non-misleading notice shown in place of restricted bytes; the contribution itself stays listed. */
export default function RestrictionNotice({restriction,candidateName}:{restriction:RestrictionNoticeData;candidateName?:string}){
 const label=restrictionCategoryLabels[restriction.category as RestrictionCategory]||restriction.category;
 return <div className="record-explainer restriction-notice" role="note" aria-label="Exceptional platform restriction notice">
  <p className="small-label">PLATFORM RESTRICTION · {label.toUpperCase()} · SINCE {new Date(restriction.openedAt).toLocaleDateString("en-US")}</p>
  <strong>Media and text withheld by the platform, not by any candidate.</strong>
  <p>{restriction.publicNotice}</p>
  <p>{appealText[restriction.appealStatus]||appealText.none} This {candidateName?"contribution by "+candidateName:"item"} remains part of the permanent public record and its counts; it was not deleted or altered.</p>
  <p><a className="inline-arrow" href={"#restriction-"+restriction.caseId}>Restriction history ↓</a></p>
 </div>;
}
