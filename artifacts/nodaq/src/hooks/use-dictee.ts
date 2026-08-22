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

/**
 * Formats d'enregistrement, par ordre de préférence.
 *
 * ── Pourquoi `audio/mp4` figure ici ──────────────────────────────────────
 * Safari — donc TOUT iPhone — ne sait produire NI `audio/webm` NI `audio/ogg`.
 * La liste d'origine n'essayait que ces deux-là puis retombait sur
 * `'audio/webm'` en dur : `new MediaRecorder(stream, { mimeType })` levait
 * alors `NotSupportedError`, et la commande vocale ne pouvait tout simplement
 * pas fonctionner sur l'appareil que les utilisateurs ont dans la poche.
 *
 * L'échec était de surcroît muet sur sa cause : le message affiché était
 * « Impossible d'accéder au microphone », ce qui accusait la permission alors
 * que la permission était accordée.
 */
const FORMATS_PREFERES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/webm',
] as const;

/**
 * Le premier format que ce navigateur sait produire, ou `undefined`.
 *
 * `undefined` et non une valeur par défaut : sans `mimeType`, `MediaRecorder`
 * choisit lui-même ce qu'il sait faire. Lui imposer un format qu'il ne connaît
 * pas ne peut qu'échouer, alors que le laisser décider marche toujours.
 */
export function formatEnregistrementSupporte(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return FORMATS_PREFERES.find((f) => MediaRecorder.isTypeSupported?.(f));
}

export interface UseDictee {
  readonly enregistre: boolean;
  readonly transcrit: boolean;
  /** Dernière erreur, pour un état VISIBLE à l'écran — pas seulement un toast
   *  qui disparaît avant qu'on ait fini de le lire, sur un chantier. */
  readonly erreur: string | null;
  demarrer: () => Promise<void>;
  arreter: () => void;
}

export function useDictee(onTexte: (texte: string) => void): UseDictee {
  const { toast } = useToast();
  const [enregistre, setEnregistre] = useState(false);
  const [transcrit, setTranscrit] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const morceauxRef = useRef<Blob[]>([]);
  /**
   * Un démarrage est en cours. Une REF et non un état : `demarrer` est
   * asynchrone (la demande de permission peut durer), et `setEnregistre(true)`
   * n'arrivait qu'à la toute fin. Un `enregistre` lu dans une clôture périmée
   * disait donc « non » pendant tout ce temps.
   */
  const enCoursRef = useRef(false);
  /**
   * L'utilisateur a relâché AVANT que l'enregistreur existe.
   *
   * ── Le défaut que ça corrige ────────────────────────────────────────────
   * `arreter` commençait par `if (!enregistre || !recorderRef.current) return;`.
   * Sur un appui bref — ou simplement sur le premier appui, quand le navigateur
   * affiche encore sa demande de permission — le relâchement arrivait avant que
   * `demarrer` ait fini. `arreter` ne trouvait aucun enregistreur et RENDAIT LA
   * MAIN SANS RIEN FAIRE : l'enregistrement démarrait juste après et ne
   * s'arrêtait jamais. Le micro restait ouvert, la pastille rouge du téléphone
   * allumée, et aucun texte n'arrivait jamais. « La commande vocale ne marche
   * pas. »
   */
  const arretDemandeRef = useRef(false);

  const demarrer = useCallback(async () => {
    if (enCoursRef.current) return;
    enCoursRef.current = true;
    arretDemandeRef.current = false;
    setErreur(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia(CONTRAINTES_AUDIO);
      streamRef.current = stream;
      morceauxRef.current = [];

      const mimeType = formatEnregistrementSupporte();
      // Sans format connu, on laisse le navigateur choisir le sien plutôt que
      // de lui en imposer un qu'il refusera.
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) morceauxRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        // Le flux se libère TOUJOURS, même si la transcription échoue : un
        // micro resté ouvert allume la pastille d'enregistrement du téléphone
        // et vide la batterie sans que personne ne comprenne pourquoi.
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        const blob = new Blob(morceauxRef.current, { type: recorder.mimeType || mimeType });
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
          const detail = err instanceof Error ? err.message : 'Erreur inconnue';
          setErreur(`Transcription échouée — ${detail}`);
          toast({ title: 'Transcription échouée', description: detail, variant: 'destructive' });
        } finally {
          setTranscrit(false);
        }
      };

      recorder.start(200);
      recorderRef.current = recorder;
      setEnregistre(true);

      // Relâché pendant la demande de permission : on arrête MAINTENANT.
      // Sans ça, l'enregistrement tourne indéfiniment.
      if (arretDemandeRef.current) {
        arretDemandeRef.current = false;
        recorderRef.current = null;
        setEnregistre(false);
        recorder.stop();
      }
    } catch (err) {
      // Le flux se libère aussi quand la construction de l'enregistreur
      // échoue — sinon la permission reste prise et la pastille allumée.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setEnregistre(false);

      const permission = err instanceof DOMException && err.name === 'NotAllowedError';
      const format =
        err instanceof DOMException &&
        (err.name === 'NotSupportedError' || err.name === 'TypeError');
      const titre = permission
        ? 'Permission microphone refusée'
        : format
          ? "Ce navigateur ne sait pas enregistrer"
          : "Impossible d'accéder au microphone";
      // Un message qui accuse la permission alors que le format est en cause
      // envoie l'utilisateur fouiller des réglages qui sont déjà bons.
      const detail = permission
        ? "Autorisez l'accès au microphone dans les réglages de votre navigateur."
        : format
          ? "Essayez depuis Safari (iPhone) ou Chrome (Android) à jour."
          : err instanceof Error
            ? err.message
            : 'Erreur inconnue';
      setErreur(`${titre} — ${detail}`);
      toast({ title: titre, description: detail, variant: 'destructive' });
    } finally {
      enCoursRef.current = false;
    }
  }, [onTexte, toast]);

  const arreter = useCallback(() => {
    // Aucune lecture de `enregistre` ici : cet état arrive trop tard. Si
    // l'enregistreur n'existe pas encore, on NOTE l'arrêt — `demarrer` le
    // verra et coupera dès qu'il aura fini.
    const recorder = recorderRef.current;
    if (!recorder) {
      if (enCoursRef.current) arretDemandeRef.current = true;
      return;
    }
    recorderRef.current = null;
    setEnregistre(false);
    recorder.stop();
  }, []);

  return { enregistre, transcrit, erreur, demarrer, arreter };
}
