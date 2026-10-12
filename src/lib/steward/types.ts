import type { StagedAction} from "@/lib/paypal/types";

export type RecommendedAction =
  | "refund"
  | "partial_refund"
  | "provide_evidence"
  | "remind"
  | "escalate";

export interface TriageResult {
  case_id: string;
  severity: "low" | "medium" | "high";
  recommended_action: RecommendedAction;
  confidence: number;
  rationale: string;
  draft_reply: string;
  staged_action: StagedAction;
  source: "minimax" | "template";
}
