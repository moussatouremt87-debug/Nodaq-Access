import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Radio, ShieldCheck, Building2, Check, ChevronsUpDown, Loader2, Sparkles, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_SECTIONS, MOBILE_NAV, navIsActive, verticalizeNavLabel } from '@/lib/nav';
import { TopRibbon } from './top-ribbon';
import { ThemeToggle } from './theme-toggle';
import { useModeInterface, visibleDansMode } from '@/contexts/mode-interface';
import { useAuth, useLectureSeule } from '@/hooks/use-auth';
import { useVertical } from '@/hooks/use-vertical';
import { routeOuverteEnLectureSeule, routeOuverteAuComptable } from '@nodaq/shared';
import { useMesEspaces, useBasculerEspace, type Espace } from '@/hooks/use-cabinet';
import { useModules, cheminsDeModulesEteints } from '@/hooks/use-modules';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import type { AffaireWords, Vertical } from '@nodaq/shared';
import type { NavItem } from '@/lib/nav';
import { MicroFlottant } from '@/components/micro-flottant';
import { MenuUtilisateur } from '@/components/menu-utilisateur';
import { BanniereSiren } from '@/components/banniere-siren';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data } = useAuth();
  const { vertical, words, proposalWord } = useVertical();
  const { estMultiEspaces } = useMesEspaces();
  const lectureSeule = useLectureSeule();
  const { data: modules } = useModules();
  const masquesParModule = cheminsDeModulesEteints(modules);
  const role = data?.authenticated === true && 'role' in data ? data.role : undefined;
  const { mode, basculerMode, afficherTout, toutAfficher } = useModeInterface();
  const peutVoir = (
    item: Pick<NavItem, 'href' | 'requiredRoles' | 'visibleForVertical' | 'essentiel'>,
  ) =>
    // US-A8.4 — le mode simplifié est UNE CLAUSE de plus ici, et rien d'autre.
    // Pas de second menu, pas de seconde coquille : c'est ce que le point
    // d'attention de la story appelle « un habillage ». Ce qui est essentiel
    // est déclaré sur l'entrée elle-même, jamais listé ici.
    visibleDansMode(item, mode, afficherTout)
    && (!item.requiredRoles || (role !== undefined && item.requiredRoles.includes(role)))
    && (!item.visibleForVertical || item.visibleForVertical(vertical as Vertical | undefined))
    // US-A5.4 — un tiers de confiance ne voit que le dossier financier.
    // Liste lue depuis @nodaq/shared, jamais recopiée ici : c'est la même
    // décision que celle appliquée par le serveur, pas une seconde à tenir
    // à jour.
    && (!lectureSeule || routeOuverteEnLectureSeule(item.href))
    // Le comptable ne voit que sa matière. Même principe : la liste vient de
    // @nodaq/shared, jamais recopiée ici. Ce filtre n'est PAS la protection —
    // elle est côté serveur — il évite seulement d'afficher un lien qui
    // répondrait 403.
    && (role !== 'ACCOUNTANT' || routeOuverteAuComptable(item.href))
    // US-A5.2 — `/cabinet` n'a de sens que pour un utilisateur qui a
    // PLUSIEURS espaces. Filtre local plutôt qu'un nouveau prédicat générique
    // dans `NavItem` : un seul cas, et il ne dépend ni du rôle ni du secteur.
    && (item.href !== '/cabinet' || estMultiEspaces)
    // Registre 3.11 — un module éteint retire sa page du menu. L'état vient
    // du SERVEUR (`GET /modules`), qui seul connaît le secteur du tenant et
    // donc les défauts applicables ; le recalculer ici ferait deux vérités.
    //
    // Ce n'est pas une frontière de sécurité : la route reste atteignable par
    // son URL, avec ses contrôles d'accès inchangés.
    && !masquesParModule.has(item.href);

  return (
    <div className="min-h-[100dvh] w-full text-foreground flex grain">
      {/* ── Ambient animated orbs (fixed, behind everything) ─────── */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0" aria-hidden>
        <div className="orb orb-1" />
        <div className="orb orb-2" />
        <div className="orb orb-3" />
      </div>

      {/* ── Desktop sidebar ──────────────────────────────────────── */}
      <aside className="hidden md:flex md:w-60 lg:w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground relative z-10">
        <div className="flex items-center gap-2.5 px-5 h-11 border-b border-sidebar-border">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <Radio className="h-4 w-4" strokeWidth={2.5} />
          </div>
          <div className="leading-none">
            <div className="font-semibold text-[15px] tracking-tight text-sidebar-foreground">
              NODAQ
            </div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/60 font-mono-nums">
              Cockpit v1.0
            </div>
          </div>
        </div>

        {/* US-A5.2 — bascule d'espace. Invisible pour un utilisateur
            mono-tenant, c'est-à-dire l'immense majorité. */}
        <EspaceSwitcher />

        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
          {NAV_SECTIONS.map(section => {
            const visibleItems = section.items.filter(peutVoir);
            if (visibleItems.length === 0) return null;
            return (
            <div key={section.label}>
              <div className="px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground/60 font-medium">
                {section.label}
              </div>
              <div className="space-y-0.5 mt-0.5">
                {visibleItems.map(item => {
                  const active = navIsActive(item.href, location);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      data-testid={item.testId}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover-elevate',
                        active
                          ? 'bg-sidebar-accent text-sidebar-primary'
                          : 'text-sidebar-foreground/70',
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 h-5 w-[3px] rounded-r-full bg-sidebar-primary" />
                      )}
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0',
                          active ? 'text-sidebar-primary' : 'text-sidebar-foreground/60',
                        )}
                        strokeWidth={2}
                      />
                      <span>{verticalizeNavLabel(item.href, item.label, words, proposalWord)}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
            );
          })}
          {/* US-A8.4, AC2 — la fonction avancée reste ACCESSIBLE, jamais
              supprimée. Le bouton ne vit que le temps de la session : le
              persister reviendrait à sortir du mode simplifié sans le dire. */}
          {mode === 'simplifie' && !afficherTout && (
            <button
              onClick={toutAfficher}
              data-testid="bouton-afficher-tout"
              className="w-full flex items-center gap-2 rounded-md px-3 py-2 text-[12px] text-sidebar-foreground/60 hover-elevate"
            >
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0" />
              Afficher toutes les fonctions
            </button>
          )}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          {/* La bascule vit ICI, à côté du thème, et pas dans l'écran
              Paramètres : celui-ci est réservé à l'OWNER, alors que le
              salarié peu à l'aise avec le numérique est souvent un MEMBER.
              Une préférence d'accessibilité qu'on ne peut pas atteindre soi-
              même ne sert à personne. */}
          <button
            onClick={basculerMode}
            data-testid="bascule-mode-interface"
            aria-pressed={mode === 'simplifie'}
            className="mb-2 w-full flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] text-sidebar-foreground/60 hover-elevate"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            {mode === 'simplifie' ? "Revenir à l'affichage complet" : 'Passer en affichage simplifié'}
          </button>
          <div className="rounded-lg bg-sidebar-accent px-3 py-2.5 flex items-center gap-2.5">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-pulse-dot absolute inline-flex h-full w-full rounded-full bg-sidebar-primary" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-sidebar-primary" />
            </span>
            <div className="text-[11px] leading-tight flex-1">
              <div className="font-medium text-sidebar-foreground/90">
                Système opérationnel
              </div>
              <div className="text-sidebar-foreground/60 font-mono-nums">
                Synchronisé
              </div>
            </div>
            <ThemeToggle />
          </div>
          {/* MFA (ticket 4.15) — accessible à tous les rôles : OWNER/ACCOUNTANT
              y sont déjà passés de force à la connexion, MEMBER peut l'activer
              volontairement même si rien ne l'y oblige. */}
          <Link
            href="/mfa"
            className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] text-sidebar-foreground/60 hover-elevate"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Sécurité du compte
          </Link>
        </div>
        <MenuUtilisateur variante="barre" />
      </aside>

      {/* ── Right column: ribbon + main content ──────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col relative z-10">
        {/* Mobile : en-tête mince en haut, navigation FIXE en bas (4.20) */}
        <MobileNav location={location} peutVoir={peutVoir} words={words} proposalWord={proposalWord} />

        {/* Desktop top ribbon (desktop only, sticky top-0, h-11) */}
        <TopRibbon />

        {/* La réserve du bas laisse passer la barre du pouce : sans elle, la
            dernière ligne de chaque écran serait recouverte, et sur une liste
            c'est exactement l'élément qu'on cherchait à atteindre. */}
        <main className="flex-1 min-w-0 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
          {/* Ticket 4.36 — monté ici, donc présent sur toutes les pages : le
              refus d'émettre tombe sur l'écran des devis et sur celui des
              factures, pas sur le cockpit. Il se tait de lui-même quand le
              SIRET est là, et le cockpit l'exclut lui-même. */}
          <BanniereSiren />
          {children}
          {/* Monté ICI, en fin de page — donc présent sur TOUTES les pages,
              après leur contenu. Le poser page par page garantirait qu'on en
              oublie une. Volontairement PAS en `position: fixed` : un bouton
              flottant de cette taille n'a pas de zone du bas systématiquement
              vide à recouvrir sans cacher du texte. */}
          <MicroFlottant />
        </main>
      </div>
    </div>
  );
}

/**
 * Bascule d'espace (US-A5.2). Rendu seulement si l'utilisateur a PLUSIEURS
 * espaces — sinon il n'y a rien à choisir, et un sélecteur à une entrée est du
 * bruit sur l'écran de tout le monde.
 *
 * La bascule change le tenant de la session côté serveur ; `useBasculerEspace`
 * vide l'intégralité du cache, et on repart du cockpit plutôt que de rester
 * sur un écran qui pourrait ne pas exister (ou ne pas être autorisé) dans le
 * nouvel espace.
 */
function EspaceSwitcher() {
  const [, setLocation] = useLocation();
  const { data } = useAuth();
  const { espaces, estMultiEspaces } = useMesEspaces();
  const basculer = useBasculerEspace();

  if (!estMultiEspaces) return null;

  const tenantCourant = data?.authenticated === true && 'tenantId' in data ? data.tenantId : undefined;
  const courant = espaces.find(e => e.tenantId === tenantCourant);

  const choisir = (espace: Espace) => {
    if (espace.tenantId === tenantCourant) return;
    basculer.mutate(espace.tenantId, { onSuccess: () => setLocation('/') });
  };

  return (
    <div className="px-3 pt-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="espace-switcher"
            disabled={basculer.isPending}
            className="w-full flex items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/50 px-3 py-2 text-left hover-elevate transition-colors"
          >
            {basculer.isPending
              ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sidebar-primary" />
              : <Building2 className="h-3.5 w-3.5 shrink-0 text-sidebar-primary" />}
            <span className="flex-1 min-w-0">
              <span className="block truncate text-[12px] font-medium text-sidebar-foreground/90">
                {courant?.tenantNom ?? 'Espace courant'}
              </span>
              {courant && (
                <span className="block truncate text-[10px] text-sidebar-foreground/60">
                  {courant.secteurLabel}
                </span>
              )}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          {espaces.map(espace => (
            <DropdownMenuItem
              key={espace.tenantId}
              onSelect={() => choisir(espace)}
              className="gap-2"
            >
              <Check
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  espace.tenantId === tenantCourant ? 'opacity-100' : 'opacity-0',
                )}
              />
              <span className="flex-1 min-w-0">
                <span className="block truncate text-[13px]">{espace.tenantNom}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {espace.secteurLabel}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * La navigation mobile — ticket 4.20.
 *
 * ── Pourquoi elle est EN BAS ───────────────────────────────────────────────
 * Sur un téléphone de six pouces tenu à une main, le haut de l'écran demande
 * de changer de prise. L'artisan visé a une main occupée : la navigation
 * descend là où le pouce arrive, et les cibles font 44 px de côté — la borne
 * d'Apple, et celle qui compte avec des gants.
 *
 * ── Quatre entrées, et TOUT le reste derrière « Plus » ────────────────────
 * La version précédente alignait quatorze entrées dans une bande à faire
 * défiler horizontalement : on n'y trouvait que ce qu'on savait déjà
 * chercher, et les trente-trois autres écrans n'étaient atteignables qu'en
 * tapant l'URL. « Plus » ouvre le menu COMPLET (`NAV_SECTIONS`), le même que
 * celui du bureau. `nav.test.ts` en fait une garde.
 *
 * `pb-[env(safe-area-inset-bottom)]` : sur les iPhone récents, la barre
 * passerait sinon sous l'indicateur d'accueil.
 */
function MobileNav({
  location,
  peutVoir,
  words,
  proposalWord,
}: {
  location: string;
  peutVoir: (item: { href: string; requiredRoles?: readonly string[] }) => boolean;
  words: AffaireWords;
  proposalWord: string;
}) {
  const [menuOuvert, setMenuOuvert] = useState(false);

  const caseDeBarre =
    'flex flex-1 flex-col items-center justify-center gap-1 min-h-[44px] px-1 py-2 text-[11px] font-medium';

  return (
    <>
      {/* En-tête mince : la marque, et le thème. La navigation, elle, est en bas. */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between border-b border-sidebar-border bg-sidebar px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <Radio className="h-4 w-4" strokeWidth={2.5} />
          </div>
          <span className="text-sm font-semibold tracking-tight">NODAQ</span>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <MenuUtilisateur variante="entete" />
        </div>
      </div>

      {/* La barre du pouce. `fixed` et non `sticky` : elle doit rester
          atteignable même au milieu d'une longue liste. */}
      <nav
        aria-label="Navigation principale"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)]"
      >
        {MOBILE_NAV.filter(peutVoir).map(item => {
          const active = navIsActive(item.href, location);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                caseDeBarre,
                active ? 'text-sidebar-primary' : 'text-sidebar-foreground/60',
              )}
              data-testid={`nav-mobile-${item.href}`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="truncate max-w-full">
                {verticalizeNavLabel(item.href, item.label, words, proposalWord)}
              </span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setMenuOuvert(true)}
          aria-haspopup="dialog"
          className={cn(caseDeBarre, 'text-sidebar-foreground/60')}
          data-testid="nav-mobile-plus"
        >
          <Menu className="h-5 w-5 shrink-0" />
          <span>Plus</span>
        </button>
      </nav>

      {/* Le menu complet, en feuille basse : elle s'ouvre sous le pouce. */}
      <Sheet open={menuOuvert} onOpenChange={setMenuOuvert}>
        <SheetContent side="bottom" className="md:hidden max-h-[85vh] overflow-y-auto bg-sidebar">
          <SheetHeader className="text-left">
            <SheetTitle>Toutes les fonctions</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-5 pb-[env(safe-area-inset-bottom)]">
            {NAV_SECTIONS.map(section => {
              const visibles = section.items.filter(peutVoir);
              if (visibles.length === 0) return null;
              return (
                <div key={section.label}>
                  <div className="px-1 pb-1 text-[11px] uppercase tracking-wider text-sidebar-foreground/60">
                    {section.label}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {visibles.map(item => {
                      const Icon = item.icon;
                      const active = navIsActive(item.href, location);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setMenuOuvert(false)}
                          className={cn(
                            'flex min-h-[44px] items-center gap-2 rounded-md px-3 py-2 text-sm hover-elevate',
                            active
                              ? 'bg-sidebar-accent text-sidebar-primary'
                              : 'text-sidebar-foreground/80',
                          )}
                          data-testid={`nav-feuille-${item.href}`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          {/* Le libellé passe à la ligne plutôt que d'être
                              tronqué : dans un menu, « Compte de résult… » est
                              une information perdue, pas une élégance. */}
                          <span className="leading-tight">
                            {verticalizeNavLabel(item.href, item.label, words, proposalWord)}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
