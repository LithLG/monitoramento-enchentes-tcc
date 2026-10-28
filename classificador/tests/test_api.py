import pymysql
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.tree import Thresholds

V1 = Thresholds(id=1, attention_fraction=0.667, risk_fraction=1.000, soil_saturated_index=0.8, level_hysteresis_mm=2.0, dry_depth_mm=1.0)
V2 = Thresholds(id=2, attention_fraction=0.600, risk_fraction=1.000, soil_saturated_index=0.8, level_hysteresis_mm=1.5, dry_depth_mm=1.0)

VALID_READING = {
    "reading_id": 4,
    "node_id": 1,
    "level_range": "DENTRO",
    "level_depth_mm": 22.5,
    "bankfull_depth_mm": 30.0,
    "rain_class": "CHUVA_INTENSA",
    "soil_index": 0.882,
    "previous_status": "NORMAL",
}


class FakeThresholdRepository:
    def __init__(self, *active_sets, error=None):
        self._active_sets = list(active_sets)
        self._error = error

    def find_active(self):
        if self._error:
            raise self._error
        return self._active_sets.pop(0) if len(self._active_sets) > 1 else self._active_sets[0]

    def ping(self):
        if self._error:
            raise self._error


def client_with(repository):
    return TestClient(create_app(repository))


def test_valid_request_returns_contract_fields():
    response = client_with(FakeThresholdRepository(V1)).post("/classify", json=VALID_READING)
    assert response.status_code == 200
    assert response.json() == {"status": "RISCO", "rule": "ESCALADA_SOLO_CHUVA", "threshold_set_id": 1}


@pytest.mark.parametrize(
    "change",
    [
        {"level_depth_mm": None},
        {"level_range": "ABAIXO"},
        {"bankfull_depth_mm": 0},
        {"rain_class": "GAROA"},
        {"previous_status": "ALERTA"},
        {"level_depth_mm": -1},
    ],
)
def test_invalid_reading_is_rejected_with_422(change):
    response = client_with(FakeThresholdRepository(V1)).post("/classify", json={**VALID_READING, **change})
    assert response.status_code == 422


def test_reading_outside_sensor_range_has_no_depth():
    body = {**VALID_READING, "level_range": "ACIMA", "level_depth_mm": None}
    response = client_with(FakeThresholdRepository(V1)).post("/classify", json=body)
    assert response.json()["rule"] == "TRANSBORDOU"


def test_new_active_threshold_set_is_used_without_restart():
    client = client_with(FakeThresholdRepository(V1, V2))
    body = {**VALID_READING, "level_depth_mm": 19.0, "rain_class": "SECO", "previous_status": None}

    first = client.post("/classify", json=body).json()
    second = client.post("/classify", json=body).json()

    assert (first["status"], first["threshold_set_id"]) == ("NORMAL", 1)
    assert (second["status"], second["threshold_set_id"]) == ("ATENCAO", 2)


def test_no_active_threshold_set_returns_503():
    response = client_with(FakeThresholdRepository(None)).post("/classify", json=VALID_READING)
    assert response.status_code == 503


def test_database_down_returns_503_on_classify_and_health():
    client = client_with(FakeThresholdRepository(error=pymysql.err.OperationalError(2003, "conexão recusada")))
    assert client.post("/classify", json=VALID_READING).status_code == 503
    assert client.get("/health").status_code == 503


def test_health_reports_database_ok():
    response = client_with(FakeThresholdRepository(V1)).get("/health")
    assert response.json() == {"ok": True, "banco": "ok"}


EXPLAIN_REQUEST = {key: value for key, value in VALID_READING.items() if key not in ("reading_id", "node_id")}


def test_explain_returns_every_step_and_the_limits():
    response = client_with(FakeThresholdRepository(V1)).post("/explain", json=EXPLAIN_REQUEST)
    assert response.status_code == 200
    body = response.json()
    assert body["by_level"] == {"status": "ATENCAO", "rule": "NIVEL_ATENCAO"}
    assert body["after_hysteresis"] == {"status": "ATENCAO", "rule": "NIVEL_ATENCAO"}
    assert body["final"] == {"status": "RISCO", "rule": "ESCALADA_SOLO_CHUVA"}
    assert (body["previous_was_higher"], body["is_raining"], body["soil_is_saturated"]) == (False, True, True)
    assert body["limits"]["attention_mm"] == 20.01
    assert body["limits"]["bankfull_mm"] == 30.0
    assert (body["threshold_set_id"], body["soil_saturated_index"]) == (1, 0.8)


def test_explain_validates_like_classify():
    response = client_with(FakeThresholdRepository(V1)).post("/explain", json={**EXPLAIN_REQUEST, "level_depth_mm": None})
    assert response.status_code == 422
