from __future__ import annotations

from redis import Redis
from rq import Connection, Worker

from app.core.config import get_settings


def main() -> None:
    settings = get_settings()
    redis = Redis.from_url(settings.redis_url)
    with Connection(redis):
        worker = Worker([settings.queue_name])
        worker.work()


if __name__ == "__main__":
    main()
