/**
 * Express Request augmentation — typed session context injected by middlewares.
 *
 * requireAuth     → sets req.session
 * resolveTenant   → sets req.tenantId (from session.tenantId)
 * requireMembership → re-validates and updates req.session.role from DB
 */
declare namespace Express {
  interface Request {
    /** Set by requireAuth after validating the nodaq_sid cookie against the sessions table. */
    session?: {
      id: string;
      userId: string;
      tenantId: string;
      role: string;
      email: string;
      nom: string | null;
      /** MFA (ticket 4.15). Whether THIS session has proven the second factor. */
      mfaVerifiedAt: Date | null;
      /** Whether this user has ever completed MFA enrollment (any session). */
      mfaEnabled: boolean;
    };
    /** Convenience shorthand set by resolveTenant — always equals session.tenantId when present. */
    tenantId?: string;
    /**
     * Raw request body bytes, captured by express.json()'s `verify` hook.
     * Needed to check a webhook signature (plateforme agréée, US-A2.6) —
     * re-serializing req.body would not reproduce the exact bytes signed by
     * the sender.
     */
    rawBody?: Buffer;
  }
}
