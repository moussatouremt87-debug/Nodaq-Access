/**
 * Le menu du compte — qui je suis, et comment je sors.
 *
 * L'application a vécu jusqu'ici sans aucun moyen de se déconnecter :
 * `POST /api/auth/logout` existait côté serveur, rien ne l'appelait. Sur un
 * téléphone posé sur un chantier ou un poste partagé à l'atelier, la seule
 * façon de quitter une session était de vider les cookies du navigateur.
 *
 * Présent aux DEUX endroits — pied de la barre latérale sur ordinateur,
 * en-tête mince sur téléphone. Un bouton qui n'existerait que sur grand écran
 * ne réglerait rien pour l'artisan qui n'a pas d'ordinateur, et c'est
 * précisément lui qui travaille sur un appareil qu'on lui emprunte.
 */
import { useState } from 'react';
import { useLocation } from 'wouter';
import { LogOut, UserRound, ChevronsUpDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth, useDeconnexion } from '@/hooks/use-auth';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

/**
 * `barre` = pied de la barre latérale (ordinateur), `entete` = en-tête mince
 * (téléphone). Deux habillages, un seul comportement : la logique de sortie
 * ne se recopie pas.
 */
export function MenuUtilisateur({ variante }: { variante: 'barre' | 'entete' }) {
  const [, setLocation] = useLocation();
  const { data } = useAuth();
  const deconnexion = useDeconnexion();
  const [echec, setEchec] = useState<string | null>(null);

  // L'identité n'est lisible que lorsque le second facteur est franchi —
  // avant, `GET /api/auth/me` ne rend ni email ni nom (voir `AuthState`).
  // On affiche donc ce qu'on a, et JAMAIS on ne conditionne la sortie à la
  // présence d'un email : un compte bloqué à mi-parcours du second facteur
  // est exactement celui qui a besoin de pouvoir sortir.
  const identite = data?.authenticated === true && 'email' in data
    ? { nom: data.nom, email: data.email }
    : null;

  const sortir = () => {
    setEchec(null);
    deconnexion.mutate(undefined, {
      onSuccess: () => setLocation('/login'),
      onError: (e: unknown) =>
        setEchec(e instanceof Error ? e.message : 'Déconnexion impossible'),
    });
  };

  const enCours = deconnexion.isPending;

  return (
    <div className={variante === 'barre' ? 'px-3 pb-3' : undefined}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="menu-utilisateur"
            aria-label="Menu du compte"
            className={cn(
              'flex items-center gap-2 hover-elevate transition-colors',
              variante === 'barre'
                ? 'w-full rounded-lg border border-sidebar-border bg-sidebar-accent/50 px-3 py-2 text-left'
                // 44 px : la cible tactile minimale, la même que celle retenue
                // pour la barre du pouce.
                : 'h-9 min-w-[44px] justify-center rounded-md px-2',
            )}
          >
            <UserRound className="h-3.5 w-3.5 shrink-0 text-sidebar-primary" />
            {variante === 'barre' && (
              <>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[12px] font-medium text-sidebar-foreground/90">
                    {identite?.nom ?? 'Mon compte'}
                  </span>
                  {identite && (
                    <span className="block truncate text-[10px] text-sidebar-foreground/60">
                      {identite.email}
                    </span>
                  )}
                </span>
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60" />
              </>
            )}
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align={variante === 'barre' ? 'start' : 'end'} className="w-60">
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-[13px] font-medium">
              {identite?.nom ?? 'Mon compte'}
            </span>
            {identite && (
              <span className="block truncate text-[11px] text-muted-foreground">
                {identite.email}
              </span>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-testid="bouton-deconnexion"
            disabled={enCours}
            // `onSelect` et non `onClick` : Radix ferme le menu sur `onSelect`,
            // et un `onClick` sur l'élément laisserait le panneau ouvert
            // pendant la requête.
            onSelect={sortir}
            className="gap-2"
          >
            {enCours
              ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              : <LogOut className="h-3.5 w-3.5 shrink-0" />}
            <span className="text-[13px]">
              {enCours ? 'Déconnexion…' : 'Se déconnecter'}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* L'échec est dit là où le geste a eu lieu. Sans ça, un réseau coupé
          laisserait croire à une déconnexion réussie alors que la session
          reste ouverte côté serveur. */}
      {echec && (
        <p role="alert" className="mt-1 text-[11px] text-destructive">
          {echec}
        </p>
      )}
    </div>
  );
}
