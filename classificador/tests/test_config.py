import pytest

from app.config import load_database_settings


def test_defaults_point_to_local_database():
    settings = load_database_settings({"DB_USER": "tcc_app", "DB_PASSWORD": "x"})
    assert (settings.host, settings.port, settings.database) == ("127.0.0.1", 3306, "tcc_enchentes")


def test_missing_password_explains_where_to_fix():
    with pytest.raises(RuntimeError, match="DB_PASSWORD"):
        load_database_settings({"DB_USER": "tcc_app"})


def test_invalid_port_is_rejected():
    with pytest.raises(RuntimeError, match="DB_PORT"):
        load_database_settings({"DB_USER": "tcc_app", "DB_PASSWORD": "x", "DB_PORT": "abc"})
