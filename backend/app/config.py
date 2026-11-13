from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = (
        "mysql+pymysql://equal_care:local_dev_password@127.0.0.1:3306/equal_care?charset=utf8mb4"
    )
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    data_dir: Path = Path(__file__).resolve().parents[2] / "data" / "processed"


@lru_cache
def get_settings() -> Settings:
    return Settings()
