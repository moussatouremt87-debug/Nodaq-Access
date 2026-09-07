/**
 * Abonnement et facturation — /abonnement.
 *
 * ── POURQUOI CET ÉCRAN EXISTE, ALORS QUE L'ONGLET EXISTAIT DÉJÀ ─────────────
 *
 * Le contenu vivait — et vit toujours — dans Paramètres → Abonnement. Mais cet
 * onglet est un ÉTAT LOCAL, pas une adresse : on ne peut pas y renvoyer.
 *
 * Or c'est précisément là qu'on renvoie. Le refus d'écriture d'un abonnement
 * non activé dit « Activez-le dans Réglages → Abonnement », et l'artisan
 * devait le trouver seul, dans un écran à onglets, au moment où il est bloqué.
 * Une consigne qui désigne un endroit inaccessible en un clic n'est pas une
 * consigne, c'est une devinette.
 *
 * L'onglet reste et rend le même composant. Deux portes vers la même pièce ne
 * coûtent rien ; une pièce sans porte coûte un client.
 *
 * ── LE TITRE S'AFFICHE AVANT LES DONNÉES ────────────────────────────────────
 *
 * L'en-tête et le mot sur la facturation sont rendus TOUJOURS, même pendant le
 * chargement. Un écran qui n'affiche qu'un rectangle gris ne dit pas où l'on
 * est — et c'est l'audit d'accessibilité qui l'a signalé, en refusant d'auditer
 * une page sans substance.
 */
import { AbonnementTab } from '@/components/abonnement-tab';
import { PageHeader } from '@/components/page-header';
import { Receipt } from 'lucide-react';

export default function AbonnementPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Abonnement et facturation"
        description="Votre formule, ce qu'elle comprend, et ce qu'elle coûte."
      />

      <AbonnementTab />

      {/*
        * La facturation est ANNONCÉE, pas simulée.
        *
        * Il n'y a pas encore de paiement dans nodaq, donc pas de facture à
        * montrer. Afficher une section « Vos factures » vide laisserait croire
        * à une panne, ou pire, à des factures perdues. On dit ce qui est.
        */}
      <section className="rounded-lg border p-4" aria-labelledby="factures-titre">
        <h2 id="factures-titre" className="flex items-center gap-2 text-sm font-semibold">
          <Receipt className="h-4 w-4 text-muted-foreground" aria-hidden />
          Vos factures nodaq
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Le règlement en ligne n'est pas encore ouvert. Vos factures
          d'abonnement apparaîtront ici dès qu'il le sera, et vous pourrez les
          télécharger pour votre comptabilité.
        </p>
      </section>
    </div>
  );
}
