import type { DataPlan, UssdVariant } from '@/store/useDataPlanStore';
import { normalizeToLocal } from './phone';

/**
 * Resolves which USSD template a plan should dial right now, and builds
 * the final dial string with the customer's phone number substituted
 * for the "pn" placeholder.
 */

/** Minutes since midnight, for simple window comparison. */
function toMinutes(h: number, m: number) {
  return h * 60 + m;
}

/**
 * True if `now` (minutes since midnight) falls inside [start, end).
 * Handles windows that wrap past midnight, e.g. 23:00–03:59.
 */
function inWindow(nowMin: number, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return true; // 24h window
  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  // wraps midnight
  return nowMin >= startMin || nowMin < endMin;
}

export function variantActiveAt(variant: UssdVariant, at: Date = new Date()): boolean {
  const nowMin = toMinutes(at.getHours(), at.getMinutes());
  const startMin = toMinutes(variant.startHour, variant.startMinute);
  const endMin = toMinutes(variant.endHour, variant.endMinute);
  return inWindow(nowMin, startMin, endMin);
}

export type PlanUssdResolution =
  | { available: true; ussdTemplate: string; variantLabel: string | null }
  | { available: false; reason: string };

/** Pick the correct USSD template for a plan at the given time. */
export function resolvePlanUssd(plan: DataPlan, at: Date = new Date()): PlanUssdResolution {
  if (!plan.enabled) {
    return { available: false, reason: 'Plan is disabled' };
  }

  if (!plan.timeConfigured) {
    if (!plan.ussd) return { available: false, reason: 'No USSD code set for this plan' };
    return { available: true, ussdTemplate: plan.ussd, variantLabel: null };
  }

  const active = plan.ussdVariants.find((v) => variantActiveAt(v, at));
  if (!active || !active.ussd) {
    return { available: false, reason: "Outside this plan's configured time window" };
  }
  return { available: true, ussdTemplate: active.ussd, variantLabel: active.label };
}

/** Substitute the "pn" placeholder in a USSD template with a local phone number. */
export function buildPlanUssd(template: string, customerPhone: string): string | null {
  const local = normalizeToLocal(customerPhone);
  if (!local) return null;
  return template.replace(/pn/g, local);
}

/**
 * Advanced-type plans store their full menu path as one chained string,
 * e.g. "*456*1*12*3*2*pn*1#" — the first segment is the actual short
 * code to dial ("*456#"); every segment after it is one menu selection
 * to be typed into the popup that appears after dialing, in order
 * (that's what the native UssdAccessibilityService's pendingInputs queue
 * does — see modules/ussd-executor). Simple/Normal plans are short
 * enough that Android resolves the whole chained string as one MMI code
 * without any popup interaction, so they're dialed as-is with no steps.
 */
export type StepDial = { dialCode: string; menuInputs: string[] };

/** Split a chained USSD template like "*456*1*12*3*2*pn*1#" into a base
 * dial code and an ordered list of menu inputs, substituting the "pn"
 * placeholder with the customer's local phone number. */
export function buildAdvancedSteps(template: string, customerPhone: string): StepDial | null {
  const local = normalizeToLocal(customerPhone);
  if (!local) return null;

  const segments = template
    .split('*')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (segments.length === 0) return null;

  const [first, ...rest] = segments;
  const dialCode = `*${first.replace(/#$/, '')}#`;

  const menuInputs = rest.map((seg) => seg.replace(/#$/, '').replace(/pn/g, local));

  return { dialCode, menuInputs };
}

export type PlanDial =
  | {
      mode: 'direct';
      ussd: string;
      variantLabel: string | null;
      timeoutKind: 'simple' | 'advanced';
      strictClassification: boolean;
    }
  | {
      mode: 'stepped';
      dialCode: string;
      menuInputs: string[];
      variantLabel: string | null;
      timeoutKind: 'simple' | 'advanced';
      strictClassification: boolean;
    };

/**
 * Full resolve for dialing, aware of the plan's USSD Type:
 *  - 'simple'   -> direct dial (whole chained string at once), short
 *                  timeout, strict keyword-based classification.
 *  - 'normal'   -> stepped dial (base code + queued menu inputs), same
 *                  short timeout and strict classification as Simple —
 *                  it's still expected to resolve quickly and get a
 *                  clean confirmation, unlike Advanced.
 *  - 'advanced' -> stepped dial, longer timeout, lenient classification
 *                  (any non-blank final response counts) since deep
 *                  multi-level menus end in too many different screens
 *                  to keyword-match reliably.
 */
export function buildPlanDial(
  plan: DataPlan,
  customerPhone: string,
  at: Date = new Date()
): PlanDial | { error: string } {
  const resolution = resolvePlanUssd(plan, at);
  if (!resolution.available) return { error: resolution.reason };

  const isAdvanced = plan.ussdType === 'advanced';
  const timeoutKind: 'simple' | 'advanced' = isAdvanced ? 'advanced' : 'simple';
  const strictClassification = !isAdvanced;

  if (plan.ussdType === 'advanced' || plan.ussdType === 'normal') {
    const steps = buildAdvancedSteps(resolution.ussdTemplate, customerPhone);
    if (!steps) return { error: 'Invalid customer phone number' };
    return {
      mode: 'stepped',
      ...steps,
      variantLabel: resolution.variantLabel,
      timeoutKind,
      strictClassification,
    };
  }

  const ussd = buildPlanUssd(resolution.ussdTemplate, customerPhone);
  if (!ussd) return { error: 'Invalid customer phone number' };
  return {
    mode: 'direct',
    ussd,
    variantLabel: resolution.variantLabel,
    timeoutKind,
    strictClassification,
  };
}

/**
 * @deprecated kept for callers that only ever want a direct single-string
 * dial regardless of ussdType — prefer buildPlanDial() for new code so
 * 'advanced' plans get proper step sequencing.
 */
export function buildDialForPlan(
  plan: DataPlan,
  customerPhone: string,
  at: Date = new Date()
): { ussd: string; variantLabel: string | null } | { error: string } {
  const resolution = resolvePlanUssd(plan, at);
  if (!resolution.available) return { error: resolution.reason };

  const ussd = buildPlanUssd(resolution.ussdTemplate, customerPhone);
  if (!ussd) return { error: 'Invalid customer phone number' };

  return { ussd, variantLabel: resolution.variantLabel };
}
