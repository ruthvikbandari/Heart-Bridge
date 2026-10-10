"""Fictional demo data. Re-running is safe: it skips work when Maya already exists."""

from datetime import timedelta

from sqlalchemy import select

from app.database import SessionLocal, utcnow
from app.models import (
    AIConversation,
    AIMessage,
    Appointment,
    AppointmentEvent,
    AvailabilitySlot,
    Bookmark,
    Comment,
    Community,
    CommunityEvent,
    CommunityResource,
    Conversation,
    Doctor,
    Follow,
    Membership,
    Message,
    Participant,
    Post,
    PostTopic,
    Profile,
    Reaction,
    User,
    UserInterest,
)
from app.security import hash_password
from app.services.common import set_consents

PASSWORD = "DemoPass123!"


def _user(db, email, name, role, color, bio, language="en"):
    user = User(
        email=email,
        password_hash=hash_password(PASSWORD),
        role=role,
        status="active",
        onboarded=True,
        created_at=utcnow() - timedelta(days=12),
    )
    db.add(user)
    db.flush()
    db.add(Profile(user_id=user.id, display_name=name, bio=bio, language=language, avatar_color=color))
    return user


def run() -> None:
    db = SessionLocal()
    try:
        existing = db.scalars(select(User).where(User.email == "maya@heartbridge.demo")).first()
        if existing is not None:
            print("Demo data already present.")
            return

        maya = _user(
            db,
            "maya@heartbridge.demo",
            "Maya Chen",
            "member",
            "#0f6e68",
            "Learning to ask for quiet company on hard mornings.",
        )
        arun = _user(
            db,
            "arun@heartbridge.demo",
            "Arun Desai",
            "member",
            "#24527a",
            "Caring for my father and trying to keep our routines gentle.",
            "hi",
        )
        leila = _user(
            db,
            "leila@heartbridge.demo",
            "Leila Okonkwo",
            "member",
            "#8a5a44",
            "Pacing a body that does not keep a tidy schedule.",
        )
        samir = _user(
            db,
            "samir@heartbridge.demo",
            "Samir Rao",
            "moderator",
            "#3f6b5a",
            "Community moderator. I look after reports, not medical advice.",
        )
        nila = _user(
            db,
            "admin@heartbridge.demo",
            "Nila Verma",
            "admin",
            "#6d5b8e",
            "Demo administrator for the moderation queue.",
        )
        aisha_user = _user(
            db,
            "aisha@heartbridge.demo",
            "Aisha Rahman",
            "clinician",
            "#24527a",
            "Sample clinician account linked to a fictional profile.",
        )

        interests = {
            maya.id: ["anxiety", "sleep"],
            arun.id: ["caregiving", "heart-health"],
            leila.id: ["chronic-pain", "sleep"],
            samir.id: ["general-wellbeing"],
            nila.id: ["general-wellbeing"],
            aisha_user.id: ["heart-health"],
        }
        for user_id, topics in interests.items():
            for topic in topics:
                db.add(UserInterest(user_id=user_id, topic=topic))

        for person, appear in ((maya, True), (arun, True), (leila, True), (samir, False), (nila, False), (aisha_user, False)):
            set_consents(
                db,
                person.id,
                {
                    "personalize_feed": True,
                    "use_profile_in_ai": person.id == maya.id,
                    "appear_in_suggestions": appear,
                    "reduced_motion": False,
                    "low_bandwidth": False,
                },
            )

        def community(slug, name, description, guidelines, topic, visibility="public", anonymous=False):
            row = Community(
                slug=slug,
                name=name,
                description=description,
                guidelines=guidelines,
                topic=topic,
                visibility=visibility,
                allow_anonymous=anonymous,
                created_at=utcnow() - timedelta(days=20),
            )
            db.add(row)
            db.flush()
            return row

        guide = "Be kind. No medical orders, no pressure to disclose, and no screenshots of someone else's story."
        anxiety = community(
            "anxiety-circle",
            "Anxiety Circle",
            "A public space for people who selected anxiety as a topic. Stories here are personal, not clinical advice.",
            guide,
            "anxiety",
            anonymous=True,
        )
        heart = community(
            "heart-and-home",
            "Heart and Home",
            "For people supporting someone through heart care, or living with it themselves.",
            guide,
            "heart-health",
        )
        pain = community(
            "pain-and-pacing",
            "Pain and Pacing",
            "A slower space for chronic pain, pacing, and cancelled plans.",
            guide,
            "chronic-pain",
            anonymous=True,
        )
        caregivers = community(
            "caregivers-table",
            "Caregivers Table",
            "Practical companionship for people looking after someone else.",
            guide,
            "caregiving",
        )
        private_group = community(
            "young-caregivers",
            "Young Caregivers Circle",
            "A private group. Discussions stay with members.",
            guide,
            "caregiving",
            visibility="private",
            anonymous=True,
        )

        def join(user, group, role="member", alias=None):
            db.add(
                Membership(
                    user_id=user.id,
                    community_id=group.id,
                    role=role,
                    status="member",
                    anonymous_name=alias,
                    created_at=utcnow() - timedelta(days=5),
                )
            )

        join(maya, anxiety, alias="Morning Maya")
        join(samir, anxiety, role="moderator")
        join(arun, heart)
        join(arun, caregivers)
        join(samir, caregivers, role="moderator")
        join(leila, pain, alias="L")
        join(samir, pain, role="moderator")
        join(arun, private_group)
        join(samir, private_group, role="moderator")

        db.add(
            CommunityResource(
                community_id=anxiety.id,
                title="WHO mental health topic index",
                url="https://www.who.int/health-topics/mental-health",
                summary="Public topic index. Not a diagnosis tool and not a HeartBridge endorsement of any treatment.",
                source_label="World Health Organization public page",
                last_reviewed="2026-10-03",
            )
        )
        db.add(
            CommunityResource(
                community_id=pain.id,
                title="A community note on pacing",
                url="",
                summary="Members wrote this reminder: pacing is a personal experiment, not a rule. It is not medical advice.",
                source_label="Community-written, not clinical guidance",
                last_reviewed="2026-09-12",
            )
        )
        db.add(
            CommunityEvent(
                community_id=anxiety.id,
                title="Quiet check-in",
                description="An optional text check-in hosted by moderators. Cameras off, no advice-giving.",
                starts_at=utcnow() + timedelta(days=4),
                created_by=samir.id,
            )
        )

        def post(author, body, topics, visibility="public", community_id=None, warning=None, anonymous=False, days=1):
            row = Post(
                author_id=author.id,
                community_id=community_id,
                body=body,
                visibility=visibility,
                content_warning=warning,
                is_anonymous=anonymous,
                created_at=utcnow() - timedelta(days=days),
                updated_at=utcnow() - timedelta(days=days),
            )
            db.add(row)
            db.flush()
            for topic in topics:
                db.add(PostTopic(post_id=row.id, topic=topic))
            return row

        maya_post = post(
            maya,
            "I get tired of explaining my anxiety to people who want a quick fix. Today I just wanted someone to hear that mornings are hard.",
            ["anxiety", "sleep"],
            days=2,
        )
        arun_post = post(
            arun,
            "Caring for my father after his heart procedure has made the house quiet. The clinic staff were kind. I still don't know how to answer when he asks if he can walk to the market.",
            ["caregiving", "heart-health"],
            days=1,
        )
        post(
            leila,
            "Chronic pain days make me cancel plans. I am learning that cancelling is not the same as not caring.",
            ["chronic-pain"],
            warning="Mentions pain",
            days=3,
        )
        post(maya, "A private note I am not ready to publish.", ["anxiety"], visibility="private", days=0)
        post(
            maya,
            "If you also rehearse conversations before you have them, you are welcome to sit with that here. No advice required.",
            ["anxiety"],
            visibility="community",
            community_id=anxiety.id,
            anonymous=True,
            days=1,
        )
        db.add(Reaction(post_id=maya_post.id, user_id=arun.id, reaction_type="hear"))
        db.add(Reaction(post_id=arun_post.id, user_id=maya.id, reaction_type="support"))
        db.add(
            Comment(
                post_id=arun_post.id,
                author_id=maya.id,
                body="The market question sounds tender and complicated. Thank you for trusting us with it.",
                created_at=utcnow() - timedelta(hours=8),
            )
        )
        db.add(Bookmark(user_id=maya.id, post_id=arun_post.id, created_at=utcnow()))
        db.add(Follow(follower_id=maya.id, followed_id=arun.id, created_at=utcnow()))

        chat = Conversation(created_by=arun.id, status="active", created_at=utcnow() - timedelta(days=1))
        db.add(chat)
        db.flush()
        db.add(Participant(conversation_id=chat.id, user_id=arun.id, unread=0, muted=False))
        db.add(Participant(conversation_id=chat.id, user_id=maya.id, unread=1, muted=False))
        db.add(
            Message(
                conversation_id=chat.id,
                sender_id=arun.id,
                body="Thank you for the comment on my post. Would you like to compare notes on hard mornings sometime?",
                created_at=utcnow() - timedelta(hours=5),
            )
        )
        request = Conversation(created_by=leila.id, status="request", created_at=utcnow() - timedelta(hours=3))
        db.add(request)
        db.flush()
        db.add(Participant(conversation_id=request.id, user_id=leila.id, unread=0, muted=False))
        db.add(Participant(conversation_id=request.id, user_id=maya.id, unread=1, muted=False))
        db.add(
            Message(
                conversation_id=request.id,
                sender_id=leila.id,
                body="I recognised the part about mornings. No pressure to reply.",
                created_at=utcnow() - timedelta(hours=3),
            )
        )

        convo = AIConversation(
            owner_id=maya.id,
            title="Mornings feel heavy",
            style="gentle",
            intent="listen",
            use_profile=True,
            created_at=utcnow() - timedelta(days=1),
            updated_at=utcnow() - timedelta(hours=2),
        )
        db.add(convo)
        db.flush()
        db.add(
            AIMessage(
                conversation_id=convo.id,
                role="user",
                content="I'm tired of explaining my condition to everyone. Nobody understands.",
                created_at=utcnow() - timedelta(hours=3),
            )
        )
        db.add(
            AIMessage(
                conversation_id=convo.id,
                role="assistant",
                content=(
                    "That sounds lonely and frustrating. Having to explain something personal again and again can take a lot out of you. "
                    "I can listen without asking you to justify how you feel. Would you rather tell me what happened today, "
                    "or would it help to look at a community where people have chosen to share similar experiences?\n\n"
                    "Demo reply. No model key is configured, so this was written by HeartBridge's labelled fallback, not a live model. "
                    "I am an AI companion, not a clinician."
                ),
                demo=True,
                created_at=utcnow() - timedelta(hours=2),
            )
        )

        aisha = Doctor(
            user_id=aisha_user.id,
            name="Dr. Aisha Rahman",
            qualifications="MBBS, MD (sample)",
            specialty="Cardiology",
            clinic="Sample River Clinic",
            area="Hyderabad",
            languages="English, Hindi",
            modes="video, clinic",
            fee_inr=800,
            fee_confirmed=True,
            verification_status="sample",
            is_demo=True,
            bio="Fictional cardiology profile for the demo. Not a real clinician and not available for real care.",
            accessibility="Step-free entrance marked on the sample profile.",
        )
        rohan = Doctor(
            name="Dr. Rohan Iyer",
            qualifications="MBBS (sample)",
            specialty="General practice",
            clinic="Sample Lake Surgery",
            area="Bengaluru",
            languages="English, Kannada",
            modes="clinic",
            fee_inr=500,
            fee_confirmed=True,
            verification_status="sample",
            is_demo=True,
            bio="Fictional general practice profile. Availability below is simulated.",
            accessibility="",
        )
        mei = Doctor(
            name="Dr. Mei Lin",
            qualifications="MD Psychiatry (sample)",
            specialty="Psychiatry",
            clinic="Sample North Studio",
            area="Online",
            languages="English, Mandarin",
            modes="video",
            fee_inr=None,
            fee_confirmed=False,
            verification_status="sample",
            is_demo=True,
            bio="Fictional psychiatry profile. Fee is intentionally unconfirmed, so the app does not display one.",
            accessibility="Video visits, no travel required.",
        )
        elena = Doctor(
            name="Elena Costa",
            qualifications="MPT (sample)",
            specialty="Physiotherapy",
            clinic="Sample Harbour Studio",
            area="Mumbai",
            languages="English",
            modes="video, clinic",
            fee_inr=700,
            fee_confirmed=True,
            verification_status="sample",
            is_demo=True,
            bio="Fictional physiotherapy profile with a wheelchair-accessible sample clinic note.",
            accessibility="Wheelchair accessible entrance",
        )
        db.add_all([aisha, rohan, mei, elena])
        db.flush()

        booked_slot = None
        for doctor in (aisha, rohan, mei, elena):
            for day in range(1, 5):
                for hour in (4, 9):
                    start = (utcnow() + timedelta(days=day)).replace(hour=hour, minute=30, second=0, microsecond=0)
                    slot = AvailabilitySlot(
                        doctor_id=doctor.id,
                        starts_at=start,
                        ends_at=start + timedelta(minutes=30),
                        status="open",
                        is_demo=True,
                    )
                    db.add(slot)
                    if doctor is aisha and booked_slot is None:
                        booked_slot = slot
        db.flush()
        booked_slot.status = "booked"
        appointment = Appointment(
            patient_id=maya.id,
            doctor_id=aisha.id,
            slot_id=booked_slot.id,
            status="confirmed",
            notes="I want to ask about walking to the market with my uncle's old questions in mind. This note is fictional.",
            created_at=utcnow() - timedelta(days=1),
            updated_at=utcnow() - timedelta(days=1),
        )
        db.add(appointment)
        db.flush()
        db.add(
            AppointmentEvent(
                appointment_id=appointment.id,
                actor_id=maya.id,
                from_status="requested",
                to_status="confirmed",
                created_at=utcnow() - timedelta(days=1),
            )
        )
        db.commit()
        print("Demo data ready.")
        print("Maya (member): maya@heartbridge.demo / DemoPass123!")
        print("Admin: admin@heartbridge.demo / DemoPass123!")
        print("Clinician sample: aisha@heartbridge.demo / DemoPass123!")
    finally:
        db.close()


if __name__ == "__main__":
    run()
