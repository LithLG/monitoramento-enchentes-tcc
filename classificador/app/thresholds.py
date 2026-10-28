import pymysql

from .config import DatabaseSettings
from .tree import Thresholds

ACTIVE_THRESHOLDS_SQL = """
    SELECT id, attention_fraction, risk_fraction, soil_saturated_index, level_hysteresis_mm, dry_depth_mm
      FROM threshold_set
     WHERE is_active
"""


class ThresholdRepository:
    def __init__(self, settings: DatabaseSettings):
        self._settings = settings

    def _connect(self):
        return pymysql.connect(
            host=self._settings.host,
            port=self._settings.port,
            user=self._settings.user,
            password=self._settings.password,
            database=self._settings.database,
            connect_timeout=3,
            read_timeout=3,
        )

    def find_active(self) -> Thresholds | None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute(ACTIVE_THRESHOLDS_SQL)
            row = cursor.fetchone()
        if row is None:
            return None

        threshold_set_id, attention, risk, soil, hysteresis, dry_depth = row
        return Thresholds(
            id=threshold_set_id,
            attention_fraction=float(attention),
            risk_fraction=float(risk),
            soil_saturated_index=float(soil),
            level_hysteresis_mm=float(hysteresis),
            dry_depth_mm=float(dry_depth),
        )

    def ping(self) -> None:
        with self._connect() as connection:
            connection.ping()
