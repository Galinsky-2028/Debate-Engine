import {invitedReplyOpenedAt} from "./deadlines.ts";
import {formatInstant} from "./outbox.ts";

/** Plan section 5: a drafted invitation is not a sent invitation, and nobody is accused of ignoring an unsent one. */
export type InvitationState = "drafted" | "sent" | "no_response" | "responded";
export type InvitationProjection = {
  state: InvitationState;
  sentAt: string | null;
  responseDueAt: string | null;
  respondedAt: string | null;
  label: string;
};

export function projectInvitation(input: {
  debatePublishedAt: string;
  providerEvidenceAt: string | null;
  replyWindowHours: number | null;
  respondedAt: string | null;
  now: string;
}): InvitationProjection {
  const sentAt = invitedReplyOpenedAt(input.debatePublishedAt, input.providerEvidenceAt);
  const respondedAt = input.respondedAt ? new Date(input.respondedAt).toISOString() : null;
  if (input.replyWindowHours !== null && (!Number.isFinite(input.replyWindowHours) || input.replyWindowHours <= 0))
    throw new Error("replyWindowHours must be positive.");
  if (sentAt === null) {
    // Uninvited participation stays possible; a response before any send is still a response.
    if (respondedAt) return {state: "responded", sentAt: null, responseDueAt: null, respondedAt, label: "Response received " + formatInstant(respondedAt)};
    return {state: "drafted", sentAt: null, responseDueAt: null, respondedAt: null, label: "Invitation drafted — not sent"};
  }
  const responseDueAt = input.replyWindowHours === null ? null
    : new Date(Date.parse(sentAt) + input.replyWindowHours * 3600_000).toISOString();
  if (respondedAt) return {state: "responded", sentAt, responseDueAt, respondedAt, label: "Response received " + formatInstant(respondedAt)};
  if (responseDueAt && Date.parse(input.now) > Date.parse(responseDueAt))
    return {state: "no_response", sentAt, responseDueAt, respondedAt: null, label: "No response received by " + formatInstant(responseDueAt)};
  return {state: "sent", sentAt, responseDueAt, respondedAt: null,
    label: "Invited " + formatInstant(sentAt) + (responseDueAt ? " · Response due " + formatInstant(responseDueAt) : "")};
}
