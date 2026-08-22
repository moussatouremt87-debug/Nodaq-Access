/**
 * « Il vous manque votre numéro SIREN » — ticket 4.36, lot A, côté écran.
 *
 * ── Expliquer AVANT, pas refuser APRÈS ────────────────────────────────────
 * `REGLES_MENTIONS` refuse déjà l'émission sans SIRET, et c'est elle qui fait
 * foi — ce bandeau ne re-vérifie rien, il ne fait que dire à l'avance ce que
 * l'utilisateur découvrirait sinon après avoir rempli un devis entier.
 *
 * Le texte vient du SERVEUR (`messageSiren`), pas d'ici : il dépend du stade
 * déclaré à l'inscription, et le recalculer côté écran ferait deux vérités à
 * maintenir — celle qui bloque et celle qui explique.
 *
 * ── Ce que ce bandeau ne fait pas ─────────────────────────────────────────
 * Il ne bloque rien, il ne s'impose pas au-dessus du contenu, et il se ferme.
 * Un compte en cours d'immatriculation vivra des semaines avec ce message :
 * un bandeau qu'on ne peut pas taire deviendrait du bruit, puis un bandeau
 * qu'on n'ouvre plus jamais.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info, X } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { apiFetch } from '@/lib/auth';

const CLE_MASQUAGE = 'nodaq.siren.masque-le';
/** Masquer, pas supprimer : le message revient au bout d'une semaine. */
const DUREE_MASQUAGE_MS = 7 * 24 * 60 * 60 * 1000;

function masqueEncoreValide(): boolean {
  const brut = localStorage.getItem(CLE_MASQUAGE);
  if (!brut) return false;
  const quand = Number(brut);
  if (!Number.isFinite(quand)) return false;
  return Date.now() - quand < DUREE_MASQUAGE_MS;
}

export function BanniereSiren() {
  const [masque, setMasque] = useState(() => masqueEncoreValide());
  const [chemin] = useLocation();

  const { data } = useQuery({
    queryKey: ['/api/onboarding/qualification'],
    queryFn: async () => {
      const res = await apiFetch('/api/onboarding/qualification');
      if (!res.ok) return null;
      return (await res.json()) as { peutEmettre?: boolean; messageSiren?: string | null };
    },
    staleTime: 5 * 60 * 1000,
  });

  // Quatre raisons de ne rien afficher, et la plus importante est la garde sur
  // `data` : une réponse absente ou malformée ne doit RIEN casser. Un bandeau
  // a déjà fait tomber le cockpit entier faute de cette garde.
  if (masque) return null;
  if (!data || data.peutEmettre !== false) return null;
  if (!data.messageSiren) return null;
  // Le cockpit porte déjà l'appel « compléter le profil », avec ses deux
  // actions. Le doublon exact, à dix centimètres d'écart, apprend au lecteur
  // à ignorer les deux. L'apport de ce bandeau est ailleurs : sur les écrans
  // de devis et de factures, là où le refus tombera.
  if (chemin === '/') return null;

  return (
    <div
      className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-sm"
      data-testid="banniere-siren"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <p className="min-w-0 flex-1">
        {data.messageSiren}{' '}
        <Link
          href="/onboarding"
          className="font-medium underline underline-offset-2"
          data-testid="banniere-siren-lien"
        >
          Le saisir maintenant
        </Link>
      </p>
      <button
        type="button"
        onClick={() => {
          localStorage.setItem(CLE_MASQUAGE, String(Date.now()));
          setMasque(true);
        }}
        aria-label="Masquer ce message"
        className="rounded p-0.5 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
