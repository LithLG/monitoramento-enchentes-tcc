from dataclasses import dataclass
from enum import IntEnum, StrEnum


class Status(IntEnum):
    NORMAL = 0
    ATENCAO = 1
    RISCO = 2


class LevelRange(StrEnum):
    BELOW = "ABAIXO"
    INSIDE = "DENTRO"
    ABOVE = "ACIMA"


class RainClass(StrEnum):
    DRY = "SECO"
    RAIN = "CHUVA"
    HEAVY = "CHUVA_INTENSA"


@dataclass(frozen=True)
class Thresholds:
    id: int
    attention_fraction: float
    risk_fraction: float
    soil_saturated_index: float
    level_hysteresis_mm: float
    dry_depth_mm: float


@dataclass(frozen=True)
class TreeInput:
    level_range: LevelRange
    level_depth_mm: float | None
    bankfull_depth_mm: float
    rain_class: RainClass
    soil_index: float
    previous_status: Status | None


@dataclass(frozen=True)
class Decision:
    status: Status
    rule: str


@dataclass(frozen=True)
class Explanation:
    by_level: Decision
    previous_was_higher: bool
    after_hysteresis: Decision
    is_raining: bool
    soil_is_saturated: bool
    final: Decision


@dataclass(frozen=True)
class LevelLimits:
    dry_mm: float
    attention_mm: float
    attention_exit_mm: float
    risk_mm: float
    risk_exit_mm: float
    bankfull_mm: float


def classify(reading: TreeInput, thresholds: Thresholds) -> Decision:
    return explain(reading, thresholds).final


# Same three steps as classify, with the result of each step, so the panel can draw the path in the tree.
def explain(reading: TreeInput, thresholds: Thresholds) -> Explanation:
    by_level = classify_by_level(reading, thresholds)
    after_hysteresis = apply_hysteresis(by_level, reading, thresholds)
    return Explanation(
        by_level=by_level,
        previous_was_higher=_previous_was_higher(by_level, reading),
        after_hysteresis=after_hysteresis,
        is_raining=_is_raining(reading),
        soil_is_saturated=_soil_is_saturated(reading, thresholds),
        final=apply_escalation(after_hysteresis, reading, thresholds),
    )


def level_limits(bankfull_depth_mm: float, thresholds: Thresholds) -> LevelLimits:
    attention = entry_limit_mm(Status.ATENCAO, bankfull_depth_mm, thresholds)
    risk = entry_limit_mm(Status.RISCO, bankfull_depth_mm, thresholds)
    return LevelLimits(
        dry_mm=thresholds.dry_depth_mm,
        attention_mm=attention,
        attention_exit_mm=round(attention - thresholds.level_hysteresis_mm, 4),
        risk_mm=risk,
        risk_exit_mm=round(risk - thresholds.level_hysteresis_mm, 4),
        bankfull_mm=bankfull_depth_mm,
    )


def entry_limit_mm(status: Status, bankfull_depth_mm: float, thresholds: Thresholds) -> float:
    fraction = thresholds.risk_fraction if status is Status.RISCO else thresholds.attention_fraction
    # Round to remove float error: 0.667 x 30.0 must give 20.01, not 20.009999.
    return round(fraction * bankfull_depth_mm, 4)


def classify_by_level(reading: TreeInput, thresholds: Thresholds) -> Decision:
    # The sensor range ends at the bank crest, so ABOVE means the river overflows.
    if reading.level_range is LevelRange.ABOVE:
        return Decision(Status.RISCO, "TRANSBORDOU")
    # The first point of the level curve is the reading with no water, so BELOW also means a dry river.
    river_is_dry = reading.level_range is LevelRange.BELOW or reading.level_depth_mm < thresholds.dry_depth_mm
    if river_is_dry:
        return Decision(Status.NORMAL, "RIO_SECO")

    depth = reading.level_depth_mm
    if depth >= reading.bankfull_depth_mm:
        return Decision(Status.RISCO, "TRANSBORDOU")
    if depth >= entry_limit_mm(Status.RISCO, reading.bankfull_depth_mm, thresholds):
        return Decision(Status.RISCO, "NIVEL_RISCO")
    if depth >= entry_limit_mm(Status.ATENCAO, reading.bankfull_depth_mm, thresholds):
        return Decision(Status.ATENCAO, "NIVEL_ATENCAO")
    return Decision(Status.NORMAL, "NIVEL_NORMAL")


def _previous_was_higher(decision: Decision, reading: TreeInput) -> bool:
    previous = reading.previous_status
    return reading.level_range is LevelRange.INSIDE and previous is not None and previous > decision.status


def apply_hysteresis(decision: Decision, reading: TreeInput, thresholds: Thresholds) -> Decision:
    if not _previous_was_higher(decision, reading):
        return decision

    held = reading.previous_status
    while held > decision.status and _left_hysteresis_band(held, reading, thresholds):
        held = Status(held - 1)

    if held == decision.status:
        return decision
    return Decision(held, f"HISTERESE_MANTEM_{held.name}")


def _left_hysteresis_band(status: Status, reading: TreeInput, thresholds: Thresholds) -> bool:
    exit_limit_mm = entry_limit_mm(status, reading.bankfull_depth_mm, thresholds) - thresholds.level_hysteresis_mm
    return reading.level_depth_mm < exit_limit_mm


def _soil_is_saturated(reading: TreeInput, thresholds: Thresholds) -> bool:
    return reading.soil_index >= thresholds.soil_saturated_index


# The rain plate only tells wet or dry (decision of 26/10), so any rain counts.
def _is_raining(reading: TreeInput) -> bool:
    return reading.rain_class is not RainClass.DRY


def apply_escalation(decision: Decision, reading: TreeInput, thresholds: Thresholds) -> Decision:
    if not (_soil_is_saturated(reading, thresholds) and _is_raining(reading)):
        return decision

    if decision.status is Status.ATENCAO:
        return Decision(Status.RISCO, "ESCALADA_SOLO_CHUVA")
    # Rain and wet soil alone do not change the class: the river level must rise first (decision of 26/10).
    if decision.status is Status.NORMAL:
        return Decision(Status.NORMAL, "AVISO_SOLO_CHUVA")
    return decision
