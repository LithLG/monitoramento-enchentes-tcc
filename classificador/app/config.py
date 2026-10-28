import os
from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class DatabaseSettings:
    host: str
    port: int
    database: str
    user: str
    password: str


def _required(env: Mapping[str, str], name: str) -> str:
    value = env.get(name, "")
    if value == "":
        raise RuntimeError(f"Variável {name} não definida. Confira o .env do servidor (servidor\\.env).")
    return value


def _port(env: Mapping[str, str], name: str, fallback: int) -> int:
    raw = env.get(name, "")
    if raw == "":
        return fallback
    is_valid_port = raw.isdigit() and 0 < int(raw) < 65536
    if not is_valid_port:
        raise RuntimeError(f'Variável {name} deve ser uma porta entre 1 e 65535 (recebido: "{raw}").')
    return int(raw)


def load_database_settings(env: Mapping[str, str] = os.environ) -> DatabaseSettings:
    return DatabaseSettings(
        host=env.get("DB_HOST") or "127.0.0.1",
        port=_port(env, "DB_PORT", 3306),
        database=env.get("DB_NAME") or "tcc_enchentes",
        user=_required(env, "DB_USER"),
        password=_required(env, "DB_PASSWORD"),
    )
