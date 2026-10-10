import re

CRISIS = "crisis"
URGENT = "urgent_symptom"
MEDICATION = "medication"
DIAGNOSIS = "diagnosis"
OK = "ok"

_CRISIS_PATTERNS = [
    r"\bkill myself\b",
    r"\bend my life\b",
    r"\bsuicid",
    r"\bwant to die\b",
    r"\bdon'?t want to (live|be alive)\b",
    r"\bno reason to live\b",
    r"\bbetter off dead\b",
    r"\bself[-\s]?harm\b",
    r"\bhurt myself\b",
    r"\boverdose\b",
    r"\bend it all\b",
    r"\btake my own life\b",
]
_URGENT_PATTERNS = [
    r"\bchest pain\b",
    r"\bcan'?t breathe\b",
    r"\bcannot breathe\b",
    r"\bdifficulty breathing\b",
    r"\bsevere bleeding\b",
    r"\bcoughing blood\b",
    r"\bstroke\b",
    r"\bface (is )?droop",
    r"\bunconscious\b",
    r"\banaphylaxis\b",
    r"\bpassed out\b",
]
_MEDICATION_PATTERNS = [
    r"\bstop (taking |my )?(my )?(meds|medication|medicine)\b",
    r"\bchange my dose\b",
    r"\b(increase|decrease|double|halve) (my |the )?dose\b",
    r"\bprescri",
    r"\bwhat dosage\b",
    r"\bdosage should\b",
    r"\bshould i stop\b",
]
_DIAGNOSIS_PATTERNS = [
    r"\bdiagnos",
    r"\bdo i have\b",
    r"\bwhat disease\b",
    r"\bwhat condition do i\b",
    r"\bi have cancer\b",
    r"\btell me i have\b",
]


def _matches(text: str, patterns: list[str]) -> bool:
    lowered = text.lower()
    return any(re.search(pattern, lowered) for pattern in patterns)


def classify(text: str) -> str:
    if _matches(text, _CRISIS_PATTERNS):
        return CRISIS
    if _matches(text, _MEDICATION_PATTERNS):
        return MEDICATION
    if _matches(text, _URGENT_PATTERNS):
        return URGENT
    if _matches(text, _DIAGNOSIS_PATTERNS):
        return DIAGNOSIS
    return OK


def safety_reply(code: str) -> str:
    if code == CRISIS:
        return (
            "I'm really glad you said this. You deserve a real person with you right now. "
            "I am an AI companion, not an emergency service, a clinician, or a crisis line.\n\n"
            "If you may be in immediate danger, contact local emergency services now or ask someone nearby to stay with you. "
            "In India, the public emergency number is **112**.\n\n"
            "Publicly listed helplines you can try:\n"
            "- AASRA: 9820466726 (24/7)\n"
            "- iCall: 9152987821\n"
            "- Kiran mental health helpline: 1800-599-0019\n\n"
            "These numbers are widely published. Please confirm them locally if you can, because listings can change. "
            "I will not pretend to know that you are safe, and I cannot keep watch overnight.\n\n"
            "Would you like help thinking of one trusted person to contact, or would you rather keep talking while you reach out?"
        )
    if code == MEDICATION:
        return (
            "I can't advise you to start, stop, or change a medicine or a dose. That decision belongs with the clinician who knows your care.\n\n"
            "What I can do is help you prepare a clear question, such as: "
            "\"What would happen if we changed this dose, and what should I watch for?\"\n\n"
            "If you feel acutely unwell after a medicine, contact that clinician, a pharmacist, or local urgent care. "
            "Would you like help writing that question in your own words?"
        )
    if code == URGENT:
        return (
            "What you described may need prompt, in-person medical care. I can't tell what is causing it, and I won't guess a diagnosis.\n\n"
            "Please contact a clinician, urgent care, or local emergency services now — in India, **112** — especially if this is sudden, severe, or getting worse. "
            "If you can, ask someone you trust to stay with you.\n\n"
            "I can help you list what to tell them: when it started, how it changed, and any medicines you already take. "
            "Would that be useful while you arrange care?"
        )
    if code == DIAGNOSIS:
        return (
            "I can't diagnose you or say that you do or don't have a condition. I'm an AI companion, not a clinician, and a chat is not an examination.\n\n"
            "I can help you sort what you've noticed into questions for a qualified clinician. "
            "A useful starting question is: \"Which of these symptoms matter most, and what should I do while I wait to be seen?\"\n\n"
            "Would you like to build that question list, or would you rather talk through how this has been affecting your day?"
        )
    return ""
