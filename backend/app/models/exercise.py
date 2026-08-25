import uuid

from sqlalchemy import Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Exercise(Base):
    """User-editable exercise library.

    Global seed rows have ``user_id = NULL``; per-user additions have a
    ``user_id``.  The unique constraint is ``(user_id, name)`` so global
    names are reserved and user additions don't collide with seeds.
    """

    __tablename__ = "exercises"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_exercise_user_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(
        String(50), nullable=False, default="accessory"
    )  # big3, compound, accessory
    aliases: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
