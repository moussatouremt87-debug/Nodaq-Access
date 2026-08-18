/**
 * Mécanique d'enregistrement vocal — EXTRAITE de `use-chat.ts`.
 *
 * Elle y était écrite pour le seul écran de discussion. Le micro doit
 * désormais exister sur toutes les pages : la recopier aurait garanti que les
 * deux copies divergent — sur le format audio, sur la durée minimale, ou sur
 * le message d'erreur de permission, qui est celui que l'artisan lit.
 *
 * Ce hook ne fait QUE capter et transcrire. Ce qu'on fait du texte est décidé
 * par l'appelant : la discussion l'envoie à l'agent, le micro flottant le
 * transforme en plan.
 */
import { useCallback, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';

const API_BASE = '/api';

/** En deçà, c'est un appui malencontreux, pas une phrase. */
const TAILLE_MINIMALE_OCTETS = 1000;

/**
 * Contraintes de captation — POINT DE SORTIE UNIQUE vers le micro (US-A8.1).
 *
 * L'utilisateur ne dicte pas dans un bureau : cuisine de restaurant, atelier,
 * bord de route, chantier. `{ audio: true }` laisse chaque navigateur décider
 * seul du traitement, et ils ne décident pas pareil — ce qui est actif par
 * défaut sur un Chrome de bureau ne l'est pas forcément sur le Safari du
 * téléphone qui est justement l'appareil utilisé sur le terrain. Demander
 * explicitement retire cette variable.
 *
 * Ce sont des DEMANDES, pas des garanties : une contrainte non gérée est
 * ignorée par le navigateur plutôt que de faire échouer la captation. C'est
 * voulu — mieux vaut enregistrer sans réduction de bruit que ne pas
 * enregistrer.
 *
 * Toute captation du produit passe par cette constante. `use-chat.ts` l'a
 * longtemps eue en double, et c'est exactement ce que l'en-tête de ce fichier
 * annonçait vouloir éviter. La garde de `use-dictee.test.ts` interdit
 * désormais un `{ audio: true }` nu ailleurs dans les sources.
 */
export const CONTRAINTES_AUDIO: MediaStreamConstraints = {
  audio: {
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
  },
};

export interface UseDictee {
  readonly enregistre: boolean;
  readonly transcrit: boolean;
  demarrer: () => Promise<void>;
  arreter: () => void;
}

export function useDictee(onTexte: (texte: string) => void): UseDictee {
  const { toast } = useToast();
  const [enregistre, setEnregistre] = useState(false);
  const [transcrit, setTranscrit] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const morceauxRef = useRef<Blob[]>([]);

  const demarrer = useCallback(async () => {
    if (enregistre) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia(CONTRAINTES_AUDIO);
      streamRef.current = stream;
      morceauxRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) morceauxRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        // Le flux se libère TOUJOURS, même si la transcription échoue : un
        // micro resté ouvert allume la pastille d'enregistrement du téléphone
        // et vide la batterie sans que personne ne comprenne pourquoi.
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const blob = new Blob(morceauxRef.current, { type: mimeType });
        morceauxRef.current = [];

        if (blob.size < TAILLE_MINIMALE_OCTETS) {
          toast({
            title: 'Enregistrement trop court',
            description: 'Maintenez le bouton pendant que vous parlez.',
          });
          return;
        }

        setTranscrit(true);
        try {
          const fd = new FormData();
          fd.append('audio', blob, 'audio.webm');
          const res = await fetch(`${API_BASE}/chat/transcribe`, {
            method: 'POST',
            credentials: 'include',
            body: fd,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const { text } = (await res.json()) as { text: string };
          if (text.trim()) onTexte(text.trim());
        } catch (err) {
          toast({
            title: 'Transcription échouée',
            description: err instanceof Error ? err.message : 'Erreur inconnue',
            variant: 'destructive',
          });
        } finally {
          setTranscrit(false);
        }
      };

      recorder.start(200);
      recorderRef.current = recorder;
      setEnregistre(true);
    } catch (err) {
      const permission = err instanceof DOMException && err.name === 'NotAllowedError';
      toast({
        title: permission ? 'Permission microphone refusée' : "Impossible d'accéder au microphone",
        description: permission
          ? "Autorisez l'accès au microphone dans les réglages de votre navigateur."
          : err instanceof Error
            ? err.message
            : 'Erreur inconnue',
        variant: 'destructive',
      });
    }
  }, [enregistre, onTexte, toast]);

  const arreter = useCallback(() => {
    if (!enregistre || !recorderRef.current) return;
    recorderRef.current.stop();
    recorderRef.current = null;
    setEnregistre(false);
  }, [enregistre]);

  return { enregistre, transcrit, demarrer, arreter };
}
