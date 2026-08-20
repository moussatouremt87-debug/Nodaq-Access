-- Rapprochement appel ↔ conversation ElevenLabs — ticket 4.18-bis, lot B.
--
-- La plateforme identifie chaque conversation par son propre identifiant, et le
-- webhook post-call ne connaît que lui. Sans cette colonne, impossible de
-- raccrocher la transcription, l'issue et le coût à la ligne d'appel : le
-- webhook recevrait des données sans destinataire.
--
-- Écrit au DÉCLENCHEMENT de l'appel (la réponse de l'endpoint outbound porte
-- l'identifiant), lu par le webhook. Nullable : les appels de l'exécution
-- maison n'en ont pas, et un appel jamais parti n'en aura jamais.

ALTER TABLE appels_relance
  ADD COLUMN IF NOT EXISTS conversation_id TEXT;

-- Le webhook cherche par cet identifiant, sans connaître le tenant : l'index
-- sert ce chemin. UNIQUE parce qu'une conversation ElevenLabs appartient à UN
-- appel — un doublon signifierait qu'on a facturé deux lignes pour une seule
-- conversation.
CREATE UNIQUE INDEX IF NOT EXISTS appels_relance_conversation_idx
  ON appels_relance (conversation_id)
  WHERE conversation_id IS NOT NULL;
