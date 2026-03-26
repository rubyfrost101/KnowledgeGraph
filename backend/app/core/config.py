from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "KnowledgeGraph API"
    api_v1_prefix: str = "/v1"
    database_url: str = "postgresql+psycopg://knowledgegraph:knowledgegraph@localhost:5432/knowledgegraph"
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    postgres_dsn: str = "postgresql://knowledgegraph:knowledgegraph@localhost:5432/knowledgegraph"
    neo4j_uri: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "knowledgegraph"
    redis_url: str = "redis://localhost:6379/0"
    queue_name: str = "knowledgegraph"
    ocr_lang: str = "eng"
    ocr_dpi: int = 220
    inline_job_page_limit: int = 20


@lru_cache
def get_settings() -> Settings:
    return Settings()
