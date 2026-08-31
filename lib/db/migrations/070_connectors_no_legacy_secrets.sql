-- Interdit aux anciens conteneurs de recommencer a ecrire les cinq champs que
-- le formulaire historique rangeait en clair dans connectors.config.
--
-- NOT VALID est essentiel au rolling update : la contrainte protege
-- immediatement toute NOUVELLE ecriture, sans refuser son installation a cause
-- des lignes historiques. `migrate-connector-secrets.mjs` reprend ces lignes,
-- verifie leurs chiffres avec la bonne AAD, puis VALIDE la contrainte. L'API ne
-- demarre pas si cette derniere etape echoue.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'connectors_config_no_legacy_secrets'
       AND conrelid = 'connectors'::regclass
  ) THEN
    ALTER TABLE connectors
      ADD CONSTRAINT connectors_config_no_legacy_secrets
      CHECK (
        NOT (config ?| ARRAY[
          'apiKey',
          'secretKey',
          'webhookSecret',
          'clientSecret',
          'webhookUrl'
        ])
      ) NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT connectors_config_no_legacy_secrets ON connectors IS
  'Aucun identifiant legacy en clair; valeurs chiffrees dans tenant_secrets.';
