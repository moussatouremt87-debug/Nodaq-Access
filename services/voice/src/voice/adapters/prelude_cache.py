"""The prelude, synthesised once and kept in memory (ticket 4.18, latence).

Between the debtor finishing their sentence and the agent's first sound there
are 1.15 s (Flash) to 1.79 s (v3): ~650 ms for the model to word the reply, then
the synthesiser's time to first byte. A phone conversation tolerates 200 à 500 ms.

That chain cannot be shortened. The output guards need the **whole** reply
before it is spoken, so streaming the model into the synthesiser is ruled out by
design — a guard that fires after half the sentence is already out is not a
guard.

So the silence is filled rather than removed, with the very thing a human puts
there. The audio exists before the call starts, so playing it costs nothing but
its own duration.

**In memory, never on disk.** A container's filesystem is ephemeral; nothing
durable is written to it. The cache lives and dies with the process, and
`warm_up()` rebuilds it on the next start.
"""

from __future__ import annotations

from voice.core.interfaces import TextToSpeech

#: Ce que l'agent dit pendant que le modèle cherche.
#:
#: Court volontairement. L'amorce doit couvrir l'attente sans la dépasser : trop
#: longue, elle ferait patienter après que la réponse est prête, et on aurait
#: remplacé un silence par une lenteur.
#:
#: Le texte est ici et non chez le modèle, et c'est délibéré. Ce n'est pas une
#: réplique — c'est un son de remplissage, qui doit être IDENTIQUE à chaque fois
#: pour être mis en cache. Le faire formuler coûterait exactement la latence
#: qu'il sert à masquer.
TEXTE_AMORCE = "Alors… euh,"


class PreludeNotReadyError(RuntimeError):
    """Jouée avant d'avoir été préparée. Jamais silencieusement ignorée."""


class CachedPrelude:
    """Implements `voice.core.conversation.Prelude`.

    Deux temps, et la séparation est le point : `warm_up()` paie la synthèse au
    démarrage du worker, `play()` ne fait que rejouer des octets. Si la
    préparation se faisait à la première utilisation, le premier appel de la
    journée porterait tout le retard — c'est-à-dire précisément l'appel qu'on
    voulait rendre naturel.
    """

    #: Au-delà, l'amorce dure plus longtemps que le blanc qu'elle couvre.
    #:
    #: C'est le piège de ce dispositif, et il a failli être adopté : une amorce
    #: en `eleven_v3` sonne mieux mais dure 1,60 s pour 1,15 s de blanc. Quand le
    #: modèle répond normalement, la réplique est prête avant la fin de l'amorce
    #: et doit l'attendre — le remède devient le goulot, et l'agent finit plus
    #: lent qu'avant le correctif.
    #:
    #: La borne est haute (1,15 s, le blanc mesuré) : elle n'existe pas pour
    #: régler finement, mais pour empêcher la faute grossière. Voir
    #: `docs/adr/003-latence-agent-vocal.md`.
    DUREE_MAX_SECONDES = 1.15

    def __init__(self, tts: TextToSpeech, *, texte: str = TEXTE_AMORCE) -> None:
        self._tts = tts
        self._texte = texte
        self._morceaux: list[bytes] | None = None

    async def warm_up(self) -> None:
        """Synthétise l'amorce une fois. À appeler au démarrage, hors appel."""
        morceaux = [m async for m in self._tts.synthesize(self._texte) if m]
        if not morceaux:
            raise PreludeNotReadyError("la synthèse de l'amorce n'a rendu aucun octet")

        duree = sum(len(m) for m in morceaux) / 8000
        if duree > self.DUREE_MAX_SECONDES:
            # Refusé AU DÉMARRAGE, pas en appel : c'est le seul moment où l'on
            # peut encore corriger sans que quelqu'un l'entende. Une amorce trop
            # longue ne casse rien de visible — elle rend juste l'agent plus
            # lent, silencieusement, ce qui est exactement le genre de
            # régression que personne ne remarque avant six mois.
            raise PreludeNotReadyError(
                f"l'amorce dure {duree:.2f} s pour un blanc de "
                f"{self.DUREE_MAX_SECONDES:.2f} s : elle ferait attendre la réplique "
                f"au lieu de la couvrir (voir docs/adr/003-latence-agent-vocal.md)"
            )
        self._morceaux = morceaux

    @property
    def est_prete(self) -> bool:
        return self._morceaux is not None

    @property
    def octets(self) -> int:
        """Taille de l'amorce. En µ-law 8 kHz, un octet = 125 µs de son."""
        return sum(len(m) for m in self._morceaux or [])

    @property
    def duree_secondes(self) -> float:
        """Ce que l'amorce couvre réellement — donc ce qu'elle masque."""
        return self.octets / 8000

    async def play(self) -> str:
        """Rejoue les octets déjà en mémoire. Aucun appel réseau.

        Lève plutôt que de se taire si le cache est vide : une amorce
        silencieusement absente rendrait le blanc à la conversation sans que
        personne ne s'en aperçoive avant d'écouter un enregistrement.
        """
        if self._morceaux is None:
            raise PreludeNotReadyError("warm_up() n'a pas été appelé")
        for _morceau in self._morceaux:
            # Le puits audio réel arrive avec LiveKit (lot 6). Ici on parcourt
            # le cache : ce que ce module garantit, c'est qu'aucune synthèse
            # n'a lieu pendant l'appel.
            pass
        return self._texte
