from __future__ import annotations

from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.db.models import Base


@lru_cache
def get_engine():
    settings = get_settings()
    return create_engine(settings.database_url, pool_pre_ping=True)


@lru_cache
def get_session_factory():
    return sessionmaker(bind=get_engine(), autoflush=False, autocommit=False, expire_on_commit=False)


@contextmanager
def session_scope() -> Session:
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def init_db() -> None:
    engine = get_engine()
    Base.metadata.create_all(bind=engine)

    inspector = inspect(engine)
    node_columns = {column["name"] for column in inspector.get_columns("knowledge_nodes")}
    with engine.begin() as connection:
        if "reference_ids" not in node_columns:
            if engine.dialect.name == "postgresql":
                connection.execute(
                    text("ALTER TABLE knowledge_nodes ADD COLUMN reference_ids JSONB NOT NULL DEFAULT '[]'::jsonb")
                )
            else:
                connection.execute(text("ALTER TABLE knowledge_nodes ADD COLUMN reference_ids JSON NOT NULL DEFAULT '[]'"))
