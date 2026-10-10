PROMPT_VERSION = "hb-prompt-1.4"

TOPICS = [
    {"id": "anxiety", "label": "Anxiety"},
    {"id": "sleep", "label": "Sleep"},
    {"id": "chronic-pain", "label": "Chronic pain"},
    {"id": "heart-health", "label": "Heart health"},
    {"id": "caregiving", "label": "Caregiving"},
    {"id": "grief", "label": "Grief"},
    {"id": "pregnancy", "label": "Pregnancy and early parenting"},
    {"id": "diabetes", "label": "Diabetes"},
    {"id": "nutrition", "label": "Food and energy"},
    {"id": "general-wellbeing", "label": "General wellbeing"},
]
TOPIC_IDS = [item["id"] for item in TOPICS]

REACTIONS = {
    "hear": "I hear you",
    "support": "Sending support",
    "helpful": "Helpful",
    "thanks": "Thank you for sharing",
}

STYLES = ["gentle", "straightforward", "step_by_step"]
INTENTS = ["listen", "plan", "info"]
LANGUAGES = ["en", "hi", "te"]
VISIBILITIES = ["public", "community", "private"]
APPOINTMENT_STATUSES = ["requested", "confirmed", "cancelled", "completed", "no_show"]
REPORT_REASONS = [
    "Harassment",
    "Privacy concern",
    "Medical misinformation",
    "Spam",
    "Other",
]

DEFAULT_CONSENTS = {
    "personalize_feed": True,
    "use_profile_in_ai": False,
    "appear_in_suggestions": False,
    "email_notifications": False,
    "product_updates": False,
    "reduced_motion": False,
    "low_bandwidth": False,
}

CONSENT_COPY = {
    "personalize_feed": {
        "title": "Topic-based For You feed",
        "description": "Use only the topics you select to shape For You. Private chats, messages, and journal entries are not used.",
    },
    "use_profile_in_ai": {
        "title": "Share selected profile details with the assistant",
        "description": "When this is on, a chat can use your display name, language, and selected topics. Each chat can still opt out.",
    },
    "appear_in_suggestions": {
        "title": "Appear in topic suggestions",
        "description": "Other members may see you because you selected similar topics. Health conditions are never inferred.",
    },
    "email_notifications": {
        "title": "Email notification preference",
        "description": "Saves your preference. This demo does not send email.",
    },
    "product_updates": {
        "title": "Product update preference",
        "description": "Saves your preference. This demo does not send product mail.",
    },
    "reduced_motion": {
        "title": "Reduce motion",
        "description": "Shortens animations in the interface on this account.",
    },
    "low_bandwidth": {
        "title": "Low-bandwidth mode",
        "description": "Hides feed images and keeps the connection status easy to see.",
    },
}

AVATAR_COLORS = ["#0f6e68", "#24527a", "#6d5b8e", "#8a5a44", "#3f6b5a"]
