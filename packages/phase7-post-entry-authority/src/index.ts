// LPFORGE_PHASE7_POST_ENTRY_AUTHORITY
// P7's new-economic-action gate governs new/increased exposure.  A position
// already owned by LPForge needs a separate, explicit containment path so an
// OBSERVE_ONLY transition cannot strand deployed capital.
export type PostEntryAuthorityAction =
  | "OPEN"
  | "ADD"
  | "RESHAPE_REOPEN"
  | "CLAIM"
  | "REMOVE"
  | "RESHAPE_REMOVE"
  | "CLOSE"
  | "EMERGENCY_CLOSE"
  | "RECONCILIATION"
  | "MONITORING";
export interface PostEntryAuthorityInput {
  authorityMode?: string;
  healthStatus?: string;
  safetyMode?: string;
  newEconomicActionAllowed?: boolean;
  riskIncreasingPlanDispatchEnabled: boolean;
  protectiveActionDispatchEnabled: boolean;
}
export interface PostEntryAuthorityResult {
  action: PostEntryAuthorityAction;
  allowed: boolean;
  category: "RISK_INCREASING" | "PROTECTIVE" | "OBSERVATION";
  reasonCodes: string[];
}
const riskIncreasing = new Set<PostEntryAuthorityAction>([
  "OPEN", "ADD", "RESHAPE_REOPEN",
]);
const observation = new Set<PostEntryAuthorityAction>([
  "RECONCILIATION", "MONITORING",
]);
export function assessPostEntryAuthority(
  input: PostEntryAuthorityInput,
  action: PostEntryAuthorityAction,
): PostEntryAuthorityResult {
  if (observation.has(action))
    return { action, allowed: true, category: "OBSERVATION", reasonCodes: [] };
  if (riskIncreasing.has(action)) {
    const reasons: string[] = [];
    if (!input.riskIncreasingPlanDispatchEnabled)
      reasons.push("P7_RISK_INCREASING_PLAN_DISPATCH_DISABLED");
    if (input.authorityMode !== "PRODUCTION")
      reasons.push("P7_RISK_INCREASING_AUTHORITY_NOT_PRODUCTION");
    if (input.healthStatus !== "HEALTHY")
      reasons.push("P7_RISK_INCREASING_HEALTH_NOT_HEALTHY");
    if (input.safetyMode !== "NORMAL")
      reasons.push("P7_RISK_INCREASING_SAFETY_NOT_NORMAL");
    if (!input.newEconomicActionAllowed)
      reasons.push("P7_RISK_INCREASING_NEW_ACTION_BLOCKED");
    return { action, allowed: reasons.length === 0, category: "RISK_INCREASING", reasonCodes: reasons };
  }
  const reasons: string[] = [];
  if (!input.protectiveActionDispatchEnabled)
    reasons.push("P7_PROTECTIVE_ACTION_DISPATCH_DISABLED");
  // A durable current control decision is required, but OBSERVE_ONLY is an
  // intentional containment mode—not a reason to leave existing capital
  // unmanaged. Health degradation likewise informs the management decision;
  // it does not erase a verified position or authorize a blind resend.
  if (!input.authorityMode)
    reasons.push("P7_PROTECTIVE_CONTROL_MISSING");
  return { action, allowed: reasons.length === 0, category: "PROTECTIVE", reasonCodes: reasons };
}
