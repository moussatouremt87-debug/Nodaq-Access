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
    /**
     * Convenience shorthand set by resolveTenant — always equals
     * session.tenantId when present.
     *
     * Également posé par `requireAppelVocal`, mais depuis la LIGNE d'appel
     * désignée par le jeton du worker, jamais depuis une session : le worker
     * est une machine et n'en a pas. Les deux chemins ont en commun ce qui
     * compte — le tenant ne vient jamais du client.
     */
    tenantId?: string;
    /**
     * L'appel vocal en cours, posé par `requireAppelVocal` (ticket 4.18).
     *
     * Sa présence signifie que l'appelant est le worker et qu'il a prouvé, par
     * son jeton, sur quel appel il travaille. Une route qui lit `appelVocal`
     * ne peut donc pas être atteinte par un humain.
     */
    appelVocal?: {
      appelId: string;
      campagneId: string;
    };
    /**
     * Raw request body bytes, captured by express.json()'s `verify` hook.
     * Needed to check a webhook signature (plateforme agréée, US-A2.6) —
     * re-serializing req.body would not reproduce the exact bytes signed by
     * the sender.
     */
    rawBody?: Buffer;
  }
}
