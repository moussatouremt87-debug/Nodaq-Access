"""Conversation driver for a dunning call (ticket 4.18, US-2 to US-7).

**This module holds no business rules.** Whether an instalment may be granted,
how many nudges are allowed, what the mandate permits — all of that lives in
`lib/shared` on the TypeScript side, is tested there, and is reached through
`MandateGateway`. Re-deriving any of it here would create a second source of
truth, and the permissive one always wins the day the two drift.

**It holds no wording either.** What the agent *says* comes from the model,
through `Phrasing`. The driver decides the conversational move — ask for a
date, offer the instalments that were granted, recap before hanging up — and
hands over the facts that move is allowed to mention. The model turns that into
spoken French; `lib/shared/src/formulation.ts` guards what comes back.

That split is the whole point of this file. Lines written here would recite:
same word in the same place on every call, no reaction to what the person just
said. A debtor hears that within two turns. The driver conducts; the model
speaks.

Two things stay deliberately out of the model's hands:

* **The opening announcement.** It comes from the gateway (`opening_line`),
  produced word for word by `annonceOuverture()`. US-2 makes it a transparency
  obligation, and an announcement a model may rephrase is one that can, one
  day, stop announcing.
* **Every figure.** Amounts, instalment counts and delays reach the model as
  *facts*; it may repeat them and nothing else. That is CLAUDE.md rule 3, and
  `chiffresInventes` enforces it on the way back.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Literal, Protocol

from voice.core.interfaces import SpeechToText, TelephonyProvider, TextToSpeech


class Outcome(StrEnum):
    """Business outcome of the conversation (US-6).

    Mirrors `ISSUES_APPEL` in `lib/shared/src/decisionAppel.ts`. Duplicated as
    a value list — not as logic — because the two runtimes must name the same
    things; `tests/test_outcomes_parity.py` fails if they drift.
    """

    PROMISE = "promise"
    DISPUTE = "dispute"
    CALLBACK_REQUESTED = "callback_requested"
    UNREACHABLE = "unreachable"
    REFUSED = "refused"
    PAID_CLAIMED = "paid_claimed"


class Intent(StrEnum):
    """A conversational move the model may put into words.

    Mirrors `INTENTIONS_REPLIQUE` in `lib/shared/src/formulation.ts`, values
    included — the string is what travels over the wire, so a drift would be a
    404 on a live call. `tests/test_intents_parity.py` fails if the two lists
    stop matching.

    There is no entry for the opening announcement, and that absence is the
    rule, not an oversight (US-2 — see the module docstring).
    """

    ASK_DATE = "demander_date"
    OFFER_INSTALMENTS = "offrir_echelonnement"
    DECLINE_AND_FORWARD = "refuser_et_transmettre"
    RECAP_PROMISE = "recapituler_promesse"
    CLOSE_DISPUTE = "clore_contestation"
    CLOSE_PAID_CLAIMED = "clore_paiement_annonce"
    CLOSE_HUMAN_REQUESTED = "clore_rappel_humain"
    CLOSE_OPT_OUT = "clore_opposition"


@dataclass(frozen=True, slots=True)
class Turn:
    """One thing that was said, by one of the two parties.

    The history is what lets the model *react* instead of reciting. It is sent
    to the formulation route and never written to a log — CLAUDE.md rule 6
    forbids conversation verbatim in logs.
    """

    speaker: Literal["agent", "debiteur"]
    text: str


@dataclass(frozen=True, slots=True)
class InstalmentDecision:
    """What the decision core answered about an instalment request.

    `granted` false means the agent must not concede anything — it takes note
    and closes. The reason is *not* repeated to the debtor: telling someone
    "my owner disabled this for your campaign" exposes an internal setting and
    invites an argument the agent is forbidden to have. That is why the reason
    never reaches `facts` either — the model cannot voice what it never sees.
    """

    granted: bool
    instalments: int = 0
    first_payment_in_days: int = 0


class MandateGateway(Protocol):
    """The only door to the business rules. Implemented over HTTP in production."""

    async def may_nudge(self, nudges_so_far: int) -> bool: ...

    async def decide_instalment(
        self, *, instalments: int, first_payment_in_days: int, last_payment_late_days: int
    ) -> InstalmentDecision: ...

    async def opening_line(self) -> str: ...


#: Les mouvements devant lesquels quelqu'un marquerait un temps.
#:
#: Mesuré, pas supposé : entre la fin de la phrase du débiteur et le premier son
#: de l'agent, il s'écoule ~650 ms pour que le modèle formule, plus ~505 ms
#: (Flash) ou ~1 139 ms (v3) pour que la synthèse rende son premier octet. Soit
#: 1,15 s à 1,79 s de silence — là où une conversation humaine tolère 200 à
#: 500 ms. Passé ce délai l'autre relance (« allô ? ») ou se demande à qui il
#: parle.
#:
#: On ne peut pas raccourcir la chaîne : les gardes de `formulation.ts` exigent
#: la réplique ENTIÈRE avant de la prononcer, donc streamer le modèle vers la
#: synthèse est exclu par construction. Une garde qui s'applique après que la
#: moitié de la phrase est déjà sortie n'est pas une garde.
#:
#: Ce qu'on peut faire, c'est REMPLIR ce silence — et le remplir par exactement
#: ce qu'un humain y met : une hésitation. L'amorce est déjà synthétisée, donc
#: elle démarre en zéro milliseconde.
#:
#: Restreint à ces deux moments, et c'est le fond de l'affaire. L'agent hésite
#: quand il va chercher quelque chose : ce qu'il a le droit d'accorder, ce qui
#: vient d'être convenu. Il n'hésite pas en se présentant — les premières
#: secondes décident si l'appel passe pour une arnaque — ni en prenant congé,
#: où l'hésitation s'entend comme de la réticence. Et pas à chaque tour : un
#: agent qui hésite tout le temps est une caricature, qui sonne plus faux qu'un
#: agent neutre.
INTENTS_AVEC_AMORCE = frozenset({Intent.OFFER_INSTALMENTS, Intent.RECAP_PROMISE})


class AudioSink(Protocol):
    """Où la voix de l'agent sort réellement.

    Jusqu'au lot 6, `_speak` parcourait les octets de la synthèse et les jetait :
    le puits n'existait pas encore. Il est branché ici sur la session média
    Twilio, et reste optionnel — les évals tournent sans, en simulation.

    `cut` est ce qui rend l'interruption possible. Cesser d'envoyer ne suffit
    pas : ce qui a déjà été transmis à l'opérateur serait joué quand même.
    """

    async def play(self, audio: AsyncIterator[bytes]) -> None: ...

    async def cut(self) -> None: ...


class Prelude(Protocol):
    """Une amorce déjà synthétisée, jouable instantanément.

    Elle est produite UNE fois puis gardée en mémoire — jamais sur le disque :
    celui d'un conteneur est éphémère, et rien de durable ne s'y écrit.

    `play` rend le texte prononcé, pour que l'historique envoyé au modèle sache
    que l'agent vient de dire « alors, euh… ». Sans ça il reformulerait par
    dessus, et on entendrait deux hésitations d'affilée.
    """

    async def play(self) -> str: ...


class Phrasing(Protocol):
    """Turns a decided move into spoken French.

    Implemented over HTTP against `POST /relance/formulation`, which calls the
    model through `lib/llm` and checks the result before returning it. No
    fallback wording lives on this side: the route already answers with a safe
    line when the model fails or is unreachable, and a second copy here would
    be a second thing to keep in step.
    """

    async def line(
        self,
        intent: Intent,
        *,
        facts: Mapping[str, str],
        history: Sequence[Turn],
    ) -> str: ...


@dataclass
class CallState:
    """Everything the driver knows about the call in progress."""

    announced: bool = False
    nudges: int = 0
    promise_obtained: bool = False
    promise_confirmed: bool = False
    closure_requested: bool = False
    outcome: Outcome | None = None
    escalations: list[str] = field(default_factory=list)
    history: list[Turn] = field(default_factory=list)
    #: L'agent a-t-il la parole en ce moment ? Sert à ne couper que ce qui sort.
    speaking: bool = False


# Phrases the driver reacts to. Deliberately narrow: this is a fallback for the
# simulation harness and a safety net, never the primary understanding — that
# comes from the model, through the gateway.
_HUMAN_REQUESTED = ("parler à quelqu'un", "un humain", "une personne réelle")
_STOP_REQUESTED = ("ne me rappelez plus", "arrêtez de m'appeler", "rayez-moi")
_DISPUTE = ("je conteste", "je ne dois rien", "cette facture est fausse")
#: « je conteste PAS » contient « je conteste ». Sans cette exception, quelqu'un
#: qui dit exactement l'inverse serait classé en litige et l'appel clos sur une
#: contestation qu'il n'a pas faite. Trouvé par `test_call_loop.py`.
_DEMENTIS = ("conteste pas", "conteste rien", "ne conteste")
_ALREADY_PAID = ("j'ai déjà payé", "c'est déjà réglé", "j'ai fait le virement")


def _contains(text: str, needles: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(n in lowered for n in needles)


class DunningConversation:
    """Runs one call. Knows how to behave, not what to allow nor how to word it."""

    def __init__(
        self,
        *,
        stt: SpeechToText,
        tts: TextToSpeech,
        telephony: TelephonyProvider,
        gateway: MandateGateway,
        phrasing: Phrasing,
        prelude: Prelude | None = None,
        sink: AudioSink | None = None,
    ) -> None:
        self._stt = stt
        self._tts = tts
        self._telephony = telephony
        self._gateway = gateway
        self._phrasing = phrasing
        # Optionnelle : sans amorce le pilote fonctionne à l'identique, en
        # acceptant le silence. C'est ce que font les évals qui ne portent pas
        # sur la latence.
        self._prelude = prelude
        # Sans puits, la synthèse est consommée et jetée — c'est ce que font les
        # évals. Avec, la voix part vraiment sur la ligne.
        self._sink = sink
        self.state = CallState()

    async def _speak(self, line: str) -> None:
        """Synthesise one line, push it to the sink, remember it as a turn."""
        self.state.history.append(Turn(speaker="agent", text=line))
        if self._sink is not None:
            self.state.speaking = True
            try:
                await self._sink.play(self._tts.synthesize(line))
            finally:
                self.state.speaking = False
            return
        async for _chunk in self._tts.synthesize(line):
            pass

    async def barge_in(self) -> None:
        """Le débiteur reprend la parole : l'agent se tait immédiatement.

        Le ticket en fait une exigence non négociable, et c'est le comportement
        qui sépare un appel supportable d'un appel qu'on raccroche. La file de
        l'opérateur peut avoir plusieurs secondes d'avance : il faut la VIDER,
        pas seulement arrêter d'y écrire.
        """
        if self._sink is not None and self.state.speaking:
            await self._sink.cut()

    async def _say(self, intent: Intent, facts: Mapping[str, str] | None = None) -> str:
        """Have the model word this move, then speak it.

        Every spoken line goes through here. `test_no_literal_line.py` asserts
        that no string literal is ever handed to the synthesiser directly —
        without that guard, one hurried fix would quietly put a scripted phrase
        back into the call.

        The request is fired **before** the prelude plays, not after: the whole
        point is that the model thinks while the agent is already speaking. See
        `INTENTS_AVEC_AMORCE` for why only some moves get one.
        """
        demande = asyncio.ensure_future(
            self._phrasing.line(intent, facts=facts or {}, history=tuple(self.state.history))
        )
        # `ensure_future` PLANIFIE la requête, il ne la démarre pas : la coroutine
        # ne s'exécute qu'au prochain passage de la boucle. Sans cette main
        # rendue, elle ne partirait qu'une fois l'amorce terminée — les deux
        # délais s'additionneraient au lieu de se superposer, et on aurait rendu
        # l'agent plus lent en croyant l'accélérer.
        #
        # Trouvé par `test_la_demande_part_avant_que_l_amorce_joue`, qui observe
        # l'ORDRE réel plutôt que l'intention du code.
        await asyncio.sleep(0)
        try:
            if self._prelude is not None and intent in INTENTS_AVEC_AMORCE:
                # The prelude is audio that already exists, so it starts now —
                # no synthesis, no round-trip. What it costs is what it plays.
                self.state.history.append(
                    Turn(speaker="agent", text=await self._prelude.play())
                )
            line = await demande
        except BaseException:
            # Never leave the request dangling: an orphan task would resolve
            # into a line nobody speaks, and on a real call it would be billed.
            demande.cancel()
            raise
        await self._speak(line)
        return line

    def hear(self, utterance: str) -> None:
        """Record what the debtor said, so the model can react to it."""
        self.state.history.append(Turn(speaker="debiteur", text=utterance))

    async def announce(self) -> None:
        """Always first, and never skippable (US-2, AI Act transparency).

        The only line the model never writes. It comes from the decision core
        through the gateway, word for word.
        """
        await self._speak(await self._gateway.opening_line())
        self.state.announced = True

    async def close(self, outcome: Outcome) -> None:
        """Hang up — but never on an unconfirmed promise.

        US-3 is explicit: no promise is recorded without the debtor confirming
        the recap. Closing before that would leave a promise nobody made, and
        it would later be invoked in good faith against them.

        The one exception is a debtor who asked to stop: insisting on a recap
        at that point is exactly the harassment US-4 forbids.
        """
        if (
            self.state.promise_obtained
            and not self.state.promise_confirmed
            and not self.state.closure_requested
        ):
            raise RuntimeError(
                "closing on an unconfirmed promise — recap it first (US-3)"
            )
        self.state.outcome = outcome

    async def handle(self, utterance: str) -> None:
        """React to one thing the debtor said."""
        self.hear(utterance)

        if _contains(utterance, _STOP_REQUESTED):
            # Opt-out (US-7). Recorded by the caller; here the call simply ends.
            self.state.closure_requested = True
            await self._say(Intent.CLOSE_OPT_OUT)
            await self.close(Outcome.REFUSED)
            return

        if _contains(utterance, _HUMAN_REQUESTED):
            self.state.closure_requested = True
            self.state.escalations.append("rappel_humain")
            await self._say(Intent.CLOSE_HUMAN_REQUESTED)
            await self.close(Outcome.CALLBACK_REQUESTED)
            return

        if _contains(utterance, _DISPUTE) and not _contains(utterance, _DEMENTIS):
            # US-4: never argue. Record, close, hand to a human.
            self.state.closure_requested = True
            self.state.escalations.append("contestation")
            await self._say(Intent.CLOSE_DISPUTE)
            await self.close(Outcome.DISPUTE)
            return

        if _contains(utterance, _ALREADY_PAID):
            self.state.closure_requested = True
            self.state.escalations.append("paiement_annonce")
            await self._say(Intent.CLOSE_PAID_CLAIMED)
            await self.close(Outcome.PAID_CLAIMED)
            return

    async def nudge_for_date(self) -> bool:
        """Ask once more for a precise date. Returns False if the quota is spent.

        The quota is the gateway's answer, never a local counter compared to a
        local constant — that is the whole point of not duplicating rules.
        """
        if not await self._gateway.may_nudge(self.state.nudges):
            return False
        self.state.nudges += 1
        await self._say(Intent.ASK_DATE)
        return True

    async def request_instalments(
        self, *, instalments: int, first_payment_in_days: int, last_payment_late_days: int
    ) -> InstalmentDecision:
        """The debtor asked to pay in several times (US-3)."""
        decision = await self._gateway.decide_instalment(
            instalments=instalments,
            first_payment_in_days=first_payment_in_days,
            last_payment_late_days=last_payment_late_days,
        )

        if decision.granted:
            # The granted figures — and only those — are what the model may say.
            await self._say(
                Intent.OFFER_INSTALMENTS,
                {
                    "nombre_de_versements": str(decision.instalments),
                    "jours_avant_le_premier_versement": str(decision.first_payment_in_days),
                },
            )
        else:
            # NO facts. The refusal reason stays internal: the debtor hears a
            # neutral hand-off, the owner gets the detail in the cockpit. A
            # model cannot voice what it was never given.
            self.state.escalations.append("echelonnement_a_decider")
            await self._say(Intent.DECLINE_AND_FORWARD)
        return decision

    async def record_promise(self, *, amount_eur: str, date_label: str) -> None:
        """Take a promise and lock it by recap (US-3)."""
        self.state.promise_obtained = True
        await self._say(
            Intent.RECAP_PROMISE, {"montant": amount_eur, "date": date_label}
        )

    async def confirm_promise(self) -> None:
        """The debtor confirmed the recap. Only now is the promise real."""
        self.state.promise_confirmed = True

    async def run(self, turns: AsyncIterator[str]) -> Outcome:
        """Drive a whole call from the debtor's turns.

        Used by the simulation harness and the evals. Real calls drive the same
        methods from the LiveKit event loop.
        """
        await self.announce()
        async for utterance in turns:
            await self.handle(utterance)
            if self.state.outcome is not None:
                return self.state.outcome

        if self.state.promise_obtained and self.state.promise_confirmed:
            await self.close(Outcome.PROMISE)
            return Outcome.PROMISE

        await self.close(Outcome.UNREACHABLE)
        return Outcome.UNREACHABLE
