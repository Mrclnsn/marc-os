"""Marc OS: akkoord via WhatsApp (gesprek 13).

Berichten als "ja", "ja 12", "ja alles" of "nee 12: te vroeg" in de WhatsApp-chat met Hermes worden hier
afgevangen voordat het model ze ziet, en doorgestuurd naar Marc OS (/api/whatsapp/akkoord) met een eigen sleutel.
Marc OS beslist of het een besluit over een voorstel is en voert het uit; het antwoord gaat terug naar WhatsApp.
Is het geen besluit (bijv. "ja graag, en ..."), dan krijgt Hermes het bericht gewoon.

Waarom zo: Hermes (het model) kan zelf niets goedkeuren. Deze plugin draait alleen in de gateway, na de toegangscontrole
(alleen Marc's eigen nummer staat in de allowlist), en het model heeft geen terminal of netwerk-tools om de sleutel te
gebruiken. Alleen standaardbibliotheek, geen extra pakketten.
"""

import json
import logging
import os
import re
import urllib.error
import urllib.request

logger = logging.getLogger("plugins.marcos-akkoord")

_URL = os.environ.get("MARC_OS_URL", "http://app:3000").rstrip("/") + "/api/whatsapp/akkoord"
# Alleen berichten die met een akkoord- of afwijswoord beginnen; Marc OS bepaalt of het echt een besluit is
_WORDS = re.compile(r"^\s*(ja|akkoord|ok|oké|oke|prima|doen|goedgekeurd|nee|afwijzen|afgewezen|niet doen)(?=$|[\s,:#.!?])", re.IGNORECASE)

_UNREACHABLE = (
    "Marc OS is nu niet bereikbaar, dus ik kan niets goedkeuren of afwijzen. "
    "Probeer het zo opnieuw, of doe het in de app (Hermes → Akkoord)."
)


def _allowlist_open() -> bool:
    allowed = (os.environ.get("WHATSAPP_ALLOWED_USERS") or "").strip()
    return allowed == "*" or (os.environ.get("WHATSAPP_ALLOW_ALL_USERS") or "").lower() in ("1", "true", "yes")


def _consume(session_key=None, platform=None, source=None, message_id=None, text=None, **kwargs):
    if platform != "whatsapp" or not text or not _WORDS.match(text):
        return None
    src = source or {}
    if (src.get("chat_type") or "dm") != "dm":
        return None
    token = os.environ.get("MARC_OS_WHATSAPP_TOKEN") or ""
    if len(token) < 24:
        logger.warning("MARC_OS_WHATSAPP_TOKEN ontbreekt; akkoord via WhatsApp staat uit")
        return None
    if _allowlist_open():
        # Iedereen mag met Hermes praten: dan nooit iets goedkeuren via WhatsApp
        return {"action": "handled", "reply": "Akkoord via WhatsApp staat uit: de allowlist van Hermes is open. Keur goed in de app."}

    body = json.dumps({"text": text[:500], "messageId": message_id}).encode("utf-8")
    req = urllib.request.Request(
        _URL,
        data=body,
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as res:
            data = json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        logger.warning("Marc OS weigerde het akkoord: HTTP %s", e.code)
        if e.code == 401:
            return {"action": "handled", "reply": "Marc OS herkent de sleutel van WhatsApp niet (WHATSAPP_APPROVE_TOKEN). Keur goed in de app."}
        return {"action": "handled", "reply": _UNREACHABLE}
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        logger.warning("Marc OS niet bereikbaar voor akkoord: %s", e)
        return {"action": "handled", "reply": _UNREACHABLE}

    if not data.get("handled"):
        return None
    reply = data.get("reply")
    return {"action": "handled", "reply": reply if isinstance(reply, str) else ""}


def register(ctx):
    ctx.register_hook("post_gateway_admission", _consume)
